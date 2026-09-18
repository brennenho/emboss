import { z } from "zod";

export type ResourceKind = "link" | "paste" | "file";
export type ResourceState = "draft" | "active" | "disabled" | "deleted";
export const reservedSlugs = new Set([
  "admin",
  "api",
  "p",
  "f",
  "meet",
  "contact",
  "contact.vcf",
  "assets",
  "_next",
  "robots.txt",
  "favicon.ico",
  "cdn-cgi",
  ".well-known",
]);
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and internal hyphens.",
  )
  .refine((x) => !reservedSlugs.has(x), "This address is reserved.");
export function canonicalUrl(origin: string, kind: ResourceKind, slug: string) {
  return `${origin}/${kind === "link" ? "" : kind === "paste" ? "p/" : "f/"}${slug}`;
}
export function available(
  resource: {
    state: string;
    expiresAt: number | null;
    deletedAt: number | null;
  },
  now = Date.now(),
  blobState?: string,
) {
  return (
    resource.state === "active" &&
    resource.deletedAt === null &&
    (resource.expiresAt === null || now < resource.expiresAt) &&
    (blobState === undefined || blobState === "ready")
  );
}
export function displayState(
  resource: { state: ResourceState; expiresAt: number | null },
  now = Date.now(),
) {
  return resource.state !== "deleted" &&
    resource.expiresAt !== null &&
    resource.expiresAt <= now
    ? "expired"
    : resource.state;
}
export function webUrl(value: string, httpsOnly = false) {
  if (
    value.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(value) ||
    !/^https?:\/\//.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (httpsOnly
        ? url.protocol === "https:"
        : ["https:", "http:"].includes(url.protocol))
    );
  } catch {
    return false;
  }
}
export const urlSchema = z
  .string()
  .max(2048)
  .refine(
    (v) => webUrl(v),
    "Enter an absolute HTTP or HTTPS URL without credentials.",
  );
export const expirySchema = z.string().datetime({ offset: true }).nullable();
export const commonResourceSchema = z.object({
  title: z.string().trim().max(160),
  slug: slugSchema.optional(),
  expiresAt: expirySchema.default(null),
  state: z.enum(["draft", "active", "disabled"]),
});
export const linkSchema = commonResourceSchema.extend({
  destinationUrl: urlSchema,
});
export const pasteSchema = commonResourceSchema.extend({
  body: z.string().min(1),
  format: z.enum(["text", "code", "markdown"]),
  language: z
    .enum([
      "text",
      "javascript",
      "typescript",
      "json",
      "html",
      "css",
      "python",
      "shell",
      "sql",
      "yaml",
    ])
    .default("text"),
});
export const revisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const linkUpdateSchema = linkSchema
  .omit({ slug: true })
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
export const pasteUpdateSchema = pasteSchema
  .omit({ slug: true })
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
export const fileUpdateSchema = commonResourceSchema
  .omit({ slug: true })
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
export type ResourceDto = {
  id: string;
  kind: ResourceKind;
  slug: string;
  title: string;
  state: ResourceState;
  displayState: string;
  expiresAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  url: string;
  destinationUrl?: string;
  body?: string;
  format?: "text" | "code" | "markdown";
  language?: string;
  filename?: string;
  bytes?: number;
  uploadState?: string;
  previewable?: boolean;
  uploadId?: string;
};
export type ResourcePage = { items: ResourceDto[]; nextCursor: string | null };
export const listSchema = z.object({
  q: z.string().max(200).default(""),
  state: z
    .enum(["all", "draft", "active", "disabled", "expired"])
    .default("all"),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export function generatedSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const byte of bytes) {
    if (byte < 252) out += "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36];
    if (out.length === 8) return out;
  }
  return generatedSlug();
}
