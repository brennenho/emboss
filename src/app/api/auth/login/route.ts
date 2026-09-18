import { z } from "zod";
import { bindings } from "@/server/runtime";
import { login, sessionCookie } from "@/server/auth/session";
import { LOGIN_MAX_BYTES } from "@/server/auth/password";
import { checkIntent, endpoint, json, readJson } from "@/server/http";
import { config } from "@/server/config";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return endpoint(async () => {
    const env = bindings();
    checkIntent(request, env);
    const { password } = await readJson(
      request,
      z.object({ password: z.string().min(1, "Enter a password.") }).strict(),
      LOGIN_MAX_BYTES,
    );
    const result = await login(env, request.headers, password);
    const response = json({
      expiresAt: new Date(result.expiresAt).toISOString(),
    });
    response.headers.set(
      "Set-Cookie",
      sessionCookie(env, result.token, config(env).SESSION_TTL_SECONDS),
    );
    return response;
  });
}
