import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import { maintenance } from "../../src/server/maintenance";
import { readMaintenanceHealth } from "../../src/server/maintenance/health";
import { deleteResource } from "../../src/server/resource-store";
import {
  initiateUpload,
  transferUpload,
} from "../../src/server/storage/uploads";

const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
afterEach(() => vi.restoreAllMocks());

describe("cleanup health and recovery", () => {
  it("reports no history truthfully, then records a completed cleanup", async () => {
    const initial = await readMaintenanceHealth(env);
    expect(initial.startedAt).toBeNull();
    expect(initial.succeededAt).toBeNull();
    expect(initial.stale).toBe(false);
    await maintenance(env);
    const health = await readMaintenanceHealth(env);
    expect(health.runId).toBeTruthy();
    expect(health.startedAt).not.toBeNull();
    expect(health.finishedAt).not.toBeNull();
    expect(health.succeededAt).toBe(health.finishedAt);
    expect(health.failureCount).toBe(0);
    const stale = await readMaintenanceHealth(env, Date.now() + 3 * 3600000);
    expect(stale.stale).toBe(true);
  });

  it("keeps failed object deletions queued, records safe references, and counts successful retries once", async () => {
    const upload = await initiateUpload(
      env,
      { filename: "sensitive-filename.txt", title: "Private title", bytes: 4 },
      crypto.randomUUID(),
    );
    await transferUpload(
      env,
      upload.uploadId,
      new Request("http://localhost:3000/upload", {
        method: "PUT",
        headers: { "Content-Length": "4" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    await deleteResource(env, "file", upload.uploadId, 1);
    const before = await readMaintenanceHealth(env);
    const now = Date.now() + 31 * 86400000;
    const broken = {
      ...env,
      FILES: {
        head: env.FILES.head.bind(env.FILES),
        get: env.FILES.get.bind(env.FILES),
        delete: () => Promise.reject(new Error("sensitive object details")),
      },
    } as unknown as Env;
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await maintenance(broken, now);
    const failed = await readMaintenanceHealth(env, now);
    expect(failed.failureCount).toBe(1);
    expect(failed.failures).toEqual([
      { operation: "purge-blob", id: upload.uploadId },
    ]);
    expect(failed.succeededAt).toBe(before.succeededAt);
    expect(failed.reclaimedBytes).toBe(0);
    expect(failed.dueCount).toBe(1);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("sensitive");
    const blob = await env.DB.prepare(
      "SELECT state,purge_started_at FROM blobs WHERE id=?",
    )
      .bind(upload.uploadId)
      .first<{ state: string; purge_started_at: number }>();
    expect(blob?.state).toBe("pending_delete");
    expect(blob?.purge_started_at).toBe(now);
    await maintenance(env, now);
    const retried = await readMaintenanceHealth(env, now);
    expect(retried.failureCount).toBe(0);
    expect(retried.dueCount).toBe(0);
    expect(retried.reclaimedBytes).toBe(4);
    expect(retried.totalReclaimedBytes).toBe(before.totalReclaimedBytes + 4);
    await maintenance(env, now);
    expect((await readMaintenanceHealth(env, now)).totalReclaimedBytes).toBe(
      retried.totalReclaimedBytes,
    );
  });

  it("skips all changes while read-only or another invocation still holds the lease", async () => {
    const before = await readMaintenanceHealth(env);
    const prepare = vi.spyOn(env.DB, "prepare");
    await maintenance({ ...env, READ_ONLY_MODE: "true" });
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    const now = Date.now();
    await env.DB.prepare(
      "UPDATE maintenance_health SET finished_at=NULL,started_at=? WHERE id=1",
    )
      .bind(now)
      .run();
    await maintenance(env, now);
    expect((await readMaintenanceHealth(env, now)).runId).toBe(before.runId);
    // An interrupted run stops blocking future scheduled invocations.
    await maintenance(env, now + 16 * 60000);
    expect((await readMaintenanceHealth(env, now)).runId).not.toBe(
      before.runId,
    );
  });

  it("bounds object cleanup and distinguishes future retention from overdue work", async () => {
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: 30 }, (_, index) => {
        const id = crypto.randomUUID();
        return env.DB.prepare(
          "INSERT INTO blobs(id,object_key,purpose,state,expected_bytes,stored_bytes,created_at,updated_at,lease_expires_at,purge_after) VALUES(?,?,'file','pending_delete',1,0,?,?,?,?)",
        ).bind(
          id,
          `test-cleanup/${id}`,
          now,
          now,
          now,
          index < 28 ? now - 3 * 3600000 : now + 86400000,
        );
      }),
    );
    const deletion = vi.spyOn(env.FILES, "delete");
    await maintenance(env, now);
    expect(deletion).toHaveBeenCalledTimes(25);
    const behind = await readMaintenanceHealth(env, now);
    expect(behind.pendingCount).toBe(5);
    expect(behind.dueCount).toBe(3);
    expect(behind.overdue).toBe(true);
    await maintenance(env, now);
    const caughtUp = await readMaintenanceHealth(env, now);
    expect(caughtUp.pendingCount).toBe(2);
    expect(caughtUp.dueCount).toBe(0);
    expect(caughtUp.overdue).toBe(false);
  });

  it("records a phase failure without replacing the last successful timestamp", async () => {
    const before = await readMaintenanceHealth(env);
    const broken = {
      ...env,
      DB: {
        prepare: (sql: string) => {
          if (sql.startsWith("SELECT * FROM blobs WHERE state IN"))
            throw new Error("database unavailable");
          return env.DB.prepare(sql);
        },
        batch: env.DB.batch.bind(env.DB),
      },
    } as unknown as Env;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await maintenance(broken);
    const health = await readMaintenanceHealth(env);
    expect(health.failureCount).toBe(1);
    expect(health.failures).toEqual([{ operation: "reconcile-uploads" }]);
    expect(health.succeededAt).toBe(before.succeededAt);
    expect(health.finishedAt).not.toBeNull();
  });
});
