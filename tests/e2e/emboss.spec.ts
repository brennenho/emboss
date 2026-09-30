import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { createHash } from "node:crypto";
import { readFile, chmod, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const origin = process.env.EMBOSS_TEST_ORIGIN ?? "http://127.0.0.1:8787",
  password = "Emboss local test password 2026!";
const headers = {
  Origin: origin,
  "X-Emboss-Request": "1",
  "Content-Type": "application/json",
};
const portrait = new PNG({ width: 16, height: 16 });
portrait.data.fill(255);
const png = PNG.sync.write(portrait);
let context: BrowserContext, page: Page, request: APIRequestContext;
let slug: string;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  // Keep one disposable fixture session across worker restarts so a failed
  // scenario does not exhaust the login limiter or skip unrelated coverage.
  const authDirectory = join(tmpdir(), "emboss-e2e-auth");
  await mkdir(authDirectory, { recursive: true, mode: 0o700 });
  const authPath = join(
    authDirectory,
    `${createHash("sha256").update(origin).digest("hex").slice(0, 12)}-${info.project.name}.json`,
  );
  const savedAuth = await stat(authPath)
    .then(() => authPath)
    .catch(() => undefined);
  context = await browser.newContext({
    ...info.project.use,
    storageState: savedAuth,
  });
  request = context.request;
  page = await context.newPage();
  if ((await request.get("/api/admin/links")).status() !== 200) {
    await page.goto("/admin/login");
    await page.getByLabel("Admin password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/links/);
    await context.storageState({ path: authPath });
    await chmod(authPath, 0o600);
  }
});
test.beforeEach(async ({}, info) => {
  await page?.close();
  page = await context.newPage();
  errors.length = 0;
  slug = `e2e-${Date.now().toString(36)}-${info.project.name}`;
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterAll(async () => {
  await context?.close();
});
async function json<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await request.fetch(url, {
    method,
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as T;
}
type Resource = {
  id: string;
  slug: string;
  revision: number;
  state: string;
  url: string;
  title: string;
  body?: string;
};
test("private pages and APIs enforce authorization and request intent", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  for (const url of [
    "/api/admin/links",
    "/api/admin/pastes",
    "/api/admin/files",
    "/api/admin/business-card",
    "/api/admin/settings",
    "/api/admin/export",
    "/api/admin/files/unknown/preview",
    "/api/admin/files/unknown/download",
    "/api/admin/uploads/unknown",
    "/api/admin/business-card/avatar/preview",
  ])
    expect((await anonymous.get(url, { maxRedirects: 0 })).status()).toBe(401);
  const rsc = await anonymous.get("/admin/links", {
    headers: { RSC: "1" },
    maxRedirects: 0,
  });
  expect([200, 307]).toContain(rsc.status());
  expect(await rsc.text()).not.toContain("destinationUrl");
  for (const h of [
    {},
    { Origin: "https://evil.example", "X-Emboss-Request": "1" },
    { Origin: origin },
  ]) {
    const r = await request.post("/api/admin/links", {
      headers: h as Record<string, string>,
      data: {
        title: "No",
        destinationUrl: "https://example.org",
        state: "active",
        expiresAt: null,
      },
    });
    expect(r.status()).toBe(403);
  }
  for (const path of [
    "/api/admin/links/unknown/state",
    "/api/admin/pastes/unknown/state",
    "/api/admin/files/unknown/state",
    "/api/admin/business-card/unpublish",
  ]) {
    const data = path.endsWith("state")
      ? { state: "disabled", expectedRevision: 1 }
      : { expectedRevision: 1 };
    expect((await anonymous.patch(path, { headers, data })).status()).toBe(401);
    expect((await request.patch(path, { data })).status()).toBe(403);
    expect(
      (
        await request.patch(path, {
          headers,
          data: { ...data, unexpected: true },
        })
      ).status(),
    ).toBe(400);
  }
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "emboss_session_dev")).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
  });
  for (const path of [
    "/%2fadmin",
    "/p/foo%2Fraw",
    "/UPPER",
    "/UPPER/",
    "/%ZZ",
    "/a%5Cb",
    "/contact//avatar",
  ])
    expect((await anonymous.get(path, { maxRedirects: 0 })).status()).toBe(404);
  await anonymous.dispose();
});
test("creates a short link, restores it paused, and permanently reserves its address", async () => {
  await page.goto("/admin/links?item=new");
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Destination URL", exact: true })
    .fill("https://example.org/first");
  await page
    .getByRole("button", { name: "Create live link", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Edit link" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/item=[a-f0-9-]{36}/);
  const id = new URL(page.url()).searchParams.get("item")!;
  const original = await json<Resource>(`/api/admin/links/${id}`, "GET");
  expect(original.slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{4}$/);
  expect(original.title).toBe("example.org");
  expect(
    (await request.get(original.url, { maxRedirects: 0 })).headers().location,
  ).toBe("https://example.org/first");
  await page
    .getByRole("textbox", { name: "Destination URL", exact: true })
    .fill("invalid unsaved destination");
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "address stays reserved",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/admin/links`);
  expect((await request.get(original.url, { maxRedirects: 0 })).status()).toBe(
    404,
  );
  const replacement = await request.post("/api/admin/links", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "Replacement",
      slug: original.slug,
      destinationUrl: "https://example.net/replacement",
      state: "active",
      expiresAt: null,
    },
  });
  expect(replacement.status()).toBe(409);
  await page.goto(`/admin/trash?q=${original.slug}`);
  await page
    .getByRole("button", { name: "Restore example.org", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Review example.org" }),
  ).toBeVisible();
  const restored = await json<Resource>(`/api/admin/links/${id}`, "GET");
  expect(restored.state).toBe("disabled");
  expect((await request.get(original.url, { maxRedirects: 0 })).status()).toBe(
    404,
  );
  await page.getByRole("link", { name: "Review example.org" }).click();
  await page.getByRole("button", { name: "Resume link", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause sharing", exact: true }),
  ).toBeVisible();
  expect(
    (await request.get(original.url, { maxRedirects: 0 })).headers().location,
  ).toBe("https://example.org/first");
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/admin/links`);
  await page.goto(`/admin/trash?q=${original.slug}`);
  await page
    .getByRole("button", {
      name: "Delete example.org permanently",
      exact: true,
    })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching items" }),
  ).toBeVisible();
  expect((await request.get(original.url, { maxRedirects: 0 })).status()).toBe(
    404,
  );
});
test("creates and edits a link, protects unsaved edits, and exports decodable QR", async () => {
  await page.goto("/admin/links?item=new");
  await page
    .getByText("Label, address and expiry", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Destination URL", exact: true })
    .fill("https://example.org/start?stored=1");
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Design notes");
  await page
    .getByRole("textbox", { name: "Custom address", exact: true })
    .fill(slug);
  await page
    .getByRole("button", { name: "Create live link", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Edit link" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/item=[a-f0-9-]{36}/);
  const slash = await request.get(`/${slug}/`, { maxRedirects: 0 });
  expect(slash.status()).toBe(307);
  expect(slash.headers().location).toBe(`${origin}/${slug}`);
  const redirect = await request.get(`/${slug}?ignored=2`, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe(
    "https://example.org/start?stored=1",
  );
  expect(redirect.headers()["cache-control"]).toBe("no-store");
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Unsaved title");
  await page
    .getByRole("button", { name: /^(Close editor|Back to links)$/ })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Unsaved title");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Unsaved title");
  await expect(
    page.getByRole("complementary", { name: "Edit link" }),
  ).toHaveAttribute("data-revision", "2");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("dialog").getByText("QR code", { exact: true }).click();
  const qr = page.getByRole("img", { name: `QR code for ${origin}/${slug}` });
  await expect(qr).toBeVisible();
  const src = await qr.getAttribute("src");
  const image = PNG.sync.read(Buffer.from(src!.split(",")[1]!, "base64"));
  expect(image.width).toBeGreaterThanOrEqual(1024);
  expect(
    jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data,
  ).toBe(`${origin}/${slug}`);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  const svg = await downloaded;
  expect((await readFile((await svg.path())!, "utf8")).startsWith("<svg")).toBe(
    true,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Share", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Destination URL", exact: true })
    .fill("https://example.net/edited");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
  expect(
    (await request.get(`/${slug}`, { maxRedirects: 0 })).headers().location,
  ).toBe("https://example.net/edited");
  const renamedSlug = `${slug}-renamed`;
  await page
    .getByRole("textbox", { name: "Custom address", exact: true })
    .fill(renamedSlug);
  await expect(
    page.getByText(
      "Existing links and QR codes will reach the same destination.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
  await expect(page.locator(".address-plate:visible")).toContainText(
    `${origin}/${renamedSlug}`,
  );
  expect(
    (await request.get(`/${slug}`, { maxRedirects: 0 })).headers().location,
  ).toBe("https://example.net/edited");
  expect(
    (await request.get(`/${renamedSlug}`, { maxRedirects: 0 })).headers()
      .location,
  ).toBe("https://example.net/edited");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("dialog").getByText("QR code", { exact: true }).click();
  const renamedQr = page.getByRole("img", {
    name: `QR code for ${origin}/${renamedSlug}`,
  });
  await expect(renamedQr).toBeVisible();
  const renamedImage = PNG.sync.read(
    Buffer.from(
      (await renamedQr.getAttribute("src"))!.split(",")[1]!,
      "base64",
    ),
  );
  expect(
    jsQR(
      new Uint8ClampedArray(renamedImage.data),
      renamedImage.width,
      renamedImage.height,
    )?.data,
  ).toBe(`${origin}/${renamedSlug}`);
  await expect(
    page.getByRole("link", { name: "Open link", exact: true }),
  ).toHaveAttribute("href", `${origin}/${renamedSlug}`);
  await page.keyboard.press("Escape");
  const itemId = new URL(page.url()).searchParams.get("item")!;
  const item = await json<Resource>(`/api/admin/links/${itemId}`, "GET");
  const payload = {
    title: "Changed elsewhere",
    destinationUrl: "https://example.net/new",
    state: "active",
    expiresAt: null,
    expectedRevision: item.revision,
  };
  await json(`/api/admin/links/${itemId}`, "PATCH", payload);
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Keep my work");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText(
      "Changed in another tab. Review the latest version before continuing.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Keep my work");
  const draftDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download draft", exact: true })
    .click();
  expect(
    await readFile((await (await draftDownload).path())!, "utf8"),
  ).toContain("Keep my work");
  await page
    .getByRole("button", { name: "Review latest", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Latest saved version"),
  ).toContainText("Changed elsewhere");
  await page
    .getByRole("button", {
      name: "Discard my edits and use saved version",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Changed elsewhere");
  const deletion = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/admin/links/${itemId}`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  expect((await deletion).status()).toBe(204);
  await expect(page).toHaveURL(/\/admin\/links$/);
  expect(
    (await request.get(`/${renamedSlug}`, { maxRedirects: 0 })).status(),
  ).toBe(404);
});
test("renders sanitized Markdown and exact raw text with draft and expiry gates", async () => {
  const body =
    "# A useful note\n\nHello 🫖\r\n\n<script>window.__pwned=true</script>\n\n![remote](https://tracker.example/pixel.png)\n\n[bad](javascript:alert(1))\n\n| A | B |\n| - | - |\n| one | two |";
  await page.goto("/admin/pastes?item=new");
  await page
    .getByRole("textbox", { name: /^Title(?: \(optional\))?$/ })
    .fill("Unicode notes");
  await page.getByRole("textbox", { name: "Content", exact: true }).fill(body);
  await page
    .getByText("Sharing options", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Custom address", exact: true })
    .fill(`${slug}-paste`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/item=[a-f0-9-]{36}/);
  expect((await request.get(`/p/${slug}-paste/raw`)).status()).toBe(404);
  await page
    .getByRole("button", { name: "Publish paste", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause sharing", exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("item")!;
  const saved = await json<Resource & { format: string; language: string }>(
    `/api/admin/pastes/${id}`,
    "GET",
  );
  await json(`/api/admin/pastes/${id}`, "PATCH", {
    title: saved.title,
    body,
    format: "markdown",
    language: "text",
    state: "active",
    expiresAt: null,
    expectedRevision: saved.revision,
  });
  const publicPage = await context.newPage();
  await publicPage.goto(`/p/${slug}-paste`);
  await expect(
    publicPage.getByRole("heading", { name: "A useful note" }),
  ).toBeVisible();
  await expect(publicPage.locator("img")).toHaveCount(0);
  await expect(publicPage.locator('a[href^="javascript:"]')).toHaveCount(0);
  const raw = await request.get(`/p/${slug}-paste/raw`);
  expect(await raw.text()).toBe(body);
  expect(raw.headers()["content-type"]).toContain("text/plain");
  expect(raw.headers()["x-content-type-options"]).toBe("nosniff");
  const current = await json<Resource>(`/api/admin/pastes/${id}`, "GET");
  await json(`/api/admin/pastes/${id}`, "PATCH", {
    title: current.title,
    body,
    format: "markdown",
    language: "text",
    state: "active",
    expiresAt: new Date(Date.now() + 2000).toISOString(),
    expectedRevision: current.revision,
  });
  await expect
    .poll(async () => (await request.get(`/p/${slug}-paste/raw`)).status())
    .toBe(404);
  expect(
    (
      await request.head(`/p/${slug}-paste/raw`, {
        headers: { "If-None-Match": "anything" },
      })
    ).status(),
  ).toBe(404);
  expect((await request.get(`/p/${slug}-paste`)).status()).toBe(404);
  await publicPage.close();
  await page.goto("/admin/pastes?item=new");
  await page.getByRole("combobox", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "Code", exact: true }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.locator(".cm-content").fill('const message = "hello";');
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Preview", exact: true }),
  ).toContainText('const message = "hello";');
  page.once("dialog", (d) => d.accept());
  await page.goto("/admin/files");
});
test("uploads through the Worker, publishes, downloads, ranges, and revokes", async ({}, info) => {
  const large = info.project.name === "desktop";
  const bytes = large
    ? Buffer.alloc(25 * 1024 ** 2, 0x61)
    : Buffer.from("A small file 🫖\n");
  const filename = `${slug}.txt`;
  await page.goto("/admin/files");
  const choosingFile = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files", exact: true }).click();
  await (
    await choosingFile
  ).setFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: bytes,
  });
  await expect(
    page.getByText("Uploaded · Only you", { exact: true }),
  ).toBeVisible({
    timeout: 60000,
  });
  await page
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "File details" }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("item")!;
  const file = await json<Resource>(`/api/admin/files/${id}`, "GET");
  expect((await request.get(`${file.url}/download`)).status()).toBe(404);
  await page
    .getByRole("textbox", { name: /^Title(?: \(optional\))?$/ })
    .fill("Published file title");
  await page.getByRole("button", { name: "1 day", exact: true }).click();
  const chosenExpiry = await page
    .getByLabel("Expires", { exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "Save and publish", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause sharing", exact: true }),
  ).toBeVisible();
  const publishedFile = await json<Resource & { expiresAt: string }>(
    `/api/admin/files/${id}`,
    "GET",
  );
  expect(publishedFile.title).toBe("Published file title");
  expect(publishedFile.expiresAt.slice(0, 16)).toBe(chosenExpiry);
  expect(publishedFile.slug).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/);
  const recipient = await request.get(file.url);
  expect(await recipient.text()).toContain("Published file title");
  const download = await request.get(`${file.url}/download`);
  expect(download.status()).toBe(200);
  expect(
    createHash("sha256")
      .update(await download.body())
      .digest("hex"),
  ).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(download.headers()["content-disposition"]).toContain("attachment");
  const range = await request.get(`${file.url}/download`, {
    headers: { Range: "bytes=1-5" },
  });
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(bytes.subarray(1, 6));
  expect(
    (await request.head(`${file.url}/download`)).headers()["content-length"],
  ).toBe(String(bytes.length));
  await page
    .getByRole("textbox", { name: /^Title(?: \(optional\))?$/ })
    .fill("Keep this file title");
  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe(filename);
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /^Title(?: \(optional\))?$/ }),
  ).toHaveValue("Keep this file title");
  await page
    .getByRole("textbox", { name: /^Title(?: \(optional\))?$/ })
    .fill(file.title);
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  const deletion = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/admin/files/${id}`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  expect((await deletion).status()).toBe(204);
  await expect(page).toHaveURL(`${origin}/admin/files`);
  await expect(
    page.getByRole("complementary", { name: "File details" }),
  ).not.toBeVisible();
  for (const path of ["", "/download", "/preview"]) {
    const revoked = await request.get(`${file.url}${path}`, {
      headers: { Range: "bytes=0-1", "If-None-Match": "anything" },
    });
    expect(revoked.status()).toBe(404);
  }
});
test("publishes scheduling and a card with avatar and valid contact download", async () => {
  await page.goto("/admin/scheduling");
  await page
    .getByRole("textbox", { name: "Provider", exact: true })
    .fill("Booking");
  await page
    .getByRole("textbox", { name: "Booking URL", exact: true })
    .fill("https://example.org/booking");
  const enabled = page.getByRole("switch", { name: "Share booking page" });
  if ((await enabled.getAttribute("aria-checked")) !== "true")
    await enabled.click();
  const saveScheduling = page.getByRole("button", {
    name: "Save changes",
    exact: true,
  });
  if (await saveScheduling.isEnabled()) await saveScheduling.click();
  await expect(
    page.getByRole("main").getByText("Live", { exact: true }),
  ).toBeVisible();
  const meet = await request.get("/meet?unused=1", { maxRedirects: 0 });
  expect(meet.headers().location).toBe("https://example.org/booking");
  const beforeAvatar = await json<{
    revision: number;
    avatarBlobId: string | null;
  }>("/api/admin/business-card", "GET");
  await page.goto("/admin/business-card");
  await page
    .getByRole("textbox", { name: "Display name", exact: true })
    .fill("Renée Example");
  await page
    .getByRole("textbox", { name: "Role", exact: true })
    .fill("Designer & engineer");
  await page
    .getByRole("textbox", { name: "Introduction", exact: true })
    .fill("Useful things, thoughtfully made.\nUnicode 🫖");
  await page
    .getByRole("textbox", { name: "Public email", exact: true })
    .fill("public@example.org");
  await page
    .getByRole("textbox", { name: "Website", exact: true })
    .fill("https://example.org");
  const choosingAvatar = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose image", exact: true }).click();
  await (
    await choosingAvatar
  ).setFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("button", { name: "Use cropped image", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use cropped image", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose image", exact: true }),
  ).toBeEnabled();
  const afterAvatar = await json<{
    revision: number;
    avatarBlobId: string | null;
  }>("/api/admin/business-card", "GET");
  expect(afterAvatar.revision).toBe(beforeAvatar.revision);
  expect(afterAvatar.avatarBlobId).toBe(beforeAvatar.avatarBlobId);
  const include = page.getByRole("switch", { name: "Include scheduling" });
  if ((await include.getAttribute("aria-checked")) !== "true")
    await include.click();
  const publish = page.getByRole("button", {
    name: "Publish card",
    exact: true,
  });
  if (await publish.isVisible()) await publish.click();
  else
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  await expect(
    page.getByRole("main").getByText("Live", { exact: true }),
  ).toBeVisible();
  const contact = await context.newPage();
  await contact.goto("/contact");
  await expect(
    contact.getByRole("heading", { name: "Renée Example" }),
  ).toBeVisible();
  await expect(
    contact.getByRole("link", { name: "Schedule a time" }),
  ).toBeVisible();
  expect((await request.get("/contact/avatar")).headers()["content-type"]).toBe(
    "image/png",
  );
  const vcf = await request.get("/contact.vcf");
  const text = await vcf.text();
  expect(text).toContain("FN:Renée Example\r\n");
  expect(text).toContain("EMAIL:public@example.org\r\n");
  expect(text).toContain(`URL:${origin}/contact\r\n`);
  await contact.close();
  await page
    .getByRole("button", { name: "Pause sharing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish card", exact: true }),
  ).toBeVisible();
  for (const path of ["/contact", "/contact/avatar", "/contact.vcf"])
    expect((await request.get(path)).status()).toBe(404);
  await page.getByRole("button", { name: "Publish card", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause sharing", exact: true }),
  ).toBeVisible();
});
test("settings, export, responsive navigation and accessibility remain usable", async ({}, info) => {
  await page.goto("/admin/settings");
  await page
    .getByRole("textbox", { name: "Site name", exact: true })
    .fill("Emboss");
  await page.getByLabel("Accent", { exact: true }).click();
  await page.getByRole("option", { name: "Instrument blue" }).click();
  const saveSettings = page.getByRole("button", {
    name: "Save changes",
    exact: true,
  });
  if (await saveSettings.isEnabled()) await saveSettings.click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
  const exported = await request.get("/api/admin/export");
  const text = await exported.text();
  expect(text).toContain("emboss-content");
  expect(text).not.toContain("token_hash");
  expect(text).not.toContain("active_credential_id");
  for (const path of [
    "links",
    "pastes",
    "files",
    "scheduling",
    "business-card",
    "settings",
    "trash",
  ]) {
    await page.goto(`/admin/${path}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          detail: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  }
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Links", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Links", exact: true }),
    ).toBeVisible();
  }
  await page.screenshot({
    path: `test-results/${info.project.name}-workspace.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("narrow workspaces preserve readable controls, long content, and sharing focus", async () => {
  const originalViewport = page.viewportSize()!;
  const link = await json<Resource>("/api/admin/links", "POST", {
    title: "A long resource title " + "reference ".repeat(12),
    slug: `${slug}-layout`,
    destinationUrl: "https://example.org/" + "reference/".repeat(30),
    state: "active",
    expiresAt: null,
  });
  const paste = await json<Resource>("/api/admin/pastes", "POST", {
    title: "Long content layout",
    slug: `${slug}-layout`,
    body: "W".repeat(1500),
    format: "text",
    language: "text",
    state: "active",
    expiresAt: null,
  });
  for (const width of [1024, 320]) {
    await page.setViewportSize({ width, height: 700 });
    for (const route of [
      `links?item=${link.id}`,
      `pastes?item=${paste.id}`,
      "files",
      "scheduling",
      "business-card",
      "settings",
    ]) {
      await page.goto(`/admin/${route}`);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} fits ${width}px`,
      ).toBe(true);
    }
    await page.goto(`/admin/links?item=${link.id}`);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByText("QR code", { exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("img", { name: /^QR code/ })).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeLessThanOrEqual(700);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Share", exact: true }),
    ).toBeFocused();
  }
  await page.setViewportSize(originalViewport);
  await page.goto(`/admin/links?item=${link.id}`);
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Unsaved keyboard check");
  await page.getByRole("link", { name: "Skip to workspace" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill(link.title);
  await page.goto("/admin/links");
  await expect(page).toHaveTitle("Links · Emboss");
  await page
    .getByRole("textbox", { name: "Search links", exact: true })
    .fill(`${slug}-layout`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${slug}-layout`));
  await expect(
    page.getByRole("button", { name: new RegExp(`${slug}-layout`) }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search links", exact: true })
    .fill(`${slug}-missing`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`q=${slug}-missing`));
  await expect(
    page.getByRole("heading", { name: "No matching links" }),
  ).toBeVisible();
  await page.goto(`/admin/pastes?q=${paste.slug}`);
  await page.getByLabel("Filter pastes").click();
  await page.getByRole("option", { name: "Draft", exact: true }).click();
  await expect(
    page.getByText("No matching pastes.", { exact: true }),
  ).toBeVisible();
  for (const icon of ["/icon.svg", "/favicon.ico", "/apple-touch-icon.png"])
    expect((await request.get(icon)).status(), icon).toBe(200);
  for (const [kind, item] of [
    ["links", link],
    ["pastes", paste],
  ] as const) {
    const deleted = await request.delete(`/api/admin/${kind}/${item.id}`, {
      headers,
      data: { expectedRevision: item.revision },
    });
    expect(deleted.status()).toBe(204);
  }
});

test("Back and Forward keep drafts on cancel and preserve history on discard", async () => {
  const a = await json<Resource>("/api/admin/links", "POST", {
    title: "History A",
    slug: `${slug}-history-a`,
    destinationUrl: "https://example.org/a",
    state: "active",
    expiresAt: null,
  });
  const b = await json<Resource>("/api/admin/links", "POST", {
    title: "History B",
    slug: `${slug}-history-b`,
    destinationUrl: "https://example.org/b",
    state: "active",
    expiresAt: null,
  });
  await page.goto("/admin/links");
  await page.getByRole("button", { name: new RegExp(`/${a.slug}`) }).click();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue(a.title);
  await page
    .getByRole("button", { name: /^(Close editor|Back to links)$/ })
    .click();
  await page.getByRole("button", { name: new RegExp(`/${b.slug}`) }).click();
  const label = page.getByRole("textbox", { name: "Label", exact: true });
  await expect(label).toHaveValue(b.title);
  await label.fill("Keep backward draft");
  await page.evaluate(() => history.go(-2));
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`item=${b.id}`));
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(label).toHaveValue("Keep backward draft");
  await page.evaluate(() => history.go(-2));
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`item=${a.id}`));
  await expect(label).toHaveValue(a.title);
  await label.fill("Keep forward draft");
  await page.evaluate(() => history.go(2));
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`item=${a.id}`));
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(label).toHaveValue("Keep forward draft");
  await page.evaluate(() => history.go(2));
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`item=${b.id}`));
  await expect(label).toHaveValue(b.title);
  await page.evaluate(() => history.go(-2));
  await expect(label).toHaveValue(a.title);
  await page.evaluate(() => history.go(2));
  await expect(label).toHaveValue(b.title);
});

async function delaySave(
  path: string,
  method: string,
  submit: () => Promise<void>,
  edit: () => Promise<void>,
) {
  let release!: () => void, received!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    received = resolve;
  });
  const url = `${origin}${path}`;
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await submit();
    await pending;
    await edit();
  } finally {
    release();
  }
  await expect(page.locator(".editor-status:visible")).toHaveText(
    "Unsaved changes",
  );
  await page.unroute(url);
}

