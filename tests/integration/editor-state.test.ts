import { describe, it, expect, vi } from "vitest";
import { mergeSavedDraft } from "../../src/shared/editor-state";
import { endpoint } from "../../src/server/http";
import { operatorFailureHint } from "../../src/shared/diagnostics";

describe("acknowledged editor snapshots", () => {
  it("retains later edits while adopting normalization and the new revision", () => {
    const submitted = { title: " first ", body: "old", revision: 1 };
    const current = { ...submitted, body: "typed during save" };
    const saved = { title: "first", body: "old", revision: 2 };
    expect(mergeSavedDraft(current, submitted, saved)).toEqual({
      title: "first",
      body: "typed during save",
      revision: 2,
    });
  });
  it("changes publication independently of invalid draft fields and reordered links", () => {
    const saved = {
      name: "Owner",
      published: true,
      revision: 1,
      links: ["a", "b"],
    };
    const draft = { ...saved, name: "", links: ["b", "a"] };
    expect(
      mergeSavedDraft(draft, saved, {
        ...saved,
        published: false,
        revision: 2,
      }),
    ).toEqual({ ...draft, published: false, revision: 2 });
  });
});
it("logs a safe operation and classification without the exception payload", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await endpoint(
      "PATCH /api/admin/[kind]/[id]",
      async () => {
        throw new Error(
          "D1_ERROR: SQL contains password=secret and private content",
        );
      },
    );
    expect(response.status).toBe(503);
    const entry = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(entry)).toMatchObject({
      operation: "PATCH /api/admin/[kind]/[id]",
      category: "database",
      status: 503,
    });
    expect(entry).not.toContain("secret");
    expect(entry).not.toContain("private content");
    expect(await response.text()).not.toContain("SQL");
    expect(operatorFailureHint("Authentication failed token=secret")).toContain(
      "token permissions",
    );
    expect(
      operatorFailureHint("Authentication failed token=secret"),
    ).not.toContain("secret");
  } finally {
    log.mockRestore();
  }
});

it("preserves the inner request ID through the outer Worker boundary", async () => {
  const response = await endpoint("worker.fetch", () =>
    endpoint("GET /api/admin/example", async () =>
      Response.json(
        { ok: true },
        { headers: { "X-Request-Id": "inner-request" } },
      ),
    ),
  );
  expect(response.headers.get("X-Request-Id")).toBe("inner-request");
});
