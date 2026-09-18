import { bindings } from "@/server/runtime";
import { publicCard } from "@/server/configuration-store";
import { privateHeaders, unavailable } from "@/server/http";
import { config } from "@/server/config";
import { attachment } from "@/server/storage/downloads";
import { vCard } from "@/shared/vcard";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const env = bindings(),
    card = await publicCard(env);
  if (!card) return unavailable();
  return new Response(
    request.method === "HEAD"
      ? null
      : vCard(card, config(env).origin + "/contact"),
    {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": attachment(`${card.displayName}.vcf`),
      },
    },
  );
}
export const HEAD = GET;