test("every editor retains typing during a delayed save and saves it with the new revision", async () => {
  const link = await json<Resource>("/api/admin/links", "POST", {
    title: "Race link",
    destinationUrl: "https://example.org/race",
    state: "active",
    expiresAt: null,
  });
  const paste = await json<Resource>("/api/admin/pastes", "POST", {
    title: "Race paste",
    body: "Race content",
    format: "text",
    language: "text",
    state: "active",
    expiresAt: null,
  });
  const upload = await json<{ uploadId: string }>("/api/admin/files", "POST", {
    filename: "race.txt",
    title: "Race file",
    bytes: 3,
  });
  const transferred = await request.put(
    `/api/admin/uploads/${upload.uploadId}`,
    {
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      data: Buffer.from("abc"),
    },
  );
  expect(transferred.ok()).toBeTruthy();
  for (const item of [
    {
      route: `links?item=${link.id}`,
      api: `/api/admin/links/${link.id}`,
      field: "Label",
      key: "title",
    },
    {
      route: `pastes?item=${paste.id}`,
      api: `/api/admin/pastes/${paste.id}`,
      field: "Title (optional)",
      key: "title",
    },
    {
      route: `files?item=${upload.uploadId}`,
      api: `/api/admin/files/${upload.uploadId}`,
      field: "Title",
      key: "title",
    },
    {
      route: "scheduling",
      api: "/api/admin/scheduling",
      field: "Provider",
      key: "providerLabel",
    },
    {
      route: "business-card",
      api: "/api/admin/business-card",
      field: "Display name",
      key: "displayName",
    },
    {
      route: "settings",
      api: "/api/admin/settings",
      field: "Site name",
      key: "label",
    },
  ]) {
    await page.goto(`/admin/${item.route}`);
    const input = page.getByRole("textbox", { name: item.field, exact: true });
    await input.fill("First saved value");
    const save = page.getByRole("button", {
      name: "Save changes",
      exact: true,
    });
    await delaySave(
      item.api,
      "PATCH",
      () => save.click(),
      () => input.fill("Second unsaved value"),
    );
    await expect(save).toBeEnabled();
    await expect(input).toHaveValue("Second unsaved value");
    expect(
      (await json<Record<string, unknown>>(item.api, "GET"))[item.key],
    ).toBe("First saved value");
    await save.click();
    await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
    expect(
      (await json<Record<string, unknown>>(item.api, "GET"))[item.key],
    ).toBe("Second unsaved value");
  }
});

