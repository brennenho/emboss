import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import {
  createVerifier,
  LOGIN_MAX_BYTES,
  parseVerifier,
  randomToken,
  sha256,
  validPassword,
  verifyPassword,
} from "../../src/server/auth/password";
import {
  cookieName,
  login,
  logout,
  requireSession,
  sessionCookie,
} from "../../src/server/auth/session";
import { checkIntent } from "../../src/server/http";

const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const password = "Local test password, with Unicode 🫖";
let verifier: string;
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  verifier = await createVerifier(password);
});
beforeEach(async () => {
  env.ADMIN_PASSWORD_HASH = verifier;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions"),
    env.DB.prepare(
      "INSERT OR REPLACE INTO auth_state(id,active_credential_id,session_generation,updated_at) VALUES(1,?,?,?)",
    ).bind(await sha256(verifier), randomToken(), Date.now()),
  ]);
});
function headers(token: string) {
  return new Headers({ cookie: `${cookieName(env)}=${token}` });
}
describe("password and sessions in workerd", () => {
  it("uses the full 600,000 iteration KDF and agrees with an independent Node primitive", async () => {
    const parsed = parseVerifier(verifier);
    expect(
      parsed.hash.equals(
        pbkdf2Sync(password, parsed.salt, 600000, 32, "sha256"),
      ),
    ).toBe(true);
    expect(await verifyPassword(password, verifier)).toBe(true);
    expect(await verifyPassword(password + "x", verifier)).toBe(false);
    expect(() => parseVerifier(verifier.replace("600000", "1"))).toThrow();
  });
  it.each(["a", " short ", " ", "🫖".repeat(300)])(
    "accepts nonempty passwords without character-count or composition rules (case %#)",
    async (candidate) => {
      const encoded = await createVerifier(candidate);
      expect(await verifyPassword(candidate, encoded)).toBe(true);
      expect(await verifyPassword(candidate + "x", encoded)).toBe(false);
    },
  );
  it("requires a password and prevents setup beyond the sign-in request size", async () => {
    expect(validPassword("")).toBe(false);
    await expect(createVerifier("")).rejects.toThrow("Enter a password.");
    expect(await verifyPassword("", verifier)).toBe(false);
    const overhead = new TextEncoder().encode(
      JSON.stringify({ password: "" }),
    ).length;
    const fits = "a".repeat(LOGIN_MAX_BYTES - overhead);
    expect(await verifyPassword(fits, await createVerifier(fits))).toBe(true);
    await expect(createVerifier(fits + "a")).rejects.toThrow(
      "sign-in request limit",
    );
    await expect(
      createVerifier("🫖".repeat(LOGIN_MAX_BYTES / 4)),
    ).rejects.toThrow("sign-in request limit");
  });
  it("issues opaque sessions, enforces exact expiry, and revokes on logout", async () => {
    const issued = await login(env, new Headers(), password);
    expect(issued.token).toMatch(/^[\w-]{43}$/);
    const stored = await env.DB.prepare(
      "SELECT token_hash FROM admin_sessions",
    ).first<{ token_hash: string }>();
    expect(stored?.token_hash).toBe(await sha256(issued.token));
    expect(stored?.token_hash).not.toBe(issued.token);
    expect(await requireSession(env, headers(issued.token))).toEqual({
      expiresAt: issued.expiresAt,
    });
    await expect(
      requireSession(env, headers(issued.token), issued.expiresAt),
    ).rejects.toMatchObject({ status: 401 });
    await logout(env, headers(issued.token));
    await expect(
      requireSession(env, headers(issued.token)),
    ).rejects.toMatchObject({ status: 401 });
    await logout(env, headers(issued.token));
  });
  it("rejects missing and malformed tokens and superseded credentials", async () => {
    await expect(requireSession(env, new Headers())).rejects.toMatchObject({
      status: 401,
    });
    await expect(requireSession(env, headers("invalid"))).rejects.toMatchObject(
      { status: 401 },
    );
    const issued = await login(env, new Headers(), password);
    await env.DB.prepare("UPDATE auth_state SET session_generation=?")
      .bind(randomToken())
      .run();
    await expect(
      requireSession(env, headers(issued.token)),
    ).rejects.toMatchObject({ status: 401 });
    env.ADMIN_PASSWORD_HASH = await createVerifier(password + "new");
    await expect(
      login(env, new Headers(), password + "new"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("rejects cross-origin requests and uses secure production cookie attributes", () => {
    for (const origin of [null, "https://attacker.example"]) {
      const h = new Headers({
        "content-type": "application/json",
        "x-emboss-request": "1",
      });
      if (origin) h.set("origin", origin);
      expect(() =>
        checkIntent(
          new Request("http://localhost:3000/api/auth/login", {
            method: "POST",
            headers: h,
          }),
          env,
        ),
      ).toThrow();
    }
    const prod = {
      ...env,
      APP_ENV: "production",
      APP_BASE_URL: "https://example.com",
    };
    const cookie = sessionCookie(prod, "opaque", 604800);
    expect(cookie).toContain("__Host-emboss_session=");
    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain("Domain");
  });
  it("limits attempts before reading an invalid verifier", async () => {
    const denied = {
      ...env,
      ADMIN_PASSWORD_HASH: "invalid",
      LOGIN_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      } as RateLimit,
    };
    await expect(login(denied, new Headers(), password)).rejects.toMatchObject({
      status: 429,
    });
  });
  it("fails closed when rotation races a login, then recovers with the intended verifier", async () => {
    const nextVerifier = await createVerifier(password + " rotated");
    let rotated = false;
    const racing = {
      ...env,
      LOGIN_RATE_LIMITER: {
        limit: async () => ({ success: true }),
      } as RateLimit,
      DB: {
        prepare: (query: string) => {
          const stmt = env.DB.prepare(query);
          if (query.startsWith("select") && query.includes('from "auth_state"'))
            return {
              bind: (...values: unknown[]) => {
                const bound = stmt.bind(...values);
                return {
                  raw: async () => {
                    const snapshot = await bound.raw();
                    await env.DB.prepare(
                      "UPDATE auth_state SET active_credential_id=?,session_generation=? WHERE id=1",
                    )
                      .bind(await sha256(nextVerifier), randomToken())
                      .run();
                    rotated = true;
                    return snapshot;
                  },
                };
              },
            };
          return stmt;
        },
      },
    } as unknown as Env;
    await expect(login(racing, new Headers(), password)).rejects.toMatchObject({
      status: 503,
    });
    expect(rotated).toBe(true);
    expect(
      await env.DB.prepare("SELECT count(*) count FROM admin_sessions").first(
        "count",
      ),
    ).toBe(0);
    const recovered = {
      ...env,
      ADMIN_PASSWORD_HASH: nextVerifier,
      LOGIN_RATE_LIMITER: {
        limit: async () => ({ success: true }),
      } as RateLimit,
    };
    const issued = await login(recovered, new Headers(), password + " rotated");
    expect(await requireSession(recovered, headers(issued.token))).toEqual({
      expiresAt: issued.expiresAt,
    });
    await env.DB.prepare(
      "UPDATE auth_state SET session_generation=? WHERE id=1",
    )
      .bind(randomToken())
      .run();
    expect(
      await env.DB.prepare("SELECT count(*) count FROM admin_sessions").first(
        "count",
      ),
    ).toBe(0);
  });
});
