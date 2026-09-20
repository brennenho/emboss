import { ownerContext } from "@/server/runtime";
import { findFile, serveBlob } from "@/server/storage/downloads";
import { endpoint, unavailable } from "@/server/http";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint("GET /api/admin/files/[id]/download", async () => {
    const { env } = await ownerContext(request);
    const value = (await params).id;
    const file = await findFile(env, value, true);
    if (!file) return unavailable();
    return serveBlob(env, file, request, file.original_filename, false);
  });
}
export const HEAD = GET;
