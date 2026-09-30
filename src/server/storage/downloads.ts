import type { Env } from "../config";
import { privateHeaders, unavailable } from "../http";
import { AppError } from "../../shared/errors";
import type { BlobRow } from "./uploads";
export type FileObject = BlobRow & {
  original_filename: string;
  title: string;
  slug: string;
  expires_at: number | null;
};
export async function findFile(
  env: Env,
  value: string,
  owner = false,
): Promise<FileObject | null> {
  return env.DB.prepare(
    `SELECT b.*,f.original_filename,r.title,r.slug,r.expires_at FROM resources r JOIN files f ON f.resource_id=r.id JOIN blobs b ON b.id=f.blob_id WHERE r.kind='file' AND r.${owner ? "id" : "slug"}=? AND r.deleted_at IS NULL AND b.state='ready' ${owner ? "" : "AND r.state='active' AND (r.expires_at IS NULL OR r.expires_at>?)"}`,
  )
    .bind(...(owner ? [value] : [value, Date.now()]))
    .first<FileObject>();
}
export function attachment(filename: string) {
  filename = new TextDecoder()
    .decode(new TextEncoder().encode(filename))
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_");
  const ascii =
    filename.replace(/[^\x20-\x7e]|["\\/;]/g, "_").slice(0, 180) || "download";
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
export function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]))
    throw new AppError(416, "INVALID_RANGE", "Unsupported byte range.");
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new AppError(416, "INVALID_RANGE", "Invalid range.");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start > end
  )
    throw new AppError(416, "INVALID_RANGE", "Invalid range.");
  return { offset: start, length: end - start + 1 };
}
export async function serveBlob(
  env: Env,
  blob: BlobRow,
  request: Request,
  filename: string,
  preview = false,
) {
  if (
    blob.state !== "ready" ||
    (preview &&
      !["image/png", "image/jpeg", "image/webp"].includes(
        blob.detected_type ?? "",
      ))
  )
    return unavailable();
  // Availability has already been checked before interpreting conditional/range headers.
  const head = await env.FILES.head(blob.object_key);
  if (!head || head.size !== blob.expected_bytes) return unavailable();
  let range;
  try {
    range = request.headers.has("if-range")
      ? null
      : parseRange(request.headers.get("range"), head.size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { ...privateHeaders, "Content-Range": `bytes */${head.size}` },
    });
  }
  const headers = new Headers({
    ...privateHeaders,
    "Content-Type": preview ? blob.detected_type! : "application/octet-stream",
    "Content-Disposition": preview ? "inline" : attachment(filename),
    "Accept-Ranges": "bytes",
    "Content-Length": String(range?.length ?? head.size),
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
    );
  if (request.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.FILES.get(
    blob.object_key,
    range ? { range } : undefined,
  );
  if (!object) return unavailable();
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

const TEXT_PREVIEW_BYTES = 64 * 1024;
const textFilename =
  /\.(?:txt|md|markdown|csv|tsv|json|jsonl|log|yaml|yml|toml|ini|xml|html?|svg|css|[cm]?js|jsx|tsx?|py|sql|sh|bash|rs|go|java|rb|c|h|cpp)$/i;

// Read a bounded prefix only. The caller must first resolve this file through
// findFile's public availability gate. Render the result as text, never HTML.
export async function fileTextPreview(env: Env, file: FileObject) {
  if (file.state !== "ready" || !textFilename.test(file.original_filename))
    return null;
  const object = await env.FILES.get(file.object_key, {
    range: { offset: 0, length: TEXT_PREVIEW_BYTES },
  });
  if (!object || object.size !== file.expected_bytes) {
    await object?.body.cancel();
    return null;
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  const truncated = file.expected_bytes > TEXT_PREVIEW_BYTES;
  let text: string;
  try {
    // A truncated final UTF-8 character is left out, not shown as corruption.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
      stream: truncated,
    });
  } catch {
    return null;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return { text, truncated };
}
