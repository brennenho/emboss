import { env as bindings } from "cloudflare:workers";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { Env } from "../../src/server/config";
import { unavailable } from "../../src/server/http";
import {
  fileTextPreview,
  type FileObject,
} from "../../src/server/storage/downloads";

const env = bindings as unknown as Env;
afterEach(() => vi.restoreAllMocks());
async function fixture(bytes: Uint8Array, filename = "notes.txt") {
  const key = `preview-test/${crypto.randomUUID()}`;
  await env.FILES.put(key, bytes);
  return {
    object_key: key,
    state: "ready",
    expected_bytes: bytes.length,
    original_filename: filename,
  } as FileObject;
}

describe("public recipient presentation", () => {
  it("gives unavailable shares a neutral 404 document with private security headers", async () => {
    const response = unavailable();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const body = await response.text();
    expect(body).toContain("This link is no longer available.");
    expect(body).toContain("Ask the person who shared it for a new one.");
    expect(body).not.toMatch(/<script|href=/);
  });

  it("fetches only the first 64 KiB and leaves an incomplete UTF-8 character out", async () => {
    const bytes = new TextEncoder().encode(
      "a".repeat(65535) + "🫖" + "rest".repeat(1000),
    );
    const file = await fixture(bytes);
    const get = vi.spyOn(env.FILES, "get");
    const preview = await fileTextPreview(env, file);
    expect(get).toHaveBeenCalledWith(file.object_key, {
      range: { offset: 0, length: 65536 },
    });
    expect(preview).toEqual({ text: "a".repeat(65535), truncated: true });
    await env.FILES.delete(file.object_key);
  });

  it("returns active document source as plain text and rejects binary or invalid UTF-8", async () => {
    const source = '<script>alert("never executed")</script>';
    const html = await fixture(new TextEncoder().encode(source), "index.html");
    expect(await fileTextPreview(env, html)).toEqual({
      text: source,
      truncated: false,
    });
    const binary = await fixture(new Uint8Array([65, 0, 66]));
    expect(await fileTextPreview(env, binary)).toBeNull();
    const invalid = await fixture(new Uint8Array([0xc3, 0x28]));
    expect(await fileTextPreview(env, invalid)).toBeNull();
    await Promise.all(
      [html, binary, invalid].map((file) => env.FILES.delete(file.object_key)),
    );
  });

  it("does not read unsupported or unready files and refuses mismatched objects", async () => {
    const file = await fixture(new TextEncoder().encode("readable text"));
    const get = vi.spyOn(env.FILES, "get");
    expect(
      await fileTextPreview(env, { ...file, state: "reserved" }),
    ).toBeNull();
    expect(
      await fileTextPreview(env, { ...file, original_filename: "file.pdf" }),
    ).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(
      await fileTextPreview(env, { ...file, expected_bytes: 100 }),
    ).toBeNull();
    await env.FILES.delete(file.object_key);
    expect(await fileTextPreview(env, file)).toBeNull();
  });
});
