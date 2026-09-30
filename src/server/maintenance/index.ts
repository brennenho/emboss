import { config, type Env } from "../config";
import { purgeResourceContent } from "../resource-store";
import type { ResourceKind } from "../../shared/resources";
import { finishUpload, type BlobRow } from "../storage/uploads";
import type { MaintenanceFailure } from "./health";

export async function maintenance(env: Env, now = Date.now()) {
  if (config(env).READ_ONLY_MODE === "true") return;
  const runId = crypto.randomUUID();
  // A lease avoids overlapping invocations. An interrupted run can be retried;
  // object deletion and its accounting remain idempotent across those retries.
  const claimed = await env.DB.prepare(
    `INSERT INTO maintenance_health(id,run_id,started_at) VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,
      started_at=excluded.started_at,finished_at=NULL,failure_count=0,failures='[]',reclaimed_bytes=0
      WHERE maintenance_health.finished_at IS NOT NULL OR maintenance_health.started_at<=?
      RETURNING id`,
  )
    .bind(runId, now, now - 15 * 60 * 1000)
    .first();
  if (!claimed) return;

  let reclaimedBytes = 0;
  let failureCount = 0;
  let phase = "reconcile-uploads";
  const failures: MaintenanceFailure[] = [];
  function failed(operation: string, id?: string) {
    failureCount += 1;
    const failure = { operation, ...(id ? { id } : {}) };
    if (failures.length < 10) failures.push(failure);
    console.error(JSON.stringify({ ...failure, runId, status: "failed" }));
  }
  try {
    const stale = await env.DB.prepare(
      "SELECT * FROM blobs WHERE state IN ('reserved','uploading') AND lease_expires_at<=? ORDER BY lease_expires_at LIMIT 25",
    )
      .bind(now)
      .all<BlobRow>();
    for (const blob of stale.results) {
      try {
        const object =
          blob.state === "uploading"
            ? await env.FILES.head(blob.object_key)
            : null;
        if (
          object &&
          object.size === blob.expected_bytes &&
          object.customMetadata?.claimId === blob.claim_id
        ) {
          const bytes = await env.FILES.get(blob.object_key, {
            range: { offset: 0, length: Math.min(blob.expected_bytes, 65536) },
          });
          if (bytes) {
            try {
              await finishUpload(
                env,
                blob,
                object.etag,
                new Uint8Array(await bytes.arrayBuffer()),
                now,
              );
              continue;
            } catch (error) {
              if (!(error instanceof Error) || !("status" in error))
                throw error;
            }
          }
        }
        await env.DB.prepare(
          "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id=? AND state IN ('reserved','uploading') AND lease_expires_at<=?",
        )
          .bind(now, now, blob.id, now)
          .run();
      } catch {
        failed("reconcile-upload", blob.id);
      }
    }

    phase = "expire-staged-avatars";
    await env.DB.prepare(
      "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id IN (SELECT b.id FROM blobs b WHERE b.purpose='avatar' AND b.state='ready' AND b.created_at<? AND NOT EXISTS(SELECT 1 FROM business_card c WHERE c.avatar_blob_id=b.id) LIMIT 25)",
    )
      .bind(now, now, now - 86400000)
      .run();

    phase = "purge-resource-content";
    const resources = await env.DB.prepare(
      "SELECT id,kind,revision FROM resources WHERE state='deleted' AND purged_at IS NULL AND purge_after<=? ORDER BY purge_after,id LIMIT 100",
    )
      .bind(now)
      .all<{ id: string; kind: ResourceKind; revision: number }>();
    for (const resource of resources.results) {
      try {
        await purgeResourceContent(
          env,
          resource.id,
          resource.kind,
          resource.revision,
          now,
        );
      } catch {
        failed("purge-resource-content", resource.id);
      }
    }

    phase = "purge-blobs";
    // Claim before touching R2. Restoration uses the same gate and cannot make
    // a claimed object public while an external deletion is in flight.
    const due = await env.DB.prepare(
      `UPDATE blobs SET purge_started_at=COALESCE(purge_started_at,?)
        WHERE id IN (SELECT id FROM blobs WHERE state='pending_delete' AND purge_after<=?
          ORDER BY purge_after,id LIMIT 25)
        AND state='pending_delete' AND purge_after<=? RETURNING *`,
    )
      .bind(now, now, now)
      .all<BlobRow>();
    for (const blob of due.results) {
      try {
        await env.FILES.delete(blob.object_key);
        const result = await env.DB.batch([
          // Account in the same transaction as marking the object purged. Even
          // a retry of an interrupted run cannot count the same bytes twice.
          env.DB.prepare(
            "UPDATE maintenance_health SET total_reclaimed_bytes=total_reclaimed_bytes+COALESCE((SELECT stored_bytes FROM blobs WHERE id=? AND state='pending_delete'),0) WHERE id=1",
          ).bind(blob.id),
          env.DB.prepare(
            "UPDATE blobs SET state='purged',stored_bytes=0,detected_type=NULL,width=NULL,height=NULL,etag=NULL,claim_id=NULL,updated_at=? WHERE id=? AND state='pending_delete' RETURNING id",
          ).bind(now, blob.id),
        ]);
        if (result[1]?.results.length) reclaimedBytes += blob.stored_bytes;
      } catch {
        failed("purge-blob", blob.id);
      }
    }

    phase = "expire-session-records";
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE expires_at<=? LIMIT 100)",
      ).bind(now),
      env.DB.prepare(
        "DELETE FROM idempotency_keys WHERE key IN (SELECT key FROM idempotency_keys WHERE expires_at<=? LIMIT 100)",
      ).bind(now),
    ]);
  } catch {
    failed(phase);
  } finally {
    const finishedAt = Math.max(now, Date.now());
    await env.DB.prepare(
      `UPDATE maintenance_health SET finished_at=?,
        succeeded_at=CASE WHEN ?=0 THEN ? ELSE succeeded_at END,
        failure_count=?,failures=?,reclaimed_bytes=?
        WHERE id=1 AND run_id=?`,
    )
      .bind(
        finishedAt,
        failureCount,
        finishedAt,
        failureCount,
        JSON.stringify(failures),
        reclaimedBytes,
        runId,
      )
      .run();
  }
  return { failureCount, reclaimedBytes };
}
