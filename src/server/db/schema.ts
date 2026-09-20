import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const installation = sqliteTable(
  "installation",
  {
    id: integer().primaryKey().default(1),
    label: text().notNull().default("Emboss"),
    websiteUrl: text("website_url").notNull().default(""),
    accent: text({ enum: ["oxide", "blue", "green"] })
      .notNull()
      .default("oxide"),
    showPoweredBy: integer("show_powered_by", { mode: "boolean" })
      .notNull()
      .default(false),
    uploadMaxBytes: integer("upload_max_bytes").notNull().default(26214400),
    quotaBytes: integer("quota_bytes").notNull().default(1073741824),
    pasteMaxBytes: integer("paste_max_bytes").notNull().default(262144),
    revision: integer().notNull().default(1),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [
    check("installation_singleton", sql`${t.id}=1`),
    check("installation_accent", sql`${t.accent} IN ('oxide','blue','green')`),
    check(
      "installation_limits",
      sql`${t.uploadMaxBytes}>0 AND ${t.quotaBytes}>0 AND ${t.pasteMaxBytes}>0`,
    ),
  ],
);
export const authState = sqliteTable(
  "auth_state",
  {
    id: integer().primaryKey().default(1),
    activeCredentialId: text("active_credential_id").notNull(),
    sessionGeneration: text("session_generation").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [check("auth_singleton", sql`${t.id}=1`)],
);
export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    credentialId: text("credential_id").notNull(),
    sessionGeneration: text("session_generation").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("sessions_expiry").on(t.expiresAt)],
);
export const resources = sqliteTable(
  "resources",
  {
    id: text().primaryKey(),
    kind: text({ enum: ["link", "paste", "file"] }).notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    state: text({ enum: ["draft", "active", "disabled", "deleted"] })
      .notNull()
      .default("draft"),
    expiresAt: integer("expires_at"),
    revision: integer().notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("resource_slug")
      .on(t.kind, t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
    index("resource_list").on(t.kind, t.state, t.updatedAt, t.id),
    index("resource_expiry").on(t.expiresAt),
    check("resource_kind", sql`${t.kind} IN ('link','paste','file')`),
    check(
      "resource_state",
      sql`${t.state} IN ('draft','active','disabled','deleted')`,
    ),
  ],
);
export const links = sqliteTable("links", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resources.id),
  destinationUrl: text("destination_url").notNull(),
});
export const pastes = sqliteTable(
  "pastes",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .references(() => resources.id),
    body: text().notNull(),
    format: text({ enum: ["text", "code", "markdown"] }).notNull(),
    language: text().notNull().default("text"),
  },
  (t) => [
    check("paste_format", sql`${t.format} IN ('text','code','markdown')`),
  ],
);
export const blobs = sqliteTable(
  "blobs",
  {
    id: text().primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    purpose: text({ enum: ["file", "avatar"] }).notNull(),
    state: text({
      enum: ["reserved", "uploading", "ready", "pending_delete", "purged"],
    }).notNull(),
    expectedBytes: integer("expected_bytes").notNull(),
    storedBytes: integer("stored_bytes").notNull().default(0),
    detectedType: text("detected_type"),
    width: integer(),
    height: integer(),
    etag: text(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    leaseExpiresAt: integer("lease_expires_at").notNull(),
    purgeAfter: integer("purge_after"),
    claimId: text("claim_id"),
  },
  (t) => [
    index("blob_cleanup").on(t.state, t.purgeAfter),
    index("blob_lease").on(t.state, t.leaseExpiresAt),
    check(
      "blob_state",
      sql`${t.state} IN ('reserved','uploading','ready','pending_delete','purged')`,
    ),
    check("blob_purpose", sql`${t.purpose} IN ('file','avatar')`),
    check("blob_bytes", sql`${t.expectedBytes}>0 AND ${t.storedBytes}>=0`),
  ],
);
export const files = sqliteTable("files", {
  resourceId: text("resource_id")
    .primaryKey()
    .references(() => resources.id),
  blobId: text("blob_id")
    .notNull()
    .unique()
    .references(() => blobs.id),
  originalFilename: text("original_filename").notNull(),
});
export const scheduling = sqliteTable(
  "scheduling",
  {
    id: integer().primaryKey().default(1),
    enabled: integer({ mode: "boolean" }).notNull().default(false),
    providerLabel: text("provider_label").notNull().default(""),
    destinationUrl: text("destination_url").notNull().default(""),
    revision: integer().notNull().default(1),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [check("scheduling_singleton", sql`${t.id}=1`)],
);
export const businessCard = sqliteTable(
  "business_card",
  {
    id: integer().primaryKey().default(1),
    published: integer({ mode: "boolean" }).notNull().default(false),
    displayName: text("display_name").notNull().default(""),
    role: text().notNull().default(""),
    organization: text().notNull().default(""),
    intro: text().notNull().default(""),
    website: text().notNull().default(""),
    publicEmail: text("public_email").notNull().default(""),
    publicPhone: text("public_phone").notNull().default(""),
    avatarBlobId: text("avatar_blob_id").references(() => blobs.id),
    showScheduling: integer("show_scheduling", { mode: "boolean" })
      .notNull()
      .default(false),
    revision: integer().notNull().default(1),
    updatedAt: integer("updated_at").notNull().default(0),
  },
  (t) => [check("card_singleton", sql`${t.id}=1`)],
);
export const businessCardLinks = sqliteTable(
  "business_card_links",
  {
    id: text().primaryKey(),
    cardId: integer("card_id")
      .notNull()
      .references(() => businessCard.id),
    label: text().notNull(),
    url: text().notNull(),
    position: integer().notNull(),
  },
  (t) => [uniqueIndex("card_link_position").on(t.cardId, t.position)],
);
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text().primaryKey(),
    operation: text().notNull(),
    requestHash: text("request_hash").notNull(),
    resultId: text("result_id").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idempotency_expiry").on(t.expiresAt)],
);
