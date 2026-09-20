import { ownerContext } from "@/server/runtime";
import { endpoint, json } from "@/server/http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return endpoint("GET /api/admin/session", async () => {
    const { session } = await ownerContext(request);
    return json({
      authenticated: true,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });
}
