import { and, eq, gt, sql } from "drizzle-orm";
import { config, type Env } from "../config";
import { database } from "../db";
import { adminSessions, authState } from "../db/schema";
import { AppError } from "../../shared/errors";
import { parseVerifier, randomToken, sha256, verifyPassword } from "./password";

export function cookieName(env: Env) {
  return config(env).localHttp ? "emboss_session_dev" : "__Host-emboss_session";
}
export function readToken(headers: Headers, env: Env) {
  const name = cookieName(env);
  const cookie = headers.get("cookie") ?? "";
  const tokens = cookie
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith(`${name}=`));
  if (tokens.length !== 1) return null;
  const token = tokens[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function sessionCookie(env: Env, token: string, maxAge: number) {
  return `${cookieName(env)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config(env).localHttp ? "" : "; Secure"}`;
}
async function credential(env: Env) {
  if (!env.ADMIN_PASSWORD_HASH)
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "Admin access is not configured.",
    );
  try {
    parseVerifier(env.ADMIN_PASSWORD_HASH);
  } catch {
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "Admin access is not configured.",
    );
  }
  return sha256(env.ADMIN_PASSWORD_HASH);
}
export async function requireSession(
  env: Env,
  headers: Headers,
  now = Date.now(),
) {
  const token = readToken(headers, env);
  if (!token) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
  const credentialId = await credential(env);
  const db = database(env);
  const row = await db
    .select({ expiresAt: adminSessions.expiresAt })
    .from(adminSessions)
    .innerJoin(
      authState,
      and(
        eq(authState.id, 1),
        eq(authState.activeCredentialId, adminSessions.credentialId),
        eq(authState.sessionGeneration, adminSessions.sessionGeneration),
      ),
    )
    .where(
      and(
        eq(adminSessions.tokenHash, await sha256(token)),
        eq(adminSessions.credentialId, credentialId),
        gt(adminSessions.expiresAt, now),
      ),
    )
    .get();
  if (!row)
    throw new AppError(
      401,
      "UNAUTHORIZED",
      "Your session has expired. Sign in to continue.",
    );
  return { expiresAt: row.expiresAt };
}
export async function login(
  env: Env,
  headers: Headers,
  password: string,
  now = Date.now(),
) {
  const c = config(env);
  const ip = c.localHttp
    ? "local-development"
    : headers.get("cf-connecting-ip");
  if (!ip || !env.LOGIN_RATE_LIMITER)
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "Sign-in is temporarily unavailable.",
    );
  if (!(await env.LOGIN_RATE_LIMITER.limit({ key: ip })).success)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many sign-in attempts. Try again in one minute.",
    );
  const credentialId = await credential(env),
    db = database(env);
  const state = await db
    .select()
    .from(authState)
    .where(eq(authState.id, 1))
    .get();
  if (!state || state.activeCredentialId !== credentialId)
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "Admin access needs operator attention.",
    );
  if (!(await verifyPassword(password, env.ADMIN_PASSWORD_HASH!)))
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "The password is incorrect.",
    );
  const token = randomToken(),
    tokenHash = await sha256(token),
    expiresAt = now + c.SESSION_TTL_SECONDS * 1000;
  // Inserting against the current generation prevents a rotation racing the KDF from issuing a valid old session.
  const result = await db.run(
    sql`INSERT INTO admin_sessions(token_hash,credential_id,session_generation,created_at,expires_at) SELECT ${tokenHash},${credentialId},${state.sessionGeneration},${now},${expiresAt} FROM auth_state WHERE id=1 AND active_credential_id=${credentialId} AND session_generation=${state.sessionGeneration}`,
  );
  if (result.meta.changes !== 1)
    throw new AppError(
      503,
      "AUTH_UNAVAILABLE",
      "Admin access changed. Try signing in again.",
    );
  const previous = readToken(headers, env);
  if (previous)
    await db
      .delete(adminSessions)
      .where(eq(adminSessions.tokenHash, await sha256(previous)));
  return { token, expiresAt };
}
export async function logout(env: Env, headers: Headers) {
  const token = readToken(headers, env);
  if (token)
    await database(env)
      .delete(adminSessions)
      .where(eq(adminSessions.tokenHash, await sha256(token)));
}
