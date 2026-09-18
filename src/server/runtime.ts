import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "./auth/session";
import { AppError } from "../shared/errors";
import type { Env } from "./config";

export function bindings(): Env {
  return getCloudflareContext().env as unknown as Env;
}
export async function ownerContext(request?: Request) {
  const env = bindings();
  const h = request?.headers ?? (await headers());
  const session = await requireSession(env, h);
  return { env, session };
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
