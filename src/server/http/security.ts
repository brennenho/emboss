import type { Env } from "../config";
import { config } from "../config";
import { slugSchema } from "../../shared/resources";
import { unavailable } from "./index";
export function prepareRequest(request: Request, env: Env) {
  const url = new URL(request.url),
    c = config(env);
  if (url.origin !== c.origin) return { response: unavailable() };
  const path = url.pathname;
  if (
    !path.startsWith("/_next/") &&
    !path.startsWith("/licenses/") &&
    (/%|\\/.test(path) || path.includes("//"))
  )
    return { response: unavailable() };
  if (path !== "/" && path.endsWith("/")) {
    const candidate = path.slice(0, -1),
      parts = candidate.slice(1).split("/");
    const valid =
      /^\/(admin|api)(\/|$)/.test(candidate) ||
      [
        "/contact",
        "/contact.vcf",
        "/contact/avatar",
        "/meet",
        "/robots.txt",
      ].includes(candidate) ||
      (parts.length === 1 && slugSchema.safeParse(parts[0]).success) ||
      ((parts[0] === "p" || parts[0] === "f") &&
        slugSchema.safeParse(parts[1]).success &&
        (parts.length === 2 ||
          (parts.length === 3 &&
            (parts[0] === "p"
              ? parts[2] === "raw"
              : ["download", "preview"].includes(parts[2]!)))));
    if (!valid) return { response: unavailable() };
    return {
      response: new Response(null, {
        status: 307,
        headers: {
          Location: c.origin + path.slice(0, -1) + url.search,
          "Cache-Control": "no-store",
        },
      }),
    };
  }
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(18)),
  ).toString("base64");
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  headers.set("x-nonce", nonce);
  return { request: new Request(request, { headers }), csp };
}
export function secureResponse(response: Response, csp: string, path: string) {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!result.headers.has("Content-Security-Policy"))
    result.headers.set("Content-Security-Policy", csp);
  if (!path.startsWith("/_next/static/"))
    result.headers.set("Cache-Control", "no-store");
  return result;
}
