import { bindings } from "@/server/runtime";
import { database } from "@/server/db";
import { businessCard, installation } from "@/server/db/schema";
import { privateHeaders, unavailable } from "@/server/http";
import { config } from "@/server/config";
export const dynamic = "force-dynamic";
export async function GET() {
  const env = bindings(),
    db = database(env);
  const settings = await db
    .select({ website: installation.websiteUrl })
    .from(installation)
    .get();
  if (settings?.website)
    return new Response(null, {
      status: 302,
      headers: { ...privateHeaders, Location: settings.website },
    });
  const card = await db
    .select({ published: businessCard.published })
    .from(businessCard)
    .get();
  return card?.published
    ? new Response(null, {
        status: 302,
        headers: {
          ...privateHeaders,
          Location: config(env).origin + "/contact",
        },
      })
    : unavailable();
}
export const HEAD = GET;
