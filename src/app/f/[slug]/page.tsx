import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import { Download, FileText, File } from "lucide-react";
import { notFound } from "next/navigation";
import { bindings } from "@/server/runtime";
import { findFile, fileTextPreview } from "@/server/storage/downloads";
import { slugSchema } from "@/shared/resources";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/shared/format";
export const dynamic = "force-dynamic";
const readFile = cache(async (slug: string) =>
  slugSchema.safeParse(slug).success ? findFile(bindings(), slug) : null,
);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const file = await readFile((await params).slug);
  return { title: file?.title ?? "Link unavailable" };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const file = await readFile(slug);
  if (!file) notFound();
  const image =
    file.width &&
    file.height &&
    ["image/png", "image/jpeg", "image/webp"].includes(
      file.detected_type ?? "",
    );
  const preview = image ? null : await fileTextPreview(bindings(), file);
  return (
    <main className="public-page">
      <header className="public-header">
        <div>
          <h1>{file.title}</h1>
          <p className="public-meta">
            {file.original_filename} · {formatBytes(file.expected_bytes)}
            {file.expires_at
              ? ` · Expires ${new Date(file.expires_at).toISOString().slice(0, 16).replace("T", " ")} UTC`
              : ""}
          </p>
        </div>
        <Button asChild>
          <a href={`/f/${slug}/download`} download>
            <Download /> Download file
          </a>
        </Button>
      </header>
      {image ? (
        <div className="file-preview">
          <Image
            src={`/f/${slug}/preview`}
            alt={file.title}
            width={file.width!}
            height={file.height!}
            unoptimized
            className="mx-auto h-auto max-h-[70vh] max-w-full object-contain"
          />
        </div>
      ) : preview ? (
        <section className="file-preview" aria-label="Text preview">
          <div className="file-preview-caption">
            <FileText size={16} aria-hidden="true" />
            <span>
              {preview.truncated ? "Preview · First 64 KB" : "Text preview"}
            </span>
          </div>
          <pre className="overflow-auto p-5 font-mono text-sm leading-7 break-words whitespace-pre-wrap">
            {preview.text}
          </pre>
          {preview.truncated && (
            <p className="file-preview-caption">
              Download the file to read the rest.
            </p>
          )}
        </section>
      ) : (
        <section className="file-summary" aria-label="File details">
          <File size={40} strokeWidth={1.25} aria-hidden="true" />
          <h2>{file.original_filename}</h2>
          <p className="muted">
            {formatBytes(file.expected_bytes)} · Ready to download
          </p>
          <p>Download this file to open it in your preferred app.</p>
        </section>
      )}
    </main>
  );
}
