import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import {
  changeResourceState,
  listResources,
  createResource,
  deleteResource,
  getResource,
  publicResource,
  publicLink,
  updateResource,
  listTrashResources,
  restoreResource,
  purgeResourceContent,
} from "../../src/server/resource-store";
import {
  available,
  generatedSlug,
  linkSchema,
  linkUpdateSchema,
  slugSchema,
  webUrl,
} from "../../src/shared/resources";
import * as resourcePolicy from "../../src/shared/resources";
import { publicPageAvailable } from "../../src/server/http/public-pages";
const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(() => vi.restoreAllMocks());
const input = (slug: string) => ({
  title: "Example",
  slug,
  state: "active" as const,
  expiresAt: null,
  destinationUrl: "https://example.org/start?stored=1",
});
describe("stable resource lifecycle and atomic writes", () => {
  it("creates live links and pauses without editing their saved content", async () => {
    const parsed = linkSchema.parse({ destinationUrl: "https://example.org" });
    expect(parsed.state).toBe("active");
    for (const state of ["draft", "disabled"])
      expect(linkSchema.safeParse({ ...parsed, state }).success).toBe(false);
    const item = await createResource(env, "link", parsed, crypto.randomUUID());
    const paused = await changeResourceState(env, "link", item.id, {
      state: "disabled",
      expectedRevision: item.revision,
    });
    expect(paused.destinationUrl).toBe(item.destinationUrl);
    expect(await publicLink(env, item.slug)).toBeNull();
    const saved = await updateResource(env, "link", item.id, {
      ...parsed,
      state: "disabled",
      expectedRevision: paused.revision,
    });
    expect(saved.state).toBe("disabled");
    const resumed = await changeResourceState(env, "link", item.id, {
      state: "active",
      expectedRevision: saved.revision,
    });
    expect(resumed.state).toBe("active");
    expect(await publicLink(env, item.slug)).toBe(parsed.destinationUrl);
  });
  it("renames links atomically, keeps the old alias, and rejects stale edits", async () => {
    const key = crypto.randomUUID();
    const item = await createResource(env, "link", input("rename-before"), key);
    const saved = await updateResource(
      env,
      "link",
      item.id,
      linkUpdateSchema.parse({
        ...input("rename-after"),
        destinationUrl: "https://example.org/after",
        expectedRevision: item.revision,
      }),
    );
    expect(saved).toMatchObject({
      slug: "rename-after",
      revision: 2,
      url: "http://localhost:3000/rename-after",
    });
    expect(await publicLink(env, item.slug)).toBe(saved.destinationUrl);
    expect(saved.aliases).toEqual([item.slug]);
    expect(await publicLink(env, saved.slug)).toBe(saved.destinationUrl);
    expect(
      (await createResource(env, "link", input("rename-before"), key)).slug,
    ).toBe(saved.slug);
    await expect(
      createResource(env, "link", input(item.slug), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    await expect(
      updateResource(env, "link", item.id, {
        ...input("stale-rename"),
        destinationUrl: "https://example.net/stale",
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(await getResource(env, "link", item.id)).toEqual(saved);
  });
  it("rolls back destination edits if a rename collides", async () => {
    const item = await createResource(
      env,
      "link",
      input("rename-source"),
      crypto.randomUUID(),
    );
    await createResource(
      env,
      "link",
      input("rename-taken"),
      crypto.randomUUID(),
    );
    await expect(
      updateResource(env, "link", item.id, {
        ...input("rename-taken"),
        destinationUrl: "https://example.org/not-saved",
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "SLUG_TAKEN",
      fields: { slug: "Choose another address." },
    });
    expect(await getResource(env, "link", item.id)).toEqual(item);
  });
  it("allows only one concurrent rename to the same address", async () => {
    const items = await Promise.all(
      ["rename-first", "rename-second"].map((slug) =>
        createResource(env, "link", input(slug), crypto.randomUUID()),
      ),
    );
    const results = await Promise.allSettled(
      items.map((item) =>
        updateResource(env, "link", item.id, {
          ...input("rename-winner"),
          destinationUrl: `https://example.org/${item.slug}`,
          expectedRevision: item.revision,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const loser = results.findIndex((result) => result.status === "rejected");
    expect(await getResource(env, "link", items[loser]!.id)).toEqual(
      items[loser],
    );
  });
  it("validates edited addresses and prevents redirects to the new address itself", async () => {
    const item = await createResource(
      env,
      "link",
      input("rename-loop-before"),
      crypto.randomUUID(),
    );
    for (const slug of ["", "admin", "UPPER", "has/slash"])
      expect(
        linkUpdateSchema.safeParse({
          ...input(slug),
          expectedRevision: item.revision,
        }).success,
      ).toBe(false);
    await expect(
      updateResource(env, "link", item.id, {
        ...input("rename-loop-after"),
        destinationUrl: "http://localhost:3000/rename-loop-after/?x=1",
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(await getResource(env, "link", item.id)).toEqual(item);
  });
  it("keeps resource kinds and paste addresses immutable at the database boundary", async () => {
    const item = await createResource(
      env,
      "paste",
      {
        title: "Fixed paste",
        slug: "fixed-paste",
        state: "draft",
        expiresAt: null,
        body: "Content",
        format: "text",
      },
      crypto.randomUUID(),
    );
    await expect(
      env.DB.prepare("UPDATE resources SET slug='changed-paste' WHERE id=?")
        .bind(item.id)
        .run(),
    ).rejects.toThrow("IMMUTABLE_ADDRESS");
    await expect(
      env.DB.prepare("UPDATE resources SET kind='link' WHERE id=?")
        .bind(item.id)
        .run(),
    ).rejects.toThrow("IMMUTABLE_ADDRESS");
  });
  it("allocates a colliding slug only once under concurrent creation", async () => {
    const results = await Promise.allSettled([
      createResource(env, "link", input("collision"), crypto.randomUUID()),
      createResource(env, "link", input("collision"), crypto.randomUUID()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS count FROM resources WHERE slug='collision'",
      ).first("count"),
    ).toBe(1);
  });
  it("replays a create action exactly once and rejects changed payloads", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.all([
      createResource(env, "link", input("idempotent"), key),
      createResource(env, "link", input("idempotent"), key),
    ]);
    expect(results[0]!.id).toBe(results[1]!.id);
    await expect(
      createResource(
        env,
        "link",
        { ...input("idempotent"), title: "changed" },
        key,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("never partially overwrites subtype data on a stale revision", async () => {
    const resource = await createResource(
      env,
      "link",
      input("edits"),
      crypto.randomUUID(),
    );
    const changed = await updateResource(env, "link", resource.id, {
      ...input("edits"),
      destinationUrl: "https://example.net/new",
      expectedRevision: 1,
    });
    expect(changed.revision).toBe(2);
    await expect(
      updateResource(env, "link", resource.id, {
        ...input("edits"),
        destinationUrl: "https://attacker.example/stale",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getResource(env, "link", resource.id)).destinationUrl).toBe(
      "https://example.net/new",
    );
    await deleteResource(env, "link", resource.id, changed.revision);
    expect(await publicResource(env, "link", "edits")).toBeNull();
  });
  it("reserves deleted addresses under concurrent attempts and after permanent deletion", async () => {
    const key = crypto.randomUUID();
    const original = await createResource(
      env,
      "link",
      input("reserved-deleted"),
      key,
    );
    await deleteResource(env, "link", original.id, original.revision);
    expect(await publicLink(env, original.slug)).toBeNull();
    const results = await Promise.allSettled([
      createResource(env, "link", input(original.slug), crypto.randomUUID()),
      createResource(env, "link", input(original.slug), crypto.randomUUID()),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await purgeResourceContent(env, original.id, "link", original.revision + 1);
    await expect(
      createResource(env, "link", input(original.slug), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    await expect(
      createResource(env, "link", input(original.slug), key),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("retires an old address only when requested, while reserving it permanently", async () => {
    const original = await createResource(
      env,
      "link",
      input("retire-before"),
      crypto.randomUUID(),
    );
    const renamed = await updateResource(env, "link", original.id, {
      ...input("retire-after"),
      previousAddress: "retire",
      expectedRevision: original.revision,
    });
    expect(await publicLink(env, original.slug)).toBeNull();
    expect(renamed.aliases).toEqual([]);
    await expect(
      createResource(env, "link", input(original.slug), crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });
  it("prevents redirect loops through a saved alias", async () => {
    const original = await createResource(
      env,
      "link",
      input("alias-loop-before"),
      crypto.randomUUID(),
    );
    const renamed = await updateResource(env, "link", original.id, {
      ...input("alias-loop-after"),
      expectedRevision: original.revision,
    });
    await expect(
      updateResource(env, "link", original.id, {
        ...input(renamed.slug),
        destinationUrl: original.url.replace(
          "alias-loop-before",
          "%61lias-loop-before",
        ),
        expectedRevision: renamed.revision,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await publicLink(env, original.slug)).toBe(renamed.destinationUrl);
  });
  it("keeps paused and expired addresses allocated", async () => {
    for (const state of ["disabled", "active"] as const) {
      const item = await createResource(
        env,
        "link",
        input(`held-${state}`),
        crypto.randomUUID(),
      );
      if (state === "disabled")
        await env.DB.prepare("UPDATE resources SET state='disabled' WHERE id=?")
          .bind(item.id)
          .run();
      if (state === "active")
        await env.DB.prepare("UPDATE resources SET expires_at=? WHERE id=?")
          .bind(Date.now() - 1, item.id)
          .run();
      await expect(
        createResource(env, "link", input(item.slug), crypto.randomUUID()),
      ).rejects.toMatchObject({ status: 409, code: "SLUG_TAKEN" });
    }
  });
  it("generates readable four-character addresses and skips reserved names without byte bias", () => {
    const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
    const random = vi.spyOn(crypto, "getRandomValues");
    for (const values of [
      [..."meet"].map((c) => alphabet.indexOf(c)),
      [248, 249, 250, 251, 252, 253, 254, 255],
      [0, 1, 2, 3],
    ])
      random.mockImplementationOnce((array) => {
        if (!array) throw new Error("Missing random buffer");
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
          .fill(255)
          .set(values);
        return array;
      });
    expect(generatedSlug()).toBe("2345");
    expect(random).toHaveBeenCalledTimes(3);
  });
  it("retries generated collisions and accepts an omitted or cleared link label", async () => {
    await createResource(env, "link", input("busy"), crypto.randomUUID());
    const generated = vi
      .spyOn(resourcePolicy, "generatedSlug")
      .mockReturnValueOnce("busy")
      .mockReturnValueOnce("fr33");
    const item = await createResource(
      env,
      "link",
      linkSchema.parse({
        destinationUrl: "https://example.net/page",
        state: "active",
      }),
      crypto.randomUUID(),
    );
    expect(generated).toHaveBeenCalledTimes(2);
    expect(item.slug).toBe("fr33");
    expect(item.title).toBe("example.net");
    const labeled = await updateResource(env, "link", item.id, {
      ...input(item.slug),
      title: "A label",
      expectedRevision: item.revision,
    });
    const cleared = await updateResource(env, "link", item.id, {
      ...input(item.slug),
      title: "",
      expectedRevision: labeled.revision,
    });
    expect(cleared.title).toBe("example.org");
  });
  it("gates exact expiry and rejects unsafe addresses and destinations", async () => {
    expect(
      available({ state: "active", deletedAt: null, expiresAt: 100 }, 99),
    ).toBe(true);
    expect(
      available({ state: "active", deletedAt: null, expiresAt: 100 }, 100),
    ).toBe(false);
    for (const slug of [
      "admin",
      "meet",
      "UPPER",
      "a/b",
      "a%2fb",
      "a\\b",
      "-x",
      "x-",
      "a..b",
    ])
      expect(slugSchema.safeParse(slug).success).toBe(false);
    for (const url of [
      "javascript:alert(1)",
      "https://user:password@example.com",
      "https://example.com/\nfoo",
    ])
      expect(webUrl(url)).toBe(false);
    await expect(
      createResource(
        env,
        "link",
        {
          ...input("loop"),
          destinationUrl: "http://localhost:3000/loop?anything",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("preserves Unicode paste bytes and private draft availability", async () => {
    const body = "# Notes\n\n🫖\tUnicode <script>alert(1)</script>\r\n";
    const item = await createResource(
      env,
      "paste",
      {
        title: "Notes",
        slug: "notes",
        state: "draft",
        expiresAt: null,
        body,
        format: "markdown",
      },
      crypto.randomUUID(),
    );
    expect((await getResource(env, "paste", item.id)).body).toBe(body);
    expect(await publicResource(env, "paste", "notes")).toBeNull();
  });
  it("rejects unavailable document routes before the renderer starts streaming", async () => {
    for (const path of ["/p/missing", "/p/UPPER", "/f/missing", "/contact"])
      expect(await publicPageAvailable(path, env)).toBe(false);
    expect(await publicPageAvailable("/admin/pastes", env)).toBe(true);
    const input = {
      title: "Document gate",
      slug: "document-gate",
      state: "active" as const,
      expiresAt: null,
      body: "Published",
      format: "text" as const,
    };
    const item = await createResource(env, "paste", input, crypto.randomUUID());
    expect(await publicPageAvailable("/p/document-gate", env)).toBe(true);
    await updateResource(env, "paste", item.id, {
      ...input,
      state: "disabled",
      expectedRevision: item.revision,
    });
    expect(await publicPageAvailable("/p/document-gate", env)).toBe(false);
  });
});

describe("independent visibility and bounded list reads", () => {
  it("changes visibility without overwriting content and rejects stale revisions", async () => {
    const item = await createResource(
      env,
      "paste",
      { ...input("visibility"), body: "Saved content", format: "text" },
      crypto.randomUUID(),
    );
    const disabled = await changeResourceState(env, "paste", item.id, {
      state: "disabled",
      expectedRevision: item.revision,
    });
    expect(disabled).toMatchObject({
      title: item.title,
      body: item.body,
      revision: 2,
      state: "disabled",
    });
    expect(await publicResource(env, "paste", item.slug)).toBeNull();
    await expect(
      changeResourceState(env, "paste", item.id, {
        state: "active",
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const expired = await updateResource(env, "paste", item.id, {
      ...input(item.slug),
      body: "Saved content",
      format: "text",
      state: "disabled",
      expiresAt: new Date(0).toISOString(),
      expectedRevision: disabled.revision,
    });
    await expect(
      changeResourceState(env, "paste", item.id, {
        state: "active",
        expectedRevision: expired.revision,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await deleteResource(env, "paste", item.id, expired.revision);
    await expect(
      changeResourceState(env, "paste", item.id, {
        state: "active",
        expectedRevision: expired.revision + 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("uses one projected query for a paginated list and never selects paste bodies", async () => {
    for (let i = 0; i < 3; i++)
      await createResource(
        env,
        "paste",
        {
          title: `List projection ${i}`,
          slug: `projection-${i}`,
          body: "Large private content".repeat(1000),
          format: "markdown",
          language: "text",
          state: "draft",
          expiresAt: null,
        },
        crypto.randomUUID(),
      );
    const prepare = vi.spyOn(env.DB, "prepare");
    const first = await listResources(env, "paste", {
      q: "List projection",
      state: "draft",
      limit: 2,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0]).not.toContain('"body"');
    expect(first.items).toHaveLength(2);
    expect(
      first.items.every(
        (item) => item.format === "markdown" && !("body" in item),
      ),
    ).toBe(true);
    prepare.mockClear();
    const second = await listResources(env, "paste", {
      q: "List projection",
      state: "draft",
      cursor: first.nextCursor,
      limit: 2,
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);
    const links = await listResources(env, "link", {
      q: "example.org/start",
      limit: 100,
    });
    expect(links.items.length).toBeGreaterThan(0);
    expect(
      links.items.every((item) =>
        item.destinationUrl?.includes("example.org/start"),
      ),
    ).toBe(true);
  });
});

describe("recoverable Trash", () => {
  it("restores content and aliases paused, with a new revision and the same address", async () => {
    const created = await createResource(
      env,
      "link",
      input("restore-old-alias"),
      crypto.randomUUID(),
    );
    const renamed = await updateResource(env, "link", created.id, {
      ...input("restore-main"),
      expectedRevision: created.revision,
    });
    await deleteResource(env, "link", renamed.id, renamed.revision);
    const trash = await listTrashResources(env, { q: renamed.slug });
    expect(trash.items).toHaveLength(1);
    const deleted = trash.items[0]!;
    expect(deleted).toMatchObject({
      id: renamed.id,
      canRestore: true,
      revision: renamed.revision + 1,
    });
    expect(Date.parse(deleted.purgeAfter)).toBeGreaterThan(
      Date.parse(deleted.deletedAt),
    );
    const restored = await restoreResource(
      env,
      "link",
      renamed.id,
      deleted.revision,
    );
    expect(restored).toMatchObject({
      slug: renamed.slug,
      state: "disabled",
      destinationUrl: renamed.destinationUrl,
      aliases: [created.slug],
      revision: deleted.revision + 1,
    });
    expect(await publicLink(env, created.slug)).toBeNull();
    expect(await publicLink(env, renamed.slug)).toBeNull();
    expect(
      (await listTrashResources(env, { q: renamed.slug })).items,
    ).toHaveLength(0);
    await changeResourceState(env, "link", renamed.id, {
      state: "active",
      expectedRevision: restored.revision,
    });
    expect(await publicLink(env, created.slug)).toBe(renamed.destinationUrl);
  });
  it("restores paste bytes exactly and refuses stale or overdue restores", async () => {
    const created = await createResource(
      env,
      "paste",
      {
        title: "Recoverable note",
        state: "active",
        expiresAt: null,
        body: "Private text\r\n🫖",
        format: "markdown",
      },
      crypto.randomUUID(),
    );
    expect(created.slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
    await deleteResource(env, "paste", created.id, created.revision);
    await expect(
      restoreResource(env, "paste", created.id, created.revision),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const restored = await restoreResource(
      env,
      "paste",
      created.id,
      created.revision + 1,
    );
    expect(restored.body).toBe("Private text\r\n🫖");
    expect(restored.state).toBe("disabled");
    await deleteResource(env, "paste", restored.id, restored.revision);
    await env.DB.prepare("UPDATE resources SET purge_after=? WHERE id=?")
      .bind(Date.now() - 1, created.id)
      .run();
    await expect(
      restoreResource(env, "paste", created.id, restored.revision + 1),
    ).rejects.toMatchObject({ code: "RESTORE_UNAVAILABLE" });
  });
  it("allows only one of restoring and permanently deleting the same revision", async () => {
    const created = await createResource(
      env,
      "paste",
      {
        title: "Concurrent Trash",
        state: "active",
        expiresAt: null,
        body: "Retain or remove as a whole",
        format: "text",
      },
      crypto.randomUUID(),
    );
    await deleteResource(env, "paste", created.id, created.revision);
    const revision = created.revision + 1;
    const result = await Promise.allSettled([
      restoreResource(env, "paste", created.id, revision),
      purgeResourceContent(env, created.id, "paste", revision),
    ]);
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const row = await env.DB.prepare(
      "SELECT deleted_at,purged_at,state FROM resources WHERE id=?",
    )
      .bind(created.id)
      .first<{
        deleted_at: number | null;
        purged_at: number | null;
        state: string;
      }>();
    const body = await env.DB.prepare(
      "SELECT body FROM pastes WHERE resource_id=?",
    )
      .bind(created.id)
      .first("body");
    if (row!.deleted_at === null) {
      expect(row!.state).toBe("disabled");
      expect(row!.purged_at).toBeNull();
      expect(body).toBe(created.body);
    } else {
      expect(row!.purged_at).not.toBeNull();
      expect(body).toBeNull();
    }
  });
  it("never erases a restored item through a stale permanent deletion", async () => {
    const created = await createResource(
      env,
      "link",
      input("stale-purge"),
      crypto.randomUUID(),
    );
    await deleteResource(env, "link", created.id, created.revision);
    const restored = await restoreResource(
      env,
      "link",
      created.id,
      created.revision + 1,
    );
    await expect(
      purgeResourceContent(env, created.id, "link", created.revision + 1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getResource(env, "link", created.id)).toEqual(restored);
  });
});
