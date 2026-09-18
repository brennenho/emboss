import { bindings } from "@/server/runtime";
import { readScheduling } from "@/server/configuration-store";
import { privateHeaders, unavailable } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  const data = await readScheduling(bindings());
  return data.enabled && data.destinationUrl
    ? new Response(null, {
        status: 302,
        headers: { ...privateHeaders, Location: data.destinationUrl },
      })
    : unavailable();
}
export const HEAD = GET;
