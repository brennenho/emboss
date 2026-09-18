import { bindings } from "@/server/runtime";
import { findFile, serveBlob } from "@/server/storage/downloads";
import { endpoint, unavailable } from "@/server/http";
import { slugSchema } from "@/shared/resources";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return endpoint(async () => {
    const env = bindings();
    const value = (await params).slug;
    if (!slugSchema.safeParse(value).success) return unavailable();
    const file = await findFile(env, value, false);
    if (!file) return unavailable();
    return serveBlob(env, file, request, file.original_filename, true);
  });
}
export const HEAD = GET;
