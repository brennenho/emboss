import { imageSize } from "image-size";
import { z } from "zod";
import { config, type Env } from "../config";
import { sha256 } from "../auth/password";
import { AppError } from "../../shared/errors";
import { generatedSlug, slugSchema } from "../../shared/resources";
import { getResource } from "../resource-store";
export const uploadSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (v) => !/[\u0000-\u001f\u007f/\\]/.test(v),
        "Choose a filename without control characters or slashes.",
      ),
    bytes: z.number().int().positive(),
    slug: slugSchema.optional(),
    title: z.string().trim().max(160).default(""),
  })
  .strict();
export type BlobRow = {
  id: string;
  object_key: string;
  purpose: "file" | "avatar";
  state: string;
  expected_bytes: number;
  stored_bytes: number;
  detected_type: string | null;
  width: number | null;
  height: number | null;
  etag: string | null;
  created_at: number;
  updated_at: number;
  lease_expires_at: number;
  purge_after: number | null;
  claim_id: string | null;
};
export const TRANSFER_TIMEOUT = 10 * 60 * 1000;
export async function storageUsage(env: Env) {
  return await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN state='ready' THEN expected_bytes ELSE 0 END),0) used, COALESCE(SUM(CASE WHEN state IN ('reserved','uploading') THEN expected_bytes ELSE 0 END),0) pending, COALESCE(SUM(CASE WHEN state='pending_delete' THEN expected_bytes ELSE 0 END),0) retained FROM blobs",
  ).first<{ used: number; pending: number; retained: number }>();
}
export async function uploadResult(env: Env, id: string) {
  const blob = await env.DB.prepare(
    "SELECT id,purpose,state,lease_expires_at FROM blobs WHERE id=?",
  )
    .bind(id)
    .first<{
      id: string;
      purpose: string;
      state: string;
      lease_expires_at: number;
    }>();
  if (!blob)
    throw new AppError(404, "NOT_FOUND", "This upload is unavailable.");
  return {
    uploadId: blob.id,
    state: blob.state,
    leaseExpiresAt: new Date(blob.lease_expires_at).toISOString(),
    resource:
      blob.purpose === "file" ? await getResource(env, "file", id) : undefined,
  };
}
export async function initiateUpload(
  env: Env,
  input: z.infer<typeof uploadSchema>,
  key: string,
  purpose: "file" | "avatar" = "file",
) {
  const c = config(env);
  const settings = await env.DB.prepare(
    "SELECT upload_max_bytes,quota_bytes FROM installation WHERE id=1",
  ).first<{ upload_max_bytes: number; quota_bytes: number }>();
  if (!settings) throw new Error("Missing installation");
  const max =
    purpose === "avatar"
      ? Math.min(2 * 1024 ** 2, c.UPLOAD_MAX_BYTES, settings.upload_max_bytes)
      : Math.min(c.UPLOAD_MAX_BYTES, settings.upload_max_bytes);
  if (input.bytes > max)
    throw new AppError(
      413,
      "TOO_LARGE",
      `Choose a file of ${max.toLocaleString()} bytes or less.`,
    );
  const hash = await sha256(JSON.stringify(input)),
    operation = `upload-${purpose}`,
    quota = Math.min(c.STORAGE_QUOTA_BYTES, settings.quota_bytes);
  const prior = await env.DB.prepare(
    "SELECT request_hash,operation,result_id FROM idempotency_keys WHERE key=?",
  )
    .bind(key)
    .first<{ request_hash: string; operation: string; result_id: string }>();
  if (prior) {
    if (prior.request_hash !== hash || prior.operation !== operation)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This action key was already used for different content.",
      );
    return uploadResult(env, prior.result_id);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID(),
      slug = input.slug ?? generatedSlug(),
      now = Date.now(),
      objectKey = `${purpose}s/${crypto.randomUUID()}`;
    const guard =
      "EXISTS(SELECT 1 FROM idempotency_keys WHERE key=? AND result_id=?)";
    const stmts = [
      env.DB.prepare(
        "INSERT INTO idempotency_keys(key,operation,request_hash,result_id,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(expected_bytes),0) FROM blobs WHERE state!='purged')+?<=? ON CONFLICT(key) DO NOTHING",
      ).bind(key, operation, hash, id, now, now + 86400000, input.bytes, quota),
      env.DB.prepare(
        `INSERT INTO blobs(id,object_key,purpose,state,expected_bytes,stored_bytes,created_at,updated_at,lease_expires_at) SELECT ?,?,?,'reserved',?,0,?,?,? WHERE ${guard}`,
      ).bind(
        id,
        objectKey,
        purpose,
        input.bytes,
        now,
        now,
        now + 3600000,
        key,
        id,
      ),
    ];
    if (purpose === "file")
      stmts.push(
        env.DB.prepare(
          `INSERT INTO resources(id,kind,slug,title,state,revision,created_at,updated_at) SELECT ?,'file',?,?,'draft',1,?,? WHERE ${guard}`,
        ).bind(id, slug, input.title || input.filename, now, now, key, id),
        env.DB.prepare(
          `INSERT INTO files(resource_id,blob_id,original_filename) SELECT ?,?,? WHERE ${guard}`,
        ).bind(id, id, input.filename, key, id),
      );
    try {
      await env.DB.batch(stmts);
    } catch (error) {
      if (
        String(error).includes(
          "UNIQUE constraint failed: resources.kind, resources.slug",
        )
      ) {
        if (!input.slug) continue;
        throw new AppError(
          409,
          "SLUG_TAKEN",
          "This address is already in use.",
          { slug: "Choose another address." },
        );
      }
      throw error;
    }
    const saved = await env.DB.prepare(
      "SELECT request_hash,operation,result_id FROM idempotency_keys WHERE key=?",
    )
      .bind(key)
      .first<{ request_hash: string; operation: string; result_id: string }>();
    if (!saved)
      throw new AppError(
        409,
        "QUOTA_EXCEEDED",
        "Storage is full. Uploads and deleted files awaiting cleanup also count.",
      );
    if (saved.request_hash !== hash || saved.operation !== operation)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This action key was already used.",
      );
    return uploadResult(env, saved.result_id);
  }
  throw new AppError(
    503,
    "UNAVAILABLE",
    "Could not create an address. Try again.",
  );
}
export function inspectImage(
  header: Uint8Array,
  bytes: number,
  purpose: "file" | "avatar",
) {
  try {
    const info = imageSize(header);
    const type = info.type === "jpg" ? "jpeg" : info.type;
    const width = info.width,
      height = info.height;
    if (
      !["png", "jpeg", "webp"].includes(type ?? "") ||
      !width ||
      !height ||
      width > 8192 ||
      height > 8192 ||
      width * height > 40_000_000 ||
      bytes > 10 * 1024 ** 2 ||
      (purpose === "avatar" &&
        (width > 4096 || height > 4096 || width * height > 16_000_000))
    )
      throw new Error();
    return { type: `image/${type}`, width, height };
  } catch {
    if (purpose === "avatar")
      throw new AppError(
        400,
        "INVALID_IMAGE",
        "Choose a PNG, JPEG, or WebP avatar up to 2 MiB and 4096 × 4096 pixels.",
      );
    return { type: "application/octet-stream", width: null, height: null };
  }
}
export async function finishUpload(
  env: Env,
  blob: BlobRow,
  etag: string,
  header: Uint8Array,
  now = Date.now(),
) {
  const image = inspectImage(header, blob.expected_bytes, blob.purpose);
  const result = await env.DB.prepare(
    "UPDATE blobs SET state='ready',stored_bytes=expected_bytes,detected_type=?,width=?,height=?,etag=?,updated_at=? WHERE id=? AND state='uploading' AND claim_id=? RETURNING id",
  )
    .bind(
      image.type,
      image.width,
      image.height,
      etag,
      now,
      blob.id,
      blob.claim_id,
    )
    .all();
  if (!result.results.length)
    throw new AppError(
      409,
      "UPLOAD_CANCELLED",
      "This upload was cancelled. Start a new upload.",
    );
}
export async function transferUpload(env: Env, id: string, request: Request) {
  const existing = await env.DB.prepare("SELECT * FROM blobs WHERE id=?")
    .bind(id)
    .first<BlobRow>();
  if (!existing)
    throw new AppError(404, "NOT_FOUND", "This upload is unavailable.");
  if (existing.state === "ready") {
    await request.body?.cancel();
    return uploadResult(env, id);
  }
  const length = request.headers.get("content-length");
  if (
    !length ||
    !/^\d+$/.test(length) ||
    Number(length) !== existing.expected_bytes
  )
    throw new AppError(
      400,
      "SIZE_MISMATCH",
      "Upload the exact file size reserved for this attempt.",
    );
  if (!request.body)
    throw new AppError(400, "EMPTY_UPLOAD", "Choose a nonempty file.");
  const now = Date.now(),
    claim = crypto.randomUUID();
  const blob = await env.DB.prepare(
    "UPDATE blobs SET state='uploading',claim_id=?,updated_at=? WHERE id=? AND state='reserved' AND lease_expires_at>? RETURNING *",
  )
    .bind(claim, now, id, now)
    .first<BlobRow>();
  if (!blob)
    throw new AppError(
      409,
      "UPLOAD_CLAIMED",
      "This upload is already running or has expired. Start a new attempt.",
    );
  // FixedLengthStream gives R2 an exact known-length body without buffering the file.
  const stream = new FixedLengthStream(blob.expected_bytes),
    writer = stream.writable.getWriter(),
    reader = request.body.getReader();
  const header = new Uint8Array(Math.min(blob.expected_bytes, 65536));
  let total = 0,
    headLength = 0,
    timedOut = false;
  const abort = () => {
    timedOut = true;
    void reader.cancel().catch(() => {});
    void writer.abort(new Error("Upload interrupted")).catch(() => {});
  };
  const timer = setTimeout(abort, TRANSFER_TIMEOUT);
  request.signal.addEventListener("abort", abort, { once: true });
  let stored = false;
  try {
    const pump = (async () => {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.length;
          if (total > blob.expected_bytes)
            throw new AppError(400, "SIZE_MISMATCH", "The file size changed.");
          const take = Math.min(header.length - headLength, chunk.value.length);
          if (take) {
            header.set(chunk.value.subarray(0, take), headLength);
            headLength += take;
          }
          await writer.write(chunk.value);
        }
        if (timedOut || total !== blob.expected_bytes)
          throw new AppError(
            400,
            "UPLOAD_INTERRUPTED",
            "The upload was interrupted. Retry with a new attempt.",
          );
        await writer.close();
      } catch (error) {
        await writer.abort(error).catch(() => {});
        throw error;
      }
    })();
    const put = env.FILES.put(blob.object_key, stream.readable, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { claimId: claim, purpose: blob.purpose },
    }).catch((error: unknown) => {
      abort();
      throw error;
    });
    const results = await Promise.allSettled([pump, put]);
    const uploaded = results[1];
    if (uploaded.status === "fulfilled" && uploaded.value) stored = true;
    if (uploaded.status === "rejected") throw uploaded.reason;
    if (results[0].status === "rejected") throw results[0].reason;
    if (!uploaded.value) throw new Error("R2 did not store upload");
    await finishUpload(env, blob, uploaded.value.etag, header);
    return await uploadResult(env, id);
  } catch (error) {
    // A successful R2 write with a transient D1 failure stays durable for reconciliation.
    if (!stored || error instanceof AppError)
      await env.DB.prepare(
        "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id=? AND state='uploading' AND claim_id=?",
      )
        .bind(Date.now(), Date.now(), id, claim)
        .run();
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    writer.releaseLock();
  }
}
export async function cancelUpload(env: Env, id: string) {
  const now = Date.now();
  const result = await env.DB.prepare(
    "UPDATE blobs SET state='pending_delete',purge_after=MAX(lease_expires_at,?),updated_at=? WHERE id=? AND state IN ('reserved','uploading') RETURNING id",
  )
    .bind(now, now, id)
    .all();
  if (!result.results.length) {
    const blob = await env.DB.prepare("SELECT state FROM blobs WHERE id=?")
      .bind(id)
      .first<{ state: string }>();
    if (!blob)
      throw new AppError(404, "NOT_FOUND", "This upload is unavailable.");
    if (blob.state === "ready")
      throw new AppError(
        409,
        "UPLOAD_COMPLETE",
        "The upload completed. Delete the file if you no longer need it.",
      );
  }
}