test("creation keeps later typing across the first saved URL and New starts clean", async () => {
  for (const kind of ["links", "pastes"]) {
    await page.goto(`/admin/${kind}?item=new`);
    if (kind === "links")
      await page
        .getByText("Label, address and expiry", { exact: true })
        .filter({ visible: true })
        .click();
    const field = page.getByRole("textbox", {
      name: kind === "links" ? "Label" : "Title (optional)",
      exact: true,
    });
    await field.fill("First created value");
    if (kind === "links")
      await page
        .getByRole("textbox", { name: "Destination URL", exact: true })
        .fill("https://example.org/create");
    else
      await page
        .getByRole("textbox", { name: "Content", exact: true })
        .fill("Created content");
    await delaySave(
      `/api/admin/${kind}`,
      "POST",
      () =>
        page
          .getByRole("button", {
            name: kind === "links" ? "Create live link" : "Save draft",
            exact: true,
          })
          .click(),
      () => field.fill("Newer creation draft"),
    );
    await expect(page).toHaveURL(/item=[a-f0-9-]{36}/);
    await expect(field).toHaveValue("Newer creation draft");
    const id = new URL(page.url()).searchParams.get("item")!;
    await page
      .getByRole("button", {
        name: "Save changes",
        exact: true,
      })
      .click();
    await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
    expect(
      (await json<Resource>(`/api/admin/${kind}/${id}`, "GET")).title,
    ).toBe("Newer creation draft");
    await page
      .getByRole("button", {
        name: /^(Close editor|Back to links|Back to pastes)$/,
      })
      .click();
    await page
      .getByRole("button", {
        name: kind === "links" ? "New link" : "New paste",
        exact: true,
      })
      .first()
      .click();
    if (kind === "links")
      await page
        .getByText("Label, address and expiry", { exact: true })
        .filter({ visible: true })
        .click();
    await expect(field).toHaveValue("");
    await expect(page.locator(".editor-status:visible")).toHaveText(
      "Not saved",
    );
    const newAgain = page.getByRole("button", {
      name: kind === "links" ? "New link" : "New paste",
      exact: true,
    });
    if (await newAgain.isVisible()) {
      await field.fill("Keep this new draft");
      await newAgain.click();
      await expect(page.getByRole("alertdialog")).toContainText(
        "Discard unsaved changes?",
      );
      await page
        .getByRole("button", { name: "Keep editing", exact: true })
        .click();
      await expect(field).toHaveValue("Keep this new draft");
      await newAgain.click();
      await page
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();
      if (kind === "links")
        await page
          .getByText("Label, address and expiry", { exact: true })
          .filter({ visible: true })
          .click();
      await expect(field).toHaveValue("");
    }
  }
});

