import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { bindings } from "@/server/runtime";
import { publicResource, resourceDto } from "@/server/resource-store";
import {
  slugSchema,
  pasteFormatLabels,
  pasteLanguageLabels,
} from "@/shared/resources";
import { PasteContent } from "@/features/pastes/paste-content";
import { CopyButton } from "@/components/sharing/share-dialog";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
const readPaste = cache(async (slug: string) => {
  if (!slugSchema.safeParse(slug).success) return null;
  const env = bindings();
  const row = await publicResource(env, "paste", slug);
  return row ? resourceDto(env, row, true) : null;
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const paste = await readPaste((await params).slug);
  return { title: paste?.title ?? "Link unavailable" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const paste = await readPaste(slug);
  if (!paste) notFound();
  return (
    <main className="public-page">
      <header className="public-header">
        <div>
          <h1>{paste.title}</h1>
          <p className="public-meta">
            {paste.format === "code"
              ? (pasteLanguageLabels[paste.language ?? "text"] ?? "Code")
              : pasteFormatLabels[paste.format ?? "text"]}
            {paste.expiresAt
              ? ` · Expires ${paste.expiresAt.slice(0, 16).replace("T", " ")} UTC`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <CopyButton value={paste.body ?? ""} label="Copy content" />
          <Button asChild variant="outline">
            <a href={`/p/${slug}/raw`}>Raw text</a>
          </Button>
        </div>
      </header>
      <section className="public-document" aria-label="Shared content">
        <PasteContent
          body={paste.body ?? ""}
          format={paste.format ?? "text"}
          language={paste.language ?? "text"}
        />
      </section>
    </main>
  );
}
