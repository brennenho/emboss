import Image from "next/image";
import { notFound } from "next/navigation";
import { bindings } from "@/server/runtime";
import { findFile } from "@/server/storage/downloads";
import { slugSchema } from "@/shared/resources";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!slugSchema.safeParse(slug).success) notFound();
  const file = await findFile(bindings(), slug);
  if (!file) notFound();
  return (
    <main className="public-page">
      <header className="public-header">
        <div>
          <h1>{file.title}</h1>
          <p className="public-meta">
            {file.original_filename} ·{" "}
            {(file.expected_bytes / 1024 ** 2).toFixed(2)} MiB
            {file.expires_at
              ? ` · Expires ${new Date(file.expires_at).toISOString().slice(0, 16).replace("T", " ")} UTC`
              : ""}
          </p>
        </div>
        <Button asChild>
          <a href={`/f/${slug}/download`} download>
            Download file
          </a>
        </Button>
      </header>
      {file.width && file.height && file.detected_type?.startsWith("image/") ? (
        <Image
          src={`/f/${slug}/preview`}
          alt={file.title}
          width={file.width}
          height={file.height}
          unoptimized
          className="mx-auto h-auto max-h-[70vh] max-w-full object-contain"
        />
      ) : (
        <div className="quiet-panel">
          <h2>Ready to download</h2>
          <p className="muted mt-2">This file is available as an attachment.</p>
        </div>
      )}
    </main>
  );
}
