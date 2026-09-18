import { bindings } from "@/server/runtime";
import { unavailable } from "@/server/http";
import { serveBlob } from "@/server/storage/downloads";
import type { BlobRow } from "@/server/storage/uploads";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const env = bindings();
  const blob = await env.DB.prepare(
    "SELECT b.* FROM blobs b JOIN business_card c ON c.avatar_blob_id=b.id WHERE c.id=1 AND c.published=1 AND b.state='ready'",
  ).first<BlobRow>();
  return blob ? serveBlob(env, blob, request, "avatar", true) : unavailable();
}
export const HEAD = GET;