test("revoking published content ignores invalid drafts and preserves them", async () => {
  const paste = await json<Resource>("/api/admin/pastes", "POST", {
    title: "Revocation",
    body: "Saved content",
    format: "text",
    language: "text",
    state: "active",
    expiresAt: null,
  });
  await page.goto(`/admin/pastes?item=${paste.id}`);
  await page.getByRole("textbox", { name: "Content", exact: true }).fill("");
  await page
    .getByRole("button", { name: "Pause sharing", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish paste", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Content", exact: true }),
  ).toHaveValue("");
  expect(
    (await request.get(paste.url + "/raw", { maxRedirects: 0 })).status(),
  ).toBe(404);
  expect(
    (await json<Resource>(`/api/admin/pastes/${paste.id}`, "GET")).body,
  ).toBe("Saved content");
  await page
    .getByRole("textbox", { name: "Content", exact: true })
    .fill("Saved content");
  await page.goto("/admin/business-card");
  const name = page.getByRole("textbox", { name: "Display name", exact: true });
  await name.fill("Saved public identity");
  const publish = page.getByRole("button", {
    name: "Publish card",
    exact: true,
  });
  if (await publish.isVisible()) await publish.click();
  else
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
  await name.fill("");
  await page
    .getByRole("button", { name: "Pause sharing", exact: true })
    .click();
  await expect(publish).toBeVisible();
  await expect(name).toHaveValue("");
  await expect(page.locator(".editor-status:visible")).toHaveText(
    "Unsaved changes",
  );
  for (const path of ["/contact", "/contact.vcf", "/contact/avatar"])
    expect((await request.get(path)).status()).toBe(404);
  expect(
    (await json<{ displayName: string }>("/api/admin/business-card", "GET"))
      .displayName,
  ).toBe("Saved public identity");
  await name.fill("Saved public identity");
});

