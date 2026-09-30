import { env as bindings } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../../src/server/config";
import { publicLink, restoreResource } from "../../src/server/resource-store";
const env = bindings as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };

it("migrates historical reuse without changing the active address owner", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 4));
  const now = Date.now();
  for (const [id, deleted] of [
    ["old", true],
    ["current", false],
    ["older-retired", true],
    ["newer-retired", true],
  ] as const) {
    const slug = id.endsWith("retired") ? "retired-history" : "active-history";
    await env.DB.prepare(
      "INSERT INTO resources(id,kind,slug,title,state,revision,created_at,updated_at,deleted_at) VALUES(?,'link',?,'Migration',?,1,?,?,?)",
    )
      .bind(
        id,
        slug,
        deleted ? "deleted" : "active",
        now,
        id === "newer-retired" ? now + 1 : now,
        deleted ? now : null,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO links(resource_id,destination_url) VALUES(?,?)",
    )
      .bind(id, `https://example.org/${id}`)
      .run();
  }
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(4));
  expect(await publicLink(env, "active-history")).toBe(
    "https://example.org/current",
  );
  expect(
    await env.DB.prepare(
      "SELECT resource_id FROM resource_addresses WHERE kind='link' AND slug='retired-history'",
    ).first("resource_id"),
  ).toBe("newer-retired");
  await expect(restoreResource(env, "link", "old", 1)).rejects.toMatchObject({
    code: "RESTORE_UNAVAILABLE",
  });
  await expect(
    env.DB.prepare(
      "DELETE FROM resource_addresses WHERE slug='active-history'",
    ).run(),
  ).rejects.toThrow("ADDRESS_RESERVED");
});
