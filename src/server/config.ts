import { z } from "zod";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  LOGIN_RATE_LIMITER: RateLimit;
  WRITE_RATE_LIMITER: RateLimit;
  ADMIN_PASSWORD_HASH?: string;
  APP_ENV: string;
  APP_BASE_URL: string;
  SESSION_TTL_SECONDS: string;
  UPLOAD_MAX_BYTES: string;
  STORAGE_QUOTA_BYTES: string;
  PASTE_MAX_BYTES: string;
  DELETION_RETENTION_DAYS: string;
  READ_ONLY_MODE: string;
}
const positive = (max: number) => z.coerce.number().int().positive().max(max);
const configSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]),
  APP_BASE_URL: z.string().url(),
  SESSION_TTL_SECONDS: positive(604800),
  UPLOAD_MAX_BYTES: positive(26214400),
  STORAGE_QUOTA_BYTES: positive(1024 ** 4),
  PASTE_MAX_BYTES: positive(262144),
  DELETION_RETENTION_DAYS: positive(365),
  READ_ONLY_MODE: z.enum(["true", "false"]),
});
export function config(env: Env) {
  const c = configSchema.parse(env);
  const url = new URL(c.APP_BASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(local && c.APP_ENV === "development" && url.protocol === "http:"))
  )
    throw new Error("Invalid canonical origin configuration");
  return {
    ...c,
    origin: url.origin,
    localHttp: local && c.APP_ENV === "development" && url.protocol === "http:",
  };
}