test("preserves filtered pages and returns focus after saving and closing", async () => {
  for (let index = 0; index < 3; index++) {
    await json<Resource>("/api/admin/links", "POST", {
      title: `${slug} collection ${index}`,
      destinationUrl: "https://example.org/collection",
      state: "active",
      expiresAt: null,
    });
  }
  await page.goto(`/admin/links?q=${slug}&state=active&limit=2`);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  const collection = new URL(page.url());
  const row = page.locator("[data-resource-id]").filter({ visible: true });
  await expect(row).toHaveCount(1);
  const id = await row.getAttribute("data-resource-id");
  await row.click();
  await page
    .getByRole("button", { name: /^(Close editor|Back to links)$/ })
    .click();
  await expect(
    page.locator(`[data-resource-id="${id}"]`).filter({ visible: true }),
  ).toBeFocused();
  await row.click();
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill(`${slug} revised collection`);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
  for (const name of ["q", "state", "cursor", "limit"]) {
    expect(new URL(page.url()).searchParams.get(name)).toBe(
      collection.searchParams.get(name),
    );
  }
  await page
    .getByRole("button", { name: /^(Close editor|Back to links)$/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search links", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(
    page.locator("[data-resource-id]").filter({ visible: true }),
  ).toHaveCount(2);
  await page
    .getByRole("textbox", { name: "Search links", exact: true })
    .fill("all");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=all/);
});

