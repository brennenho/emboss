import type { Env } from "../config";
import { publicCard } from "../configuration-store";
import { publicResource } from "../resource-store";
import { findFile } from "../storage/downloads";
import { slugSchema } from "../../shared/resources";

// Next can commit a 200 before an async page calls notFound(). Check these
// document routes before rendering so revoked shares also have a real 404.
// Pages still recheck availability before reading or rendering their content.
export async function publicPageAvailable(path: string, env: Env) {
  if (path === "/contact") return !!(await publicCard(env));
  const match = /^\/(p|f)\/([^/]+)$/.exec(path);
  if (!match) return true;
  const slug = slugSchema.safeParse(match[2]);
  if (!slug.success) return false;
  return match[1] === "p"
    ? !!(await publicResource(env, "paste", slug.data))
    : !!(await findFile(env, slug.data));
}
