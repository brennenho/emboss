import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import {
  readCard,
  unpublishCard,
  saveCard,
  publicCard,
  readScheduling,
  saveScheduling,
  saveSettings,
} from "../../src/server/configuration-store";
import { cardSchema, schedulingSchema } from "../../src/shared/configuration";
import { vCard } from "../../src/shared/vcard";
import { metadataExport } from "../../src/server/export";
import { maintenance } from "../../src/server/maintenance";
import {
  createResource,
  deleteResource,
  publicResource,
} from "../../src/server/resource-store";
const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
describe("configuration, vCard, and portable export", () => {
  it("requires explicit public identity and keeps card/link changes atomic on conflict", async () => {
    expect(await publicCard(env)).toBeNull();
    const initial = await readCard(env);
    const { revision, updatedAt: _at, ...details } = initial;
    const input = cardSchema.parse({
      ...details,
      displayName: "Renée 🫖",
      role: "Engineer",
      organization: "Example",
      intro: "Line one\nLine two; comma, slash\\",
      publicEmail: "public@example.org",
      publicPhone: "+1 555 0100",
      website: "https://example.org",
      links: [{ label: "Writing", url: "https://example.org/writing" }],
      published: true,
      expectedRevision: revision,
    });
    const saved = await saveCard(env, input);
    expect((await publicCard(env))?.displayName).toBe("Renée 🫖");
    await expect(
      saveCard(env, {
        ...input,
        links: [{ label: "Stale", url: "https://example.net" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await readCard(env)).links).toEqual(input.links);
    const text = vCard(
      { ...saved, displayName: "🫖".repeat(70) },
      "https://example.test/contact",
    );
    expect(text).toContain("VERSION:3.0\r\n");
    expect(text).toContain("N:;");
    expect(text).toContain("NOTE:Line one\\nLine two\\; comma\\, slash\\\\");
    for (const line of text.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(text.replaceAll("\r\n ", "")).toContain("FN:" + "🫖".repeat(70));
    await saveCard(env, {
      ...input,
      published: false,
      expectedRevision: saved.revision,
    });
    expect(await publicCard(env)).toBeNull();
  });
  it("validates scheduling destinations and prevents self redirect", async () => {
    const current = await readScheduling(env);
    expect(
      schedulingSchema.safeParse({
        enabled: true,
        providerLabel: "",
        destinationUrl: "http://provider.example",
        expectedRevision: current.revision,
      }).success,
    ).toBe(false);
    await expect(
      saveScheduling(
        { ...env, APP_BASE_URL: "https://example.test", APP_ENV: "production" },
        {
          enabled: true,
          providerLabel: "Provider",
          destinationUrl: "https://example.test/meet?q=1",
          expectedRevision: current.revision,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
    const updated = await saveScheduling(env, {
      enabled: true,
      providerLabel: "Provider",
      destinationUrl: "https://provider.example/booking",
      expectedRevision: current.revision,
    });
    expect(updated.enabled).toBe(true);
    await expect(
      saveScheduling(env, {
        enabled: false,
        providerLabel: "",
        destinationUrl: "",
        expectedRevision: current.revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("exports versioned content while excluding all authentication state", async () => {
    const response = metadataExport(env);
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { format?: string; table?: string });
    expect(lines[0]?.format).toBe("emboss-content");
    expect(lines.some((row) => row.table === "business_card")).toBe(true);
    expect(
      lines.some((row) =>
        ["admin_sessions", "auth_state", "idempotency_keys"].includes(
          row.table ?? "",
        ),
      ),
    ).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("purges deleted text without affecting a reused address and respects read-only maintenance", async () => {
    const item = await createResource(
      env,
      "paste",
      {
        title: "Private note",
        state: "draft",
        expiresAt: null,
        body: "Delete this body",
        format: "text",
      },
      crypto.randomUUID(),
    );
    expect(item.slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{4}$/);
    await deleteResource(env, "paste", item.id, 1);
    const replacement = await createResource(
      env,
      "paste",
      {
        title: "New note",
        slug: item.slug,
        state: "active",
        expiresAt: null,
        body: "Keep this body",
        format: "text",
      },
      crypto.randomUUID(),
    );
    expect((await publicResource(env, "paste", item.slug))?.id).toBe(
      replacement.id,
    );
    const later = Date.now() + 31 * 86400000;
    await maintenance({ ...env, READ_ONLY_MODE: "true" }, later);
    expect(
      await env.DB.prepare("SELECT body FROM pastes WHERE resource_id=?")
        .bind(item.id)
        .first("body"),
    ).toBe("Delete this body");
    await maintenance(env, later);
    expect(
      await env.DB.prepare("SELECT body FROM pastes WHERE resource_id=?")
        .bind(item.id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT slug FROM resources WHERE id=?")
        .bind(item.id)
        .first("slug"),
    ).toBe(item.slug);
    expect((await publicResource(env, "paste", item.slug))?.id).toBe(
      replacement.id,
    );
    expect(
      await env.DB.prepare("SELECT body FROM pastes WHERE resource_id=?")
        .bind(replacement.id)
        .first("body"),
    ).toBe("Keep this body");
  });
  it("enforces operator ceilings and rejects a looping root redirect", async () => {
    const input = {
      label: "Test",
      websiteUrl: "",
      accent: "oxide" as const,
      showPoweredBy: false,
      uploadMaxBytes: 26214400,
      quotaBytes: 1073741824,
      pasteMaxBytes: 262144,
      expectedRevision: 1,
    };
    await expect(
      saveSettings(env, { ...input, uploadMaxBytes: 26214401 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveSettings(env, { ...input, websiteUrl: "http://localhost:3000/" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

it("unpublishes without rewriting card details or links and rejects stale revisions", async () => {
  const current = await readCard(env);
  const { revision, updatedAt: _at, ...details } = current;
  const published = await saveCard(
    env,
    cardSchema.parse({
      ...details,
      displayName: "Saved identity",
      links: [{ label: "Saved link", url: "https://example.org" }],
      published: true,
      expectedRevision: revision,
    }),
  );
  await expect(unpublishCard(env, revision)).rejects.toMatchObject({
    status: 409,
  });
  expect(await publicCard(env)).not.toBeNull();
  const hidden = await unpublishCard(env, published.revision);
  expect(hidden).toMatchObject({
    displayName: published.displayName,
    links: published.links,
    avatarBlobId: published.avatarBlobId,
    revision: published.revision + 1,
    published: false,
  });
  expect(await publicCard(env)).toBeNull();
});
