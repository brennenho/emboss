import { ownerContext } from "@/server/runtime";
import { endpoint } from "@/server/http";
import { metadataExport } from "@/server/export";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint(async () => {
    const { env } = await ownerContext(request);
    return metadataExport(env);
  });
}
