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
  resourceAddresses,
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
  type TrashResourceDto,
  type TrashResourcePage,
} from "../shared/resources";
import { sha256 } from "./auth/password";

const conflict = () =>
  new AppError(
    409,
    "CONFLICT",
    "Changed in another tab. Review the latest version before continuing.",
  );
function baseDto(env: Env, row: typeof resources.$inferSelect) {
  return {
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
  } satisfies ResourceDto;
}
export async function resourceDto(
  env: Env,
  row: typeof resources.$inferSelect,
  withBody = false,
): Promise<ResourceDto> {
  const db = database(env);
  const result: ResourceDto = baseDto(env, row);
  if (row.kind === "link") {
    const link = await db
      .select()
      .from(links)
      .where(eq(links.resourceId, row.id))
      .get();
    result.destinationUrl = link?.destinationUrl;
    const aliases = await db
      .select({ slug: resourceAddresses.slug })
      .from(resourceAddresses)
      .where(
        and(
          eq(resourceAddresses.resourceId, row.id),
          eq(resourceAddresses.state, "active"),
          sql`${resourceAddresses.slug} != ${row.slug}`,
        ),
      );
    result.aliases = aliases.map((address) => address.slug);
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
  // Project subtype metadata in one query. Paste bodies never enter a list response.
  const rows = await database(env)
    .select({
      resource: resources,
      destinationUrl: links.destinationUrl,
      format: pastes.format,
      language: pastes.language,
      filename: files.originalFilename,
      bytes: blobs.expectedBytes,
      uploadState: blobs.state,
      detectedType: blobs.detectedType,
      uploadId: blobs.id,
    })
    .from(resources)
    .leftJoin(links, eq(links.resourceId, resources.id))
    .leftJoin(pastes, eq(pastes.resourceId, resources.id))
    .leftJoin(files, eq(files.resourceId, resources.id))
    .leftJoin(blobs, eq(blobs.id, files.blobId))
    .where(and(...filters))
    .orderBy(desc(resources.updatedAt), desc(resources.id))
    .limit(input.limit + 1);
  const visible = rows.slice(0, input.limit),
    last = visible.at(-1)?.resource;
  return {
    items: visible.map((row): ResourceDto => ({
      ...baseDto(env, row.resource),
      ...(kind === "link"
        ? { destinationUrl: row.destinationUrl ?? undefined }
        : kind === "paste"
          ? {
              format: row.format ?? undefined,
              language: row.language ?? undefined,
            }
          : {
              filename: row.filename ?? undefined,
              bytes: row.bytes ?? undefined,
              uploadState: row.uploadState ?? undefined,
              uploadId: row.uploadId ?? undefined,
              previewable: Boolean(row.detectedType?.startsWith("image/")),
            }),
    })),
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
    .select({ resource: resources })
    .from(resourceAddresses)
    .innerJoin(resources, eq(resources.id, resourceAddresses.resourceId))
    .where(
      and(
        eq(resourceAddresses.kind, kind),
        eq(resourceAddresses.slug, slug),
        eq(resourceAddresses.state, "active"),
        isNull(resources.deletedAt),
      ),
    )
    .get();
  if (!row || !available(row.resource)) return null;
  return row.resource;
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
  previousAddress?: "alias" | "retire";
};
export async function validateContent(
  env: Env,
  kind: ResourceKind,
  input: ContentInput,
  slug: string,
) {
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : null;
  if (expiry !== null && expiry <= Date.now() && input.state === "active")
    throw new AppError(400, "VALIDATION", "Choose a future date and time.", {
      expiresAt: "Choose a future date and time before publishing.",
    });
  if (kind === "link" && input.destinationUrl) {
    const dest = new URL(input.destinationUrl);
    const self = new URL(canonicalUrl(config(env).origin, kind, slug));
    if (
      dest.origin === self.origin &&
      decodedPath(dest.pathname).replace(/\/$/, "") === self.pathname
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
        "This paste exceeds the size limit.",
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
      slug = input.slug ?? generatedSlug(kind),
      now = Date.now();
    const expiresAt = await validateContent(env, kind, input, slug);
    if (expiresAt !== null && expiresAt <= now)
      throw new AppError(400, "VALIDATION", "Choose a future date and time.", {
        expiresAt: "Choose a future date and time.",
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
        ) ||
        String(error).includes(
          "UNIQUE constraint failed: resource_addresses.kind, resource_addresses.slug",
        )
      ) {
        if (!input.slug) continue;
        throw new AppError(
          409,
          "SLUG_TAKEN",
          "This address is already in use.",
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
    "Could not create an address. Try again.",
  );
}
export async function updateResource(
  env: Env,
  kind: ResourceKind,
  id: string,
  input: ContentInput,
) {
  const current = await getResource(env, kind, id);
  if (current.revision !== input.expectedRevision) throw conflict();
  const slug = kind === "link" ? (input.slug ?? current.slug) : current.slug;
  const expiresAt = await validateContent(env, kind, input, slug),
    now = Date.now();
  if (kind === "link" && input.destinationUrl) {
    const destination = new URL(input.destinationUrl);
    if (destination.origin === config(env).origin) {
      const target = decodedPath(destination.pathname).replace(/^\/|\/$/g, "");
      const owned = await dbOwnedAddress(env, id, target);
      if (
        owned &&
        !(
          input.previousAddress === "retire" &&
          target === current.slug &&
          slug !== current.slug
        )
      )
        throw new AppError(
          400,
          "VALIDATION",
          "The destination points to this link's address.",
          { destinationUrl: "Choose a different destination." },
        );
    }
  }
  const condition =
    "EXISTS(SELECT 1 FROM resources WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL)";
  const statements: D1PreparedStatement[] = [];
  if (
    kind === "link" &&
    slug !== current.slug &&
    input.previousAddress === "retire"
  )
    statements.push(
      env.DB.prepare(
        `UPDATE resource_addresses SET state='retired' WHERE resource_id=? AND slug=? AND ${condition}`,
      ).bind(id, current.slug, id, kind, input.expectedRevision!),
    );
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
      "UPDATE resources SET slug=?,title=?,state=?,expires_at=?,revision=revision+1,updated_at=? WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL RETURNING id",
    ).bind(
      slug,
      input.title ||
        (kind === "link"
          ? new URL(input.destinationUrl!).hostname
          : current.title),
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
    if (
      String(error).includes(
        "UNIQUE constraint failed: resources.kind, resources.slug",
      ) ||
      String(error).includes("ADDRESS_RESERVED")
    )
      throw new AppError(409, "SLUG_TAKEN", "This address is already in use.", {
        slug: "Choose another address.",
      });
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
export async function changeResourceState(
  env: Env,
  kind: ResourceKind,
  id: string,
  input: { state: "active" | "disabled"; expectedRevision: number },
) {
  const current = await getResource(env, kind, id);
  if (current.revision !== input.expectedRevision) throw conflict();
  if (
    input.state === "active" &&
    current.expiresAt &&
    Date.parse(current.expiresAt) <= Date.now()
  )
    throw new AppError(
      400,
      "VALIDATION",
      "Choose a future date and time before publishing.",
      { expiresAt: "Save a future date and time before publishing." },
    );
  if (
    input.state === "active" &&
    kind === "file" &&
    current.uploadState !== "ready"
  )
    throw new AppError(
      409,
      "UPLOAD_NOT_READY",
      "Finish uploading before publishing.",
    );
  const row = await env.DB.prepare(
    "UPDATE resources SET state=?,revision=revision+1,updated_at=? WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL RETURNING id",
  )
    .bind(input.state, Date.now(), id, kind, input.expectedRevision)
    .first();
  if (!row) throw conflict();
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
      "UPDATE resources SET state='deleted',deleted_at=?,purge_after=?,updated_at=?,revision=revision+1 WHERE id=? AND kind=? AND revision=? AND deleted_at IS NULL RETURNING id",
    ).bind(now, purge, now, id, kind, revision),
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
    .from(resourceAddresses)
    .innerJoin(resources, eq(resources.id, resourceAddresses.resourceId))
    .innerJoin(links, eq(links.resourceId, resources.id))
    .where(
      and(
        eq(resourceAddresses.kind, "link"),
        eq(resourceAddresses.slug, slug),
        eq(resourceAddresses.state, "active"),
        isNull(resources.deletedAt),
      ),
    )
    .get();
  return row && available(row) ? row.destinationUrl : null;
}

function decodedPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function dbOwnedAddress(env: Env, id: string, slug: string) {
  return env.DB.prepare(
    "SELECT 1 FROM resource_addresses WHERE kind='link' AND resource_id=? AND slug=? AND state='active'",
  )
    .bind(id, slug)
    .first();
}

export async function listTrashResources(
  env: Env,
  query: Record<string, unknown>,
): Promise<TrashResourcePage> {
  const input = listSchema.parse(query);
  const now = Date.now();
  const filters = [
    sql`${resources.deletedAt} IS NOT NULL`,
    isNull(resources.purgedAt),
  ];
  if (input.q)
    filters.push(
      sql`(instr(lower(${resources.title}),lower(${input.q}))>0 OR instr(${resources.slug},lower(${input.q}))>0)`,
    );
  if (input.cursor) {
    try {
      const cursor = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString(),
      ) as { at: number; id: string };
      if (!Number.isSafeInteger(cursor.at) || typeof cursor.id !== "string")
        throw new Error();
      filters.push(
        sql`(${resources.deletedAt}<${cursor.at} OR (${resources.deletedAt}=${cursor.at} AND ${resources.id}<${cursor.id}))`,
      );
    } catch {
      throw new AppError(400, "INVALID_CURSOR", "Reload the list.");
    }
  }
  const rows = await database(env)
    .select({
      resource: resources,
      addressOwner: resourceAddresses.resourceId,
      filename: files.originalFilename,
      bytes: blobs.expectedBytes,
      storedBytes: blobs.storedBytes,
      uploadState: blobs.state,
      purgeStartedAt: blobs.purgeStartedAt,
      blobPurgeAfter: blobs.purgeAfter,
      destinationUrl: links.destinationUrl,
      format: pastes.format,
    })
    .from(resources)
    .leftJoin(
      resourceAddresses,
      and(
        eq(resourceAddresses.kind, resources.kind),
        eq(resourceAddresses.slug, resources.slug),
      ),
    )
    .leftJoin(links, eq(links.resourceId, resources.id))
    .leftJoin(pastes, eq(pastes.resourceId, resources.id))
    .leftJoin(files, eq(files.resourceId, resources.id))
    .leftJoin(blobs, eq(blobs.id, files.blobId))
    .where(and(...filters))
    .orderBy(desc(resources.deletedAt), desc(resources.id))
    .limit(input.limit + 1);
  const visible = rows.slice(0, input.limit);
  const last = visible.at(-1)?.resource;
  return {
    items: visible.map((row): TrashResourceDto => {
      const resource = row.resource;
      const reason =
        row.addressOwner !== resource.id
          ? "This address was reused before address protection was added."
          : resource.purgeAfter === null || resource.purgeAfter <= now
            ? "The recovery period has ended."
            : resource.kind === "file" &&
                (row.uploadState !== "pending_delete" ||
                  row.purgeStartedAt !== null ||
                  row.bytes !== row.storedBytes ||
                  row.blobPurgeAfter === null ||
                  row.blobPurgeAfter <= now)
              ? "The file did not finish uploading or has already been removed."
              : undefined;
      return {
        ...baseDto(env, resource),
        deletedAt: new Date(resource.deletedAt!).toISOString(),
        purgeAfter: new Date(
          resource.purgeAfter ?? resource.deletedAt!,
        ).toISOString(),
        canRestore: !reason,
        ...(reason ? { restoreUnavailableReason: reason } : {}),
        ...(resource.kind === "file"
          ? {
              filename: row.filename ?? undefined,
              bytes: row.bytes ?? undefined,
            }
          : {}),
      };
    }),
    nextCursor:
      rows.length > input.limit && last
        ? Buffer.from(
            JSON.stringify({ at: last.deletedAt, id: last.id }),
          ).toString("base64url")
        : null,
  };
}

function cannotRestore(message = "This item can no longer be restored.") {
  return new AppError(409, "RESTORE_UNAVAILABLE", message);
}

export async function restoreResource(
  env: Env,
  kind: ResourceKind,
  id: string,
  revision: number,
) {
  const row = await database(env)
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.kind, kind)))
    .get();
  if (!row || row.deletedAt === null)
    throw new AppError(404, "NOT_FOUND", "This item is not in Trash.");
  if (row.revision !== revision) throw conflict();
  if (
    row.purgedAt !== null ||
    row.purgeAfter === null ||
    row.purgeAfter <= Date.now()
  )
    throw cannotRestore();
  const address = await env.DB.prepare(
    "SELECT resource_id FROM resource_addresses WHERE kind=? AND slug=?",
  )
    .bind(kind, row.slug)
    .first<{ resource_id: string }>();
  if (address?.resource_id !== id)
    throw cannotRestore(
      "This address was reused before address protection was added.",
    );
  if (kind === "file") {
    const blob = await env.DB.prepare(
      "SELECT b.* FROM blobs b JOIN files f ON f.blob_id=b.id WHERE f.resource_id=?",
    )
      .bind(id)
      .first<{
        object_key: string;
        state: string;
        expected_bytes: number;
        stored_bytes: number;
        purge_after: number | null;
        purge_started_at: number | null;
      }>();
    if (
      !blob ||
      blob.state !== "pending_delete" ||
      blob.purge_started_at !== null ||
      blob.stored_bytes !== blob.expected_bytes ||
      blob.purge_after === null ||
      blob.purge_after <= Date.now()
    )
      throw cannotRestore(
        "The file did not finish uploading or has already been removed.",
      );
    const object = await env.FILES.head(blob.object_key);
    if (!object || object.size !== blob.expected_bytes)
      throw cannotRestore("The stored file is missing or incomplete.");
  }
  const now = Date.now();
  const condition =
    "id=? AND kind=? AND revision=? AND deleted_at IS NOT NULL AND purged_at IS NULL AND purge_after>? AND EXISTS(SELECT 1 FROM resource_addresses a WHERE a.resource_id=resources.id AND a.kind=resources.kind AND a.slug=resources.slug)";
  const statements: D1PreparedStatement[] = [];
  if (kind === "file")
    statements.push(
      env.DB.prepare(
        `UPDATE blobs SET state='ready',purge_after=NULL,purge_started_at=NULL,updated_at=? WHERE id IN(SELECT blob_id FROM files WHERE resource_id=?) AND state='pending_delete' AND purge_started_at IS NULL AND stored_bytes=expected_bytes AND purge_after>? AND EXISTS(SELECT 1 FROM resources WHERE ${condition})`,
      ).bind(now, id, now, id, kind, revision, now),
    );
  const contentExists =
    kind === "file"
      ? "EXISTS(SELECT 1 FROM files f JOIN blobs b ON b.id=f.blob_id WHERE f.resource_id=resources.id AND b.state='ready' AND b.purge_started_at IS NULL)"
      : `EXISTS(SELECT 1 FROM ${kind === "link" ? "links" : "pastes"} WHERE resource_id=resources.id)`;
  statements.push(
    env.DB.prepare(
      `UPDATE resources SET state='disabled',deleted_at=NULL,purge_after=NULL,updated_at=?,revision=revision+1 WHERE ${condition} AND ${contentExists} RETURNING id`,
    ).bind(now, id, kind, revision, now),
  );
  const result = await env.DB.batch(statements);
  if (!result.at(-1)?.results.length) throw conflict();
  return getResource(env, kind, id);
}

// Keep tombstones and address ownership after removing content. Every statement
// uses the claimed revision, so a concurrent restore cannot be partly erased.
export async function purgeResourceContent(
  env: Env,
  id: string,
  kind: ResourceKind,
  revision: number,
  now = Date.now(),
) {
  const claimed =
    "EXISTS(SELECT 1 FROM resources WHERE id=? AND kind=? AND revision=? AND deleted_at IS NOT NULL AND purged_at=?)";
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE resources SET purged_at=?,purge_after=?,title='',expires_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND kind=? AND revision=? AND deleted_at IS NOT NULL AND purged_at IS NULL RETURNING id",
    ).bind(now, now, now, id, kind, revision),
    env.DB.prepare(
      `UPDATE blobs SET state='pending_delete',purge_after=CASE WHEN stored_bytes=expected_bytes THEN ? ELSE MAX(lease_expires_at,?) END,purge_started_at=?,updated_at=? WHERE id IN(SELECT blob_id FROM files WHERE resource_id=?) AND state!='purged' AND ${claimed}`,
    ).bind(now, now, now, now, id, id, kind, revision + 1, now),
    env.DB.prepare(`DELETE FROM links WHERE resource_id=? AND ${claimed}`).bind(
      id,
      id,
      kind,
      revision + 1,
      now,
    ),
    env.DB.prepare(
      `DELETE FROM pastes WHERE resource_id=? AND ${claimed}`,
    ).bind(id, id, kind, revision + 1, now),
    env.DB.prepare(
      `UPDATE files SET original_filename='' WHERE resource_id=? AND ${claimed}`,
    ).bind(id, id, kind, revision + 1, now),
    env.DB.prepare(
      `UPDATE resource_addresses SET state='retired' WHERE resource_id=? AND ${claimed}`,
    ).bind(id, id, kind, revision + 1, now),
  ]);
  if (!result[0]?.results.length) throw conflict();
}
