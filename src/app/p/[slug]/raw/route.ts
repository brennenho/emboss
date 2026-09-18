import { bindings } from "@/server/runtime";
import { publicResource, resourceDto } from "@/server/resource-store";
import { privateHeaders, unavailable } from "@/server/http";
import { slugSchema } from "@/shared/resources";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!slugSchema.safeParse(slug).success) return unavailable();
  const env = bindings();
  const row = await publicResource(env, "paste", slug);
  if (!row) return unavailable();
  const paste = await resourceDto(env, row, true);
  return new Response(request.method === "HEAD" ? null : paste.body, {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Length": String(new TextEncoder().encode(paste.body).length),
    },
  });
}
export const HEAD = GET;
