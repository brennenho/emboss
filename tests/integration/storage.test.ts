import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import {
  initiateUpload,
  transferUpload,
  storageUsage,
  cancelUpload,
  inspectImage,
  type BlobRow,
} from "../../src/server/storage/uploads";
import {
  findFile,
  serveBlob,
  parseRange,
  attachment,
} from "../../src/server/storage/downloads";
import {
  changeResourceState,
  listResources,
  deleteResource,
  updateResource,
} from "../../src/server/resource-store";
import { maintenance } from "../../src/server/maintenance";
const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(() => vi.restoreAllMocks());
const initiation = (size: number) =>
  initiateUpload(
    env,
    { filename: "notes 🫖.txt", title: "File", bytes: size },
    crypto.randomUUID(),
  );
function request(bytes: Uint8Array) {
  return new Request("http://localhost:3000/api/admin/uploads/test", {
    method: "PUT",
    headers: { "Content-Length": String(bytes.length) },
    body: bytes.slice().buffer,
  });
}
const publish = (id: string, revision = 1) =>
  updateResource(env, "file", id, {
    title: "Shared file",
    state: "active",
    expiresAt: null,
    expectedRevision: revision,
  });
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0u8AAAAASUVORK5CYII=",
    "base64",
  ),
);
describe("streamed private file lifecycle", () => {
  it("reuses a deleted file address while retaining and then purging only the old binary", async () => {
    const old = await initiateUpload(
      env,
      { filename: "old.txt", title: "Old file", bytes: 3, slug: "again" },
      crypto.randomUUID(),
    );
    await transferUpload(env, old.uploadId, request(new Uint8Array([1, 2, 3])));
    const oldPublished = await publish(old.uploadId);
    const oldFile = (await findFile(env, oldPublished.slug))!;
    await deleteResource(env, "file", oldPublished.id, oldPublished.revision);
    const replacement = await initiateUpload(
      env,
      { filename: "new.txt", title: "New file", bytes: 2, slug: "again" },
      crypto.randomUUID(),
    );
    expect(await findFile(env, "again")).toBeNull();
    await transferUpload(
      env,
      replacement.uploadId,
      request(new Uint8Array([8, 9])),
    );
    await publish(replacement.uploadId);
    expect((await findFile(env, "again"))?.id).toBe(replacement.uploadId);
    expect(await env.FILES.head(oldFile.object_key)).not.toBeNull();
    await maintenance(env, Date.now() + 31 * 86400000);
    expect(await env.FILES.head(oldFile.object_key)).toBeNull();
    const file = (await findFile(env, "again"))!;
    expect(file.id).toBe(replacement.uploadId);
    const response = await serveBlob(
      env,
      file,
      new Request("http://localhost:3000/f/again/download"),
      file.original_filename,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([8, 9]),
    );
  });
  it("streams 25 MiB, requires publication, and returns identical bytes and ranges", async () => {
    const size = 25 * 1024 ** 2,
      item = await initiation(size);
    expect(item.resource!.slug).toMatch(
      /^[23456789abcdefghjkmnpqrstuvwxyz]{4}$/,
    );
    const bytes = new Uint8Array(size);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await transferUpload(env, item.uploadId, request(bytes));
    expect(await findFile(env, item.resource!.slug)).toBeNull();
    const published = await publish(item.uploadId);
    const file = await findFile(env, published.slug);
    expect(file).not.toBeNull();
    const response = await serveBlob(
      env,
      file!,
      new Request(published.url),
      "notes.txt",
    );
    expect(
      Buffer.from(
        await crypto.subtle.digest("SHA-256", await response.arrayBuffer()),
      ).toString("hex"),
    ).toBe(
      Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"),
    );
    const partial = await serveBlob(
      env,
      file!,
      new Request(published.url, { headers: { Range: "bytes=10-25" } }),
      "notes.txt",
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe(`bytes 10-25/${size}`);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(
      bytes.slice(10, 26),
    );
    const head = await serveBlob(
      env,
      file!,
      new Request(published.url, { method: "HEAD" }),
      "notes.txt",
    );
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Length")).toBe(String(size));
    expect(head.headers.get("Cache-Control")).toBe("no-store");
  }, 30000);
  it("reserves quota atomically and counts retained objects", async () => {
    const used = await storageUsage(env);
    const prior = await env.DB.prepare(
      "SELECT quota_bytes FROM installation WHERE id=1",
    ).first<number>("quota_bytes");
    await env.DB.prepare("UPDATE installation SET quota_bytes=? WHERE id=1")
      .bind(used!.used + used!.pending + used!.retained + 100)
      .run();
    try {
      const results = await Promise.allSettled([
        initiation(80),
        initiation(80),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const value = results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof initiation>>>;
      await deleteResource(env, "file", value.value.uploadId, 1);
      await expect(initiation(80)).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
      });
    } finally {
      await env.DB.prepare("UPDATE installation SET quota_bytes=? WHERE id=1")
        .bind(prior)
        .run();
    }
  });
  it("rejects byte mismatches, oversized initiation, and unready publication", async () => {
    await expect(initiation(26214401)).rejects.toMatchObject({ status: 413 });
    const item = await initiation(100);
    await expect(
      transferUpload(env, item.uploadId, request(new Uint8Array(99))),
    ).rejects.toMatchObject({ code: "SIZE_MISMATCH" });
    await expect(publish(item.uploadId)).rejects.toMatchObject({
      code: "UPLOAD_NOT_READY",
    });
  });
  it("has one upload claim and cannot overwrite a ready object by replay", async () => {
    const item = await initiation(3),
      bytes = new Uint8Array([1, 2, 3]);
    const results = await Promise.allSettled([
      transferUpload(env, item.uploadId, request(bytes)),
      transferUpload(env, item.uploadId, request(new Uint8Array([8, 8, 8]))),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const blob = await env.DB.prepare("SELECT * FROM blobs WHERE id=?")
      .bind(item.uploadId)
      .first<BlobRow>();
    const first = await env.FILES.get(blob!.object_key);
    const original = new Uint8Array(await first!.arrayBuffer());
    await transferUpload(
      env,
      item.uploadId,
      request(new Uint8Array([9, 9, 9])),
    );
    const after = await env.FILES.get(blob!.object_key);
    expect(new Uint8Array(await after!.arrayBuffer())).toEqual(original);
  });
  it("keeps successful R2 writes recoverable after D1 finalization failure", async () => {
    const item = await initiation(4);
    const broken = {
      ...env,
      DB: {
        prepare: (sql: string) =>
          sql.startsWith("UPDATE blobs SET state='ready'")
            ? {
                bind: () => ({
                  all: () =>
                    Promise.reject(new Error("simulated database outage")),
                }),
              }
            : env.DB.prepare(sql),
        batch: env.DB.batch.bind(env.DB),
      },
    } as unknown as Env;
    await expect(
      transferUpload(
        broken,
        item.uploadId,
        request(new Uint8Array([1, 2, 3, 4])),
      ),
    ).rejects.toThrow("simulated database outage");
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("uploading");
    await maintenance(env, Date.now() + 3600001);
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("ready");
  });
  it("revokes immediately and purges only after retention; retries object-deletion failure", async () => {
    const item = await initiation(4);
    await transferUpload(
      env,
      item.uploadId,
      request(new Uint8Array([3, 4, 5, 6])),
    );
    const published = await publish(item.uploadId);
    const blob = await env.DB.prepare("SELECT * FROM blobs WHERE id=?")
      .bind(item.uploadId)
      .first<BlobRow>();
    await deleteResource(env, "file", item.uploadId, published.revision);
    expect(await findFile(env, published.slug)).toBeNull();
    await maintenance(env, Date.now() + 1000);
    expect(await env.FILES.head(blob!.object_key)).not.toBeNull();
    const broken = {
      ...env,
      FILES: {
        delete: () => Promise.reject(new Error("simulated R2 outage")),
        head: env.FILES.head.bind(env.FILES),
        get: env.FILES.get.bind(env.FILES),
      },
    } as unknown as Env;
    await maintenance(broken, Date.now() + 31 * 86400000);
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("pending_delete");
    await maintenance(env, Date.now() + 31 * 86400000);
    expect(await env.FILES.head(blob!.object_key)).toBeNull();
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("purged");
    expect(
      await env.DB.prepare("SELECT title FROM resources WHERE id=?")
        .bind(item.uploadId)
        .first("title"),
    ).toBe("");
  });
  it("never purges merely expired published files", async () => {
    const item = await initiation(2);
    await transferUpload(env, item.uploadId, request(new Uint8Array([1, 2])));
    await publish(item.uploadId);
    await env.DB.prepare("UPDATE resources SET expires_at=? WHERE id=?")
      .bind(Date.now() - 1, item.uploadId)
      .run();
    expect(await findFile(env, item.resource!.slug)).toBeNull();
    await maintenance(env, Date.now() + 60 * 86400000);
    const blob = await env.DB.prepare("SELECT * FROM blobs WHERE id=?")
      .bind(item.uploadId)
      .first<BlobRow>();
    expect(blob!.state).toBe("ready");
    expect(await env.FILES.head(blob!.object_key)).not.toBeNull();
  });
  it("cancels reservations durably and cleans abandoned objects", async () => {
    const item = await initiation(20);
    await cancelUpload(env, item.uploadId);
    await expect(
      transferUpload(env, item.uploadId, request(new Uint8Array(20))),
    ).rejects.toMatchObject({ status: 409 });
    await maintenance(env, Date.now() + 3600001);
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("purged");
  });
  it("validates raster headers and refuses active-content preview", async () => {
    expect(inspectImage(png, png.length, "avatar").type).toBe("image/png");
    expect(
      inspectImage(
        new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
        30,
        "file",
      ).type,
    ).toBe("application/octet-stream");
    expect(() =>
      inspectImage(new TextEncoder().encode("<html>"), 6, "avatar"),
    ).toThrow();
    const item = await initiateUpload(
      env,
      { filename: "avatar.png", title: "", bytes: png.length },
      crypto.randomUUID(),
      "avatar",
    );
    await transferUpload(env, item.uploadId, request(png));
    expect(
      await env.DB.prepare("SELECT width FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("width"),
    ).toBe(1);
  });
  it("handles suffix ranges and rejects multi/out-of-bounds ranges and header injection", () => {
    expect(parseRange("bytes=-2", 10)).toEqual({ offset: 8, length: 2 });
    for (const value of [
      "bytes=20-30",
      "bytes=0-1,3-4",
      "bytes=-0",
      "bytes=8-2",
      "bytes=a-b",
    ])
      expect(() => parseRange(value, 10)).toThrow();
    expect(attachment('line\r\n"🫖.txt')).not.toContain("\r");
    expect(attachment("🫖.txt")).toContain("filename*=UTF-8''%F0%9F%AB%96.txt");
  });
  it("releases a failing R2 transfer promptly without exposing partial bytes", async () => {
    const item = await initiation(65536);
    const failed = {
      ...env,
      FILES: {
        put: async () => {
          throw new Error("simulated R2 write failure");
        },
      },
    } as unknown as Env;
    await expect(
      transferUpload(failed, item.uploadId, request(new Uint8Array(65536))),
    ).rejects.toThrow("simulated R2 write failure");
    expect(
      await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
        .bind(item.uploadId)
        .first("state"),
    ).toBe("pending_delete");
    expect(await findFile(env, item.resource!.slug)).toBeNull();
  });
});

it("visibility requires a ready upload and lists projected file metadata", async () => {
  const upload = await initiation(3);
  await expect(
    changeResourceState(env, "file", upload.uploadId, {
      state: "active",
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "UPLOAD_NOT_READY" });
  await transferUpload(
    env,
    upload.uploadId,
    request(new Uint8Array([1, 2, 3])),
  );
  const published = await changeResourceState(env, "file", upload.uploadId, {
    state: "active",
    expectedRevision: 1,
  });
  const prepare = vi.spyOn(env.DB, "prepare");
  const list = await listResources(env, "file", {
    q: published.slug,
    limit: 100,
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(list.items).toHaveLength(1);
  expect(list.items[0]).toMatchObject({
    id: published.id,
    bytes: 3,
    filename: "notes 🫖.txt",
    uploadState: "ready",
  });
  prepare.mockRestore();
  await changeResourceState(env, "file", upload.uploadId, {
    state: "disabled",
    expectedRevision: published.revision,
  });
  expect(await findFile(env, published.slug)).toBeNull();
});
