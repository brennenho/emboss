import { bindings } from "@/server/runtime";
import { logout, sessionCookie } from "@/server/auth/session";
import { checkIntent, endpoint, privateHeaders } from "@/server/http";
export function POST(request: Request) {
  return endpoint("POST /api/auth/logout", async () => {
    const env = bindings();
    checkIntent(request, env);
    await logout(env, request.headers);
    return new Response(null, {
      status: 204,
      headers: { ...privateHeaders, "Set-Cookie": sessionCookie(env, "", 0) },
    });
  });
}
