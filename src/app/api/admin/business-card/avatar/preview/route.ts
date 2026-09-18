import { ownerContext } from "@/server/runtime";
import { endpoint, unavailable } from "@/server/http";
import { serveBlob } from "@/server/storage/downloads";
import type { BlobRow } from "@/server/storage/uploads";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint(async () => {
    const { env } = await ownerContext(request);
    const id = new URL(request.url).searchParams.get("id");
    const blob = id
      ? await env.DB.prepare(
          "SELECT * FROM blobs WHERE id=? AND purpose='avatar' AND state='ready'",
        )
          .bind(id)
          .first<BlobRow>()
      : await env.DB.prepare(
          "SELECT b.* FROM blobs b JOIN business_card c ON c.avatar_blob_id=b.id WHERE c.id=1 AND b.state='ready'",
        ).first<BlobRow>();
    return blob ? serveBlob(env, blob, request, "avatar", true) : unavailable();
  });
}
export const HEAD = GET;
