import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { database } from "./db";
import {
  blobs,
  files,
  idempotencyKeys,
  installation,
  links,
  pastes,
  resources,
} from "./db/schema";
import { config, type Env } from "./config";
import { AppError } from "../shared/errors";
import {
  available,
  canonicalUrl,
  displayState,
  generatedSlug,
  listSchema,
  type ResourceDto,
  type ResourceKind,
} from "../shared/resources";
import { sha256 } from "./auth/password";

const conflict = () =>
  new AppError(
    409,
    "CONFLICT",
    "This item changed in another tab. Reload it before saving.",
  );
export async function resourceDto(
  env: Env,
  row: typeof resources.$inferSelect,
  withBody = false,
): Promise<ResourceDto> {
  const db = database(env);
  const result: ResourceDto = {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    state: row.state,
    displayState: displayState(row),
    expiresAt:
      row.expiresAt === null ? null : new Date(row.expiresAt).toISOString(),
    revision: row.revision,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    url: canonicalUrl(config(env).origin, row.kind, row.slug),
  };
  if (row.kind === "link") {
    const link = await db
      .select()
      .from(links)
      .where(eq(links.resourceId, row.id))
      .get();
    result.destinationUrl = link?.destinationUrl;
  }
  if (row.kind === "paste") {
    const paste = await db
      .select()
      .from(pastes)
      .where(eq(pastes.resourceId, row.id))
      .get();
    result.format = paste?.format;
    result.language = paste?.language;
    if (withBody) result.body = paste?.body;
  }
  if (row.kind === "file") {
    const file = await db
      .select({
        filename: files.originalFilename,
        bytes: blobs.expectedBytes,
        state: blobs.state,
        type: blobs.detectedType,
        id: blobs.id,
      })
      .from(files)
      .innerJoin(blobs, eq(files.blobId, blobs.id))
      .where(eq(files.resourceId, row.id))
      .get();
    if (file) {
      result.filename = file.filename;
      result.bytes = file.bytes;
      result.uploadState = file.state;
      result.previewable = Boolean(file.type?.startsWith("image/"));
      result.uploadId = file.id;
    }
  }
  return result;
}
export async function listResources(
  env: Env,
  kind: ResourceKind,
  query: Record<string, unknown>,
) {
  const input = listSchema.parse(query);
  const now = Date.now();
  const filters = [eq(resources.kind, kind), isNull(resources.deletedAt)];
  if (input.q)
    filters.push(
      sql`(instr(lower(${resources.title}),lower(${input.q}))>0 OR instr(${resources.slug},lower(${input.q}))>0 OR EXISTS(SELECT 1 FROM links WHERE resource_id=${resources.id} AND instr(lower(destination_url),lower(${input.q}))>0))`,
    );
  if (input.state === "expired")
    filters.push(
      sql`${resources.expiresAt} IS NOT NULL AND ${resources.expiresAt}<=${now}`,
    );
  else if (input.state !== "all")
    filters.push(
      and(
        eq(resources.state, input.state),
        or(isNull(resources.expiresAt), sql`${resources.expiresAt}>${now}`),
      )!,
    );
  if (input.cursor) {
    let cursor: { at: number; id: string };
    try {
      cursor = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString(),
      ) as typeof cursor;
      if (!Number.isSafeInteger(cursor.at) || typeof cursor.id !== "string")
        throw new Error();
    } catch {
      throw new AppError(400, "INVALID_CURSOR", "Reload the list.");
    }
    filters.push(
      or(
        lt(resources.updatedAt, cursor.at),
        and(eq(resources.updatedAt, cursor.at), lt(resources.id, cursor.id)),
      )!,
    );
  }
  const rows = await database(env)
    .select()
    .from(resources)
    .where(and(...filters))
    .orderBy(desc(resources.updatedAt), desc(resources.id))
    .limit(input.limit + 1);
  const visible = rows.slice(0, input.limit),
    last = visible.at(-1);
  return {
    items: await Promise.all(visible.map((row) => resourceDto(env, row))),
    nextCursor:
      rows.length > input.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.updatedAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
export async function getResource(env: Env, kind: ResourceKind, id: string) {
  const row = await database(env)
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.id, id),
        eq(resources.kind, kind),
        isNull(resources.deletedAt),
      ),
    )
    .get();
  if (!row) throw new AppError(404, "NOT_FOUND", "This item is unavailable.");
  return resourceDto(env, row, true);
}
export async function publicResource(
  env: Env,
  kind: ResourceKind,
  slug: string,
) {
  const row = await database(env)
    .select()
    .from(resources)
    .where(and(eq(resources.kind, kind), eq(resources.slug, slug)))
    .get();
  if (!row || !available(row)) return null;
  return row;
}
type ContentInput = {
  title: string;
  slug?: string;
  state: "draft" | "active" | "disabled";
  expiresAt: string | null;
  destinationUrl?: string;
  body?: string;
  format?: "text" | "code" | "markdown";
  language?: string;
  expectedRevision?: number;
};
export async function validateContent(
  env: Env,
  kind: ResourceKind,
  input: ContentInput,
  slug: string,
) {
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : null;
  if (expiry !== null && expiry <= Date.now() && input.state === "active")
    throw new AppError(400, "VALIDATION", "Choose a future expiry.", {
      expiresAt: "Choose a future expiry before publishing.",
    });
  if (kind === "link" && input.destinationUrl) {
    const dest = new URL(input.destinationUrl);
    const self = new URL(canonicalUrl(config(env).origin, kind, slug));
    if (
      dest.origin === self.origin &&
      dest.pathname.replace(/\/$/, "") === self.pathname
    )
      throw new AppError(
        400,
        "VALIDATION",
        "The destination points to this short link.",
        { destinationUrl: "Choose a different destination." },
      );
  }
  if (kind === "paste") {
    const settings = await database(env).select().from(installation).get();
    if (
      new TextEncoder().encode(input.body ?? "").length >
      Math.min(settings!.pasteMaxBytes, config(env).PASTE_MAX_BYTES)
    )
      throw new AppError(
        413,
        "TOO_LARGE",
        "The paste exceeds the allowed byte limit.",
        { body: "The paste is too large." },
      );
  }
  return expiry;
}
export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new AppError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A valid idempotency key is required.",
    );
  return key;
}
export async function createResource(
  env: Env,
  kind: "link" | "paste",
  input: ContentInput,
  key: string,
) {
  const db = database(env),
    hash = await sha256(JSON.stringify(input)),
    operation = `create-${kind}`;
  const prior = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .get();
  if (prior) {
    if (prior.requestHash !== hash || prior.operation !== operation)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This action key was already used for different content.",
      );
    return getResource(env, kind, prior.resultId);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID(),
      slug = input.slug ?? generatedSlug(),
      now = Date.now();
    const expiresAt = await validateContent(env, kind, input, slug);
    if (expiresAt !== null && expiresAt <= now)
      throw new AppError(400, "VALIDATION", "Choose a future expiry.", {
        expiresAt: "Choose a future expiry.",
      });
    const title =
      input.title ||
      (kind === "link"
        ? new URL(input.destinationUrl!).hostname
        : "Untitled paste");
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO idempotency_keys(key,operation,request_hash,result_id,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING",
        ).bind(key, operation, hash, id, now, now + 86400000),
        env.DB.prepare(
          "INSERT INTO resources(id,kind,slug,title,state,expires_at,revision,created_at,updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE EXISTS(SELECT 1 FROM idempotency_keys WHERE key=? AND result_id=?)",
        ).bind(
          id,
          kind,
          slug,
          title,
          input.state,
          expiresAt,
          now,
          now,
          key,
          id,
        ),
        kind === "link"
          ? env.DB.prepare(
              "INSERT INTO links(resource_id,destination_url) SELECT ?,? WHERE EXISTS(SELECT 1 FROM resources WHERE id=?)",
            ).bind(id, input.destinationUrl!, id)
          : env.DB.prepare(
              "INSERT INTO pastes(resource_id,body,format,language) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM resources WHERE id=?)",
            ).bind(
              id,
              input.body!,
              input.format!,
              input.language ?? "text",
              id,
            ),
      ]);
    } catch (error) {
      if (
        String(error).includes(
          "UNIQUE constraint failed: resources.kind, resources.slug",
        )
      ) {
        if (!input.slug) continue;
        throw new AppError(
          409,
          "SLUG_TAKEN",
          "This address is already reserved.",
          { slug: "Choose another address." },
        );
      }
      throw error;
    }
    const saved = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .get();
    if (!saved || saved.requestHash !== hash || saved.operation !== operation)
      throw new AppError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This action key was already used.",
      );
    return getResource(env, kind, saved.resultId);
  }
  throw new AppError(
    503,
    "UNAVAILABLE",
    "Could not allocate an address. Try again.",
  );
}
export async function updateResource(
  env: Env,
  kind: ResourceKind,
  id: string,
  input: ContentInput,
) {
  const current = await getResource(env, kind, id);
  const expiresAt = await validateContent(env, kind, input, current.slug),
    now = Date.now();
  const condition =
    "EXISTS(SELECT 1 FROM resources WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL)";
  const statements: D1PreparedStatement[] = [];
  if (kind === "link")
    statements.push(
      env.DB.prepare(
        `UPDATE links SET destination_url=? WHERE resource_id=? AND ${condition}`,
      ).bind(input.destinationUrl!, id, id, kind, input.expectedRevision!),
    );
  if (kind === "paste")
    statements.push(
      env.DB.prepare(
        `UPDATE pastes SET body=?,format=?,language=? WHERE resource_id=? AND ${condition}`,
      ).bind(
        input.body!,
        input.format!,
        input.language ?? "text",
        id,
        id,
        kind,
        input.expectedRevision!,
      ),
    );
  statements.push(
    env.DB.prepare(
      "UPDATE resources SET title=?,state=?,expires_at=?,revision=revision+1,updated_at=? WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL RETURNING id",
    ).bind(
      input.title || current.title,
      input.state,
      expiresAt,
      now,
      id,
      kind,
      input.expectedRevision!,
    ),
  );
  let results: D1Result[];
  try {
    results = await env.DB.batch(statements);
  } catch (error) {
    if (String(error).includes("UPLOAD_NOT_READY"))
      throw new AppError(
        409,
        "UPLOAD_NOT_READY",
        "Finish uploading before publishing.",
      );
    throw error;
  }
  if (!results.at(-1)?.results.length) throw conflict();
  return getResource(env, kind, id);
}
export async function deleteResource(
  env: Env,
  kind: ResourceKind,
  id: string,
  revision: number,
) {
  const now = Date.now(),
    purge = now + config(env).DELETION_RETENTION_DAYS * 86400000;
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id IN(SELECT blob_id FROM files WHERE resource_id=?) AND EXISTS(SELECT 1 FROM resources WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL)",
    ).bind(purge, now, id, id, kind, revision),
    env.DB.prepare(
      "UPDATE resources SET state='deleted',deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL RETURNING id",
    ).bind(now, now, id, kind, revision),
  ]);
  if (!result[1]?.results.length) throw conflict();
}

export async function publicLink(env: Env, slug: string) {
  const row = await database(env)
    .select({
      destinationUrl: links.destinationUrl,
      state: resources.state,
      expiresAt: resources.expiresAt,
      deletedAt: resources.deletedAt,
    })
    .from(resources)
    .innerJoin(links, eq(links.resourceId, resources.id))
    .where(and(eq(resources.kind, "link"), eq(resources.slug, slug)))
    .get();
  return row && available(row) ? row.destinationUrl : null;
}
