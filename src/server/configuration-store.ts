import { eq } from "drizzle-orm";
import type { z } from "zod";
import { database } from "./db";
import {
  businessCard,
  businessCardLinks,
  installation,
  scheduling,
} from "./db/schema";
import { config, type Env } from "./config";
import { AppError } from "../shared/errors";
import type {
  CardData,
  SchedulingData,
  cardSchema,
  schedulingSchema,
  settingsSchema,
} from "../shared/configuration";
const conflict = () =>
  new AppError(
    409,
    "CONFLICT",
    "This configuration changed in another tab. Reload before saving.",
  );
export async function readScheduling(env: Env): Promise<SchedulingData> {
  const row = await database(env).select().from(scheduling).get();
  if (!row) throw new Error("Missing scheduling configuration");
  const { id: _id, ...data } = row;
  return data;
}
export async function saveScheduling(
  env: Env,
  input: z.infer<typeof schedulingSchema>,
) {
  if (input.destinationUrl) {
    const target = new URL(input.destinationUrl);
    if (
      target.origin === config(env).origin &&
      decodeURIComponent(target.pathname).replace(/\/$/, "") === "/meet"
    )
      throw new AppError(
        400,
        "VALIDATION",
        "Choose a destination other than this scheduling address.",
        { destinationUrl: "This would redirect back to /meet." },
      );
  }
  const row = await env.DB.prepare(
    "UPDATE scheduling SET enabled=?,provider_label=?,destination_url=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=? RETURNING id",
  )
    .bind(
      Number(input.enabled),
      input.providerLabel,
      input.destinationUrl,
      Date.now(),
      input.expectedRevision,
    )
    .first();
  if (!row) throw conflict();
  return readScheduling(env);
}
export async function readCard(env: Env): Promise<CardData> {
  const db = database(env);
  const [row, links] = await Promise.all([
    db.select().from(businessCard).get(),
    db
      .select({ label: businessCardLinks.label, url: businessCardLinks.url })
      .from(businessCardLinks)
      .orderBy(businessCardLinks.position),
  ]);
  if (!row) throw new Error("Missing card configuration");
  const { id: _id, ...card } = row;
  return { ...card, links };
}
export async function publicCard(env: Env) {
  const card = await readCard(env);
  return card.published ? card : null;
}
export async function saveCard(env: Env, input: z.infer<typeof cardSchema>) {
  const now = Date.now(),
    purge = now + config(env).DELETION_RETENTION_DAYS * 86400000;
  const allowed =
    "EXISTS(SELECT 1 FROM business_card WHERE id=1 AND revision=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM blobs WHERE id=? AND purpose='avatar' AND state='ready'))";
  const bindGuard = () => [
    input.expectedRevision,
    input.avatarBlobId,
    input.avatarBlobId,
  ];
  if (input.avatarBlobId) {
    const avatar = await env.DB.prepare(
      "SELECT id FROM blobs WHERE id=? AND purpose='avatar' AND state='ready'",
    )
      .bind(input.avatarBlobId)
      .first();
    if (!avatar)
      throw new AppError(
        409,
        "AVATAR_NOT_READY",
        "Finish uploading the avatar before saving.",
      );
  }
  const statements = [
    env.DB.prepare(
      `UPDATE blobs SET state='pending_delete',purge_after=?,updated_at=? WHERE id=(SELECT avatar_blob_id FROM business_card WHERE id=1) AND id IS NOT ? AND ${allowed}`,
    ).bind(purge, now, input.avatarBlobId, ...bindGuard()),
    env.DB.prepare(
      `DELETE FROM business_card_links WHERE card_id=1 AND ${allowed}`,
    ).bind(...bindGuard()),
  ];
  input.links.forEach((link, index) =>
    statements.push(
      env.DB.prepare(
        `INSERT INTO business_card_links(id,card_id,label,url,position) SELECT ?,1,?,?,? WHERE ${allowed}`,
      ).bind(crypto.randomUUID(), link.label, link.url, index, ...bindGuard()),
    ),
  );
  statements.push(
    env.DB.prepare(
      `UPDATE business_card SET published=?,display_name=?,role=?,organization=?,intro=?,website=?,public_email=?,public_phone=?,avatar_blob_id=?,show_scheduling=?,revision=revision+1,updated_at=? WHERE id=1 AND ${allowed} RETURNING id`,
    ).bind(
      Number(input.published),
      input.displayName,
      input.role,
      input.organization,
      input.intro,
      input.website,
      input.publicEmail,
      input.publicPhone,
      input.avatarBlobId,
      Number(input.showScheduling),
      now,
      ...bindGuard(),
    ),
  );
  const result = await env.DB.batch(statements);
  if (!result.at(-1)?.results.length) throw conflict();
  return readCard(env);
}
export async function saveSettings(
  env: Env,
  input: z.infer<typeof settingsSchema>,
) {
  const c = config(env);
  if (
    input.uploadMaxBytes > c.UPLOAD_MAX_BYTES ||
    input.quotaBytes > c.STORAGE_QUOTA_BYTES ||
    input.pasteMaxBytes > c.PASTE_MAX_BYTES
  )
    throw new AppError(
      400,
      "VALIDATION",
      "Limits cannot exceed the operator ceilings.",
    );
  if (input.websiteUrl) {
    const url = new URL(input.websiteUrl);
    if (url.origin === c.origin && url.pathname === "/")
      throw new AppError(
        400,
        "VALIDATION",
        "Choose a website other than this root address.",
        { websiteUrl: "This would redirect back to itself." },
      );
  }
  const { expectedRevision, ...values } = input;
  const row = await database(env)
    .update(installation)
    .set({ ...values, updatedAt: Date.now(), revision: expectedRevision + 1 })
    .where(eq(installation.revision, expectedRevision))
    .returning()
    .get();
  if (!row) throw conflict();
  return row;
}
