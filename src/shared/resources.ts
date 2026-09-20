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
    "Use lowercase letters and numbers, with hyphens between words.",
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
    "Enter an http:// or https:// URL without a username or password.",
  );
export const expirySchema = z.string().datetime({ offset: true }).nullable();
export const commonResourceSchema = z.object({
  title: z.string().trim().max(160),
  slug: slugSchema.optional(),
  expiresAt: expirySchema.default(null),
  state: z.enum(["draft", "active", "disabled"]),
});
export const linkSchema = commonResourceSchema.extend({
  title: commonResourceSchema.shape.title.default(""),
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
export const pasteFormatLabels = {
  text: "Plain text",
  code: "Code",
  markdown: "Markdown",
} satisfies Record<z.infer<typeof pasteSchema>["format"], string>;
export const pasteLanguageLabels: Record<string, string> = {
  text: "Plain text",
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  python: "Python",
  shell: "Shell",
  sql: "SQL",
  yaml: "YAML",
} satisfies Record<z.infer<typeof pasteSchema>["language"], string>;
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
const generatedAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";
export const generatedSlugLength = 4;
export function generatedSlug() {
  // Rejection sampling keeps the 31-character alphabet uniformly distributed.
  const limit = 256 - (256 % generatedAlphabet.length);
  while (true) {
    let slug = "";
    while (slug.length < generatedSlugLength) {
      for (const byte of crypto.getRandomValues(new Uint8Array(8))) {
        if (byte < limit)
          slug += generatedAlphabet[byte % generatedAlphabet.length];
        if (slug.length === generatedSlugLength) break;
      }
    }
    if (!reservedSlugs.has(slug)) return slug;
  }
}

export function emptyResource(kind: ResourceKind): ResourceDto {
  return {
    id: "",
    kind,
    title: "",
    slug: "",
    state: "draft",
    displayState: "draft",
    expiresAt: null,
    revision: 0,
    createdAt: "",
    updatedAt: "",
    url: "",
  };
}
export const resourceStateSchema = revisionSchema
  .extend({ state: z.enum(["active", "disabled"]) })
  .strict();
