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
} from "../../src/server/resource-store";
import {
  available,
  generatedSlug,
  linkSchema,
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
    await updateResource(env, "link", resource.id, {
      ...input("edits"),
      state: "disabled",
      expectedRevision: 2,
    });
    expect(await publicResource(env, "link", "edits")).toBeNull();
  });
  it("releases deleted addresses and resolves only the replacement under concurrent reuse", async () => {
    const key = crypto.randomUUID();
    const original = await createResource(env, "link", input("reusable"), key);
    await deleteResource(env, "link", original.id, original.revision);
    expect(await publicLink(env, "reusable")).toBeNull();
    const results = await Promise.allSettled([
      createResource(
        env,
        "link",
        {
          ...input("reusable"),
          destinationUrl: "https://example.org/replacement",
        },
        crypto.randomUUID(),
      ),
      createResource(
        env,
        "link",
        {
          ...input("reusable"),
          destinationUrl: "https://example.net/replacement",
        },
        crypto.randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results.find((r) => r.status === "fulfilled")!;
    if (winner.status !== "fulfilled")
      throw new Error("No replacement created");
    expect(winner.value.id).not.toBe(original.id);
    expect((await publicResource(env, "link", "reusable"))?.id).toBe(
      winner.value.id,
    );
    expect(await publicLink(env, "reusable")).toBe(winner.value.destinationUrl);
    await expect(
      createResource(env, "link", input("reusable"), key),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      deleteResource(env, "link", original.id, original.revision),
    ).rejects.toMatchObject({ status: 409 });
    expect(await publicLink(env, "reusable")).toBe(winner.value.destinationUrl);
  });
  it("keeps disabled and expired addresses allocated until deletion", async () => {
    for (const state of ["disabled", "active"] as const) {
      const item = await createResource(
        env,
        "link",
        { ...input(`held-${state}`), state },
        crypto.randomUUID(),
      );
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
      "link",
      input("visibility"),
      crypto.randomUUID(),
    );
    const disabled = await changeResourceState(env, "link", item.id, {
      state: "disabled",
      expectedRevision: item.revision,
    });
    expect(disabled).toMatchObject({
      title: item.title,
      destinationUrl: item.destinationUrl,
      revision: 2,
      state: "disabled",
    });
    expect(await publicLink(env, item.slug)).toBeNull();
    await expect(
      changeResourceState(env, "link", item.id, {
        state: "active",
        expectedRevision: item.revision,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const expired = await updateResource(env, "link", item.id, {
      ...input(item.slug),
      state: "disabled",
      expiresAt: new Date(0).toISOString(),
      expectedRevision: disabled.revision,
    });
    await expect(
      changeResourceState(env, "link", item.id, {
        state: "active",
        expectedRevision: expired.revision,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await deleteResource(env, "link", item.id, expired.revision);
    await expect(
      changeResourceState(env, "link", item.id, {
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