test("changing paste format and preview preserves exact stored line endings", async () => {
  const body = "const first = 1;\r\nconst second = 2;\r\n";
  const paste = await json<Resource>("/api/admin/pastes", "POST", {
    title: "Exact code",
    body,
    format: "text",
    language: "text",
    state: "draft",
    expiresAt: null,
  });
  await page.goto(`/admin/pastes?item=${paste.id}`);
  await expect(
    page.getByRole("combobox", { name: "Language", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("combobox", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "Code", exact: true }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "JavaScript", exact: true }).click();
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Wrap lines", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".editor-status:visible")).toHaveText("Saved");
  expect(
    (await json<Resource>(`/api/admin/pastes/${paste.id}`, "GET")).body,
  ).toBe(body);
  await page
    .getByRole("button", { name: "Publish paste", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause sharing", exact: true }),
  ).toBeVisible();
  expect(await (await request.get(`${paste.url}/raw`)).text()).toBe(body);
  const recipient = await context.newPage();
  await recipient.goto(paste.url);
  await expect(recipient).toHaveTitle(/Exact code/);
  await recipient
    .getByRole("button", { name: "Line numbers", exact: true })
    .click();
  await expect(recipient.locator(".cm-lineNumbers")).toBeVisible();
  await recipient.close();
});

test("failed and cancelled uploads can be retried without duplicate active transfers", async () => {
  await page.goto("/admin/files");
  let failed = false;
  const uploads = `${origin}/api/admin/uploads/*`;
  await page.route(uploads, async (route) => {
    if (route.request().method() === "PUT" && !failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Files to upload", exact: true })
    .setInputFiles({
      name: `${slug}-retry.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("Retry me"),
    });
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Uploaded · Only you", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Dismiss ${slug}-retry.txt`, exact: true })
    .click();
  await page.unroute(uploads);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(uploads, async (route) => {
    if (route.request().method() === "PUT") await held;
    await route.continue().catch(() => {});
  });
  await page
    .getByRole("button", { name: "Files to upload", exact: true })
    .setInputFiles({
      name: `${slug}-cancel.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("Cancel me"),
    });
  await expect(
    page.locator('.upload-job[data-state="uploading"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: new RegExp(`${slug}-retry\\.txt`) })
    .click();
  await expect(
    page.getByRole("complementary", { name: "File details" }),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Unsaved upload navigation");
  await page
    .getByRole("button", { name: /^(Close editor|Back to files)$/ })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Discard unsaved changes?",
  );
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/admin/files`);
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  const menu = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Leave while uploading?",
  );
  await page.getByRole("button", { name: "Stay here", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  const closeMenu = page.getByRole("button", {
    name: "Close navigation",
    exact: true,
  });
  if (await closeMenu.isVisible()) await closeMenu.click();
  await page
    .getByRole("button", { name: `Cancel ${slug}-cancel.txt`, exact: true })
    .click();
  release();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeEnabled();
  await page.unroute(uploads);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Uploaded · Only you", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review and publish", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "File details" }),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
});

test("waits for JavaScript before accepting editor input", async () => {
  const paste = await json<Resource>("/api/admin/pastes", "POST", {
    title: "Slow connection",
    body: "Saved content",
    format: "text",
    language: "text",
    state: "active",
    expiresAt: null,
  });
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
  await page.route(scripts, async (route) => {
    await loaded;
    await route.continue();
  });
  try {
    await page.goto(`/admin/pastes?item=${paste.id}`, { waitUntil: "commit" });
    const body = page.locator("textarea").filter({ visible: true });
    await expect(body).toHaveValue("Saved content");
    await expect(body).toBeDisabled();
    await expect(body).not.toBeEditable();
    release();
    await expect(body).toBeEditable();
    await body.fill("");
    await page
      .getByRole("button", { name: "Pause sharing", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Publish paste", exact: true }),
    ).toBeVisible();
    await expect(body).toHaveValue("");
    expect(
      (await json<Resource>(`/api/admin/pastes/${paste.id}`, "GET")).body,
    ).toBe("Saved content");
  } finally {
    release();
    await page.unroute(scripts);
  }
});

test("expired sessions preserve edits through reauthentication and sign-out revokes access", async ({}, info) => {
  await page.goto("/admin/links?item=new");
  await page
    .getByText("Label, address and expiry", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Destination URL", exact: true })
    .fill("https://example.org/reauth");
  await page
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Keep these edits");
  const logout = await request.post("/api/auth/logout", { headers, data: {} });
  expect(logout.status()).toBe(204);
  await page
    .getByRole("button", { name: "Create live link", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in again", exact: true })
    .click();
  await page.getByLabel("Admin password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Label", exact: true }),
  ).toHaveValue("Keep these edits");
  await page
    .getByRole("button", { name: "Create live link", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Edit link" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/item=[a-f0-9-]{36}/);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Admin session" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/links")).status()).toBe(401);
  expect(errors).toEqual([]);
});
