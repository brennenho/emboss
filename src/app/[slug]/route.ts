import { bindings } from "@/server/runtime";
import { publicLink } from "@/server/resource-store";
import { slugSchema } from "@/shared/resources";
import { privateHeaders, unavailable } from "@/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slugSchema.safeParse(slug).success) return unavailable();
  const env = bindings();
  const destination = await publicLink(env, slug);
  return destination
    ? new Response(null, {
        status: 302,
        headers: { ...privateHeaders, Location: destination },
      })
    : unavailable();
}
export const HEAD = GET;
