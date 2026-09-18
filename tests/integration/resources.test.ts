import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import {
  createResource,
  deleteResource,
  getResource,
  publicResource,
  updateResource,
} from "../../src/server/resource-store";
import { available, slugSchema, webUrl } from "../../src/shared/resources";
import { publicPageAvailable } from "../../src/server/http/public-pages";
const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
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
  it("retains deleted slug tombstones", async () => {
    const resource = await createResource(
      env,
      "link",
      input("permanent"),
      crypto.randomUUID(),
    );
    await deleteResource(env, "link", resource.id, resource.revision);
    expect(await publicResource(env, "link", "permanent")).toBeNull();
    await expect(
      createResource(env, "link", input("permanent"), crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
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
