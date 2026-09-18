import { config, type Env } from "../config";
import { finishUpload, type BlobRow } from "../storage/uploads";
export async function maintenance(env: Env, now = Date.now()) {
  if (config(env).READ_ONLY_MODE === "true") return;
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
            if (!(error instanceof Error) || !("status" in error)) throw error;
          }
        }
      }
      await env.DB.prepare(
        "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id=? AND state IN ('reserved','uploading') AND lease_expires_at<=?",
      )
        .bind(now, now, blob.id, now)
        .run();
    } catch {
      console.error(
        JSON.stringify({
          operation: "reconcile-upload",
          status: "failed",
          id: blob.id,
        }),
      );
    }
  }
  // A ready, staged avatar has a bounded lifetime if it was never attached to the card.
  await env.DB.prepare(
    "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id IN (SELECT b.id FROM blobs b WHERE b.purpose='avatar' AND b.state='ready' AND b.created_at<? AND NOT EXISTS(SELECT 1 FROM business_card c WHERE c.avatar_blob_id=b.id) LIMIT 25)",
  )
    .bind(now, now, now - 86400000)
    .run();
  const due = await env.DB.prepare(
    "SELECT * FROM blobs WHERE state='pending_delete' AND purge_after<=? ORDER BY purge_after LIMIT 25",
  )
    .bind(now)
    .all<BlobRow>();
  for (const blob of due.results) {
    try {
      await env.FILES.delete(blob.object_key);
      await env.DB.prepare(
        "UPDATE blobs SET state='purged',stored_bytes=0,detected_type=NULL,width=NULL,height=NULL,etag=NULL,claim_id=NULL,updated_at=? WHERE id=? AND state='pending_delete'",
      )
        .bind(now, blob.id)
        .run();
    } catch {
      console.error(
        JSON.stringify({
          operation: "purge-blob",
          status: "failed",
          id: blob.id,
        }),
      );
    }
  }
  const cutoff = now - config(env).DELETION_RETENTION_DAYS * 86400000;
  const tombstones =
    "SELECT id FROM resources WHERE deleted_at IS NOT NULL AND deleted_at<=? AND (title!='' OR expires_at IS NOT NULL) LIMIT 100";
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM links WHERE resource_id IN (${tombstones})`,
    ).bind(cutoff),
    env.DB.prepare(
      `DELETE FROM pastes WHERE resource_id IN (${tombstones})`,
    ).bind(cutoff),
    env.DB.prepare(
      `UPDATE files SET original_filename='' WHERE resource_id IN (${tombstones})`,
    ).bind(cutoff),
    env.DB.prepare(
      `UPDATE resources SET title='',expires_at=NULL WHERE id IN (${tombstones})`,
    ).bind(cutoff),
    env.DB.prepare(
      "DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions WHERE expires_at<=? LIMIT 100)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM idempotency_keys WHERE key IN (SELECT key FROM idempotency_keys WHERE expires_at<=? LIMIT 100)",
    ).bind(now),
  ]);
}
