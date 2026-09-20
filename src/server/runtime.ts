import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "./auth/session";
import { AppError } from "../shared/errors";
import type { Env } from "./config";
import { cache } from "react";

export function bindings(): Env {
  return getCloudflareContext().env as unknown as Env;
}
async function resolveOwner(request?: Request) {
  const env = bindings();
  const h = request?.headers ?? (await headers());
  const session = await requireSession(env, h);
  return { env, session };
}
const pageContext = cache(() => resolveOwner());
// A Request is unique to one incoming call; no session survives across calls.
const requestContexts = new WeakMap<Request, ReturnType<typeof resolveOwner>>();
export function ownerContext(request?: Request) {
  if (!request) return pageContext();
  let context = requestContexts.get(request);
  if (!context) {
    context = resolveOwner(request);
    requestContexts.set(request, context);
  }
  return context;
}
export async function pageOwner() {
  try {
    return await ownerContext();
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect("/admin/login");
    throw error;
  }
}
