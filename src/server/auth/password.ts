import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();
export const LOGIN_MAX_BYTES = 8192;
export function validPassword(password: string) {
  return password.length > 0;
}
export function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}
export async function sha256(value: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  ).toString("hex");
}
export function parseVerifier(encoded: string) {
  if (encoded.length > 256) throw new Error("Invalid password verifier");
  const parts = encoded.split("$");
  if (
    parts.length !== 5 ||
    parts[0] !== "emboss-v1" ||
    parts[1] !== "pbkdf2-sha256" ||
    parts[2] !== "600000" ||
    !parts[3]?.match(/^[A-Za-z0-9_-]{43}$/) ||
    !parts[4]?.match(/^[A-Za-z0-9_-]{43}$/)
  )
    throw new Error("Invalid password verifier");
  const salt = Buffer.from(parts[3], "base64url"),
    hash = Buffer.from(parts[4], "base64url");
  if (
    salt.length !== 32 ||
    hash.length !== 32 ||
    salt.toString("base64url") !== parts[3] ||
    hash.toString("base64url") !== parts[4]
  )
    throw new Error("Invalid password verifier");
  return { salt, hash };
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return Buffer.from(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt },
      key,
      256,
    ),
  );
}
export async function createVerifier(password: string) {
  if (!validPassword(password)) throw new Error("Enter a password.");
  // Setup must not accept a password that cannot fit in a sign-in request.
  if (encoder.encode(JSON.stringify({ password })).length > LOGIN_MAX_BYTES)
    throw new Error("The password exceeds the 8 KiB sign-in request limit.");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const hash = await derive(password, salt);
  return `emboss-v1$pbkdf2-sha256$600000$${Buffer.from(salt).toString("base64url")}$${hash.toString("base64url")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const { salt, hash } = parseVerifier(encoded);
  if (!validPassword(password)) return false;
  return timingSafeEqual(await derive(password, new Uint8Array(salt)), hash);
}
