import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Env } from "../config";
export function database(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}
