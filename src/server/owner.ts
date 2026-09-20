import "server-only";
import { cache } from "react";
import { ownerContext } from "./runtime";
import { database } from "./db";
import { installation } from "./db/schema";
import { checkWrite } from "./http";
import * as store from "./resource-store";
import {
  linkSchema,
  pasteSchema,
  linkUpdateSchema,
  pasteUpdateSchema,
  fileUpdateSchema,
  revisionSchema,
  type ResourceKind,
} from "@/shared/resources";
async function readOwnerSettings(request?: Request) {
  const { env } = await ownerContext(request);
  const settings = await database(env).select().from(installation).get();
  if (!settings) throw new Error("Missing installation");
  return settings;
}
const pageSettings = cache(() => readOwnerSettings());
export function ownerSettings(request?: Request) {
  return request ? readOwnerSettings(request) : pageSettings();
}
export async function ownerList(
  kind: ResourceKind,
  query: Record<string, unknown>,
  request?: Request,
) {
  const { env } = await ownerContext(request);
  return store.listResources(env, kind, query);
}
export async function ownerResource(
  kind: ResourceKind,
  id: string,
  request?: Request,
) {
  const { env } = await ownerContext(request);
  return store.getResource(env, kind, id);
}
export async function ownerCreate(
  kind: "link" | "paste",
  input: unknown,
  key: string,
  request: Request,
) {
  const { env } = await ownerContext(request);
  await checkWrite(env);
  return store.createResource(
    env,
    kind,
    (kind === "link" ? linkSchema.strict() : pasteSchema.strict()).parse(input),
    key,
  );
}
export async function ownerUpdate(
  kind: ResourceKind,
  id: string,
  input: unknown,
  request: Request,
) {
  const { env } = await ownerContext(request);
  await checkWrite(env);
  const schema =
    kind === "link"
      ? linkUpdateSchema
      : kind === "paste"
        ? pasteUpdateSchema
        : fileUpdateSchema;
  return store.updateResource(env, kind, id, schema.parse(input));
}
export async function ownerDelete(
  kind: ResourceKind,
  id: string,
  input: unknown,
  request: Request,
) {
  const { env } = await ownerContext(request);
  await checkWrite(env);
  return store.deleteResource(
    env,
    kind,
    id,
    revisionSchema.parse(input).expectedRevision,
  );
}

export async function ownerConfiguration(
  kind: "scheduling" | "business-card",
  request?: Request,
) {
  const { env } = await ownerContext(request);
  const { readScheduling, readCard } = await import("./configuration-store");
  return kind === "scheduling" ? readScheduling(env) : readCard(env);
}
