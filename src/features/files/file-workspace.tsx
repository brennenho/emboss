"use client";
import { EditorReady } from "@/components/patterns/editor-ready";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, File, FileImage, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import {
  StatusBadge,
  ExpiryField,
  DeleteButton,
} from "@/components/patterns/resource-controls";
import { UploadControl } from "@/components/patterns/upload-control";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { ConflictRecovery } from "@/components/patterns/conflict-recovery";
import { CopyButton } from "@/components/sharing/share-dialog";
import { ResourceSummary } from "@/components/patterns/resource-summary";
import { ResourceToolbar } from "@/components/patterns/resource-toolbar";
import { useCollectionNavigation } from "@/components/patterns/use-collection-navigation";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
import { formatBytes } from "@/shared/format";
import type {
  ResourceDto,
  ResourcePage,
  ResourceState,
} from "@/shared/resources";

function FileSymbol({ item }: { item: ResourceDto }) {
  const Icon = item.previewable
    ? FileImage
    : /\.(txt|md|csv|json|log|xml|yml|yaml|pdf)$/i.test(item.filename ?? "")
      ? FileText
      : File;
  return (
    <Icon
      size={18}
      className="text-muted-foreground shrink-0"
      aria-hidden="true"
    />
  );
}

export function FileWorkspace({
  page,
  selected,
  query,
  state,
  maxBytes,
  availableBytes,
}: {
  page: ResourcePage;
  selected: ResourceDto | null;
  query: string;
  state: string;
  maxBytes: number;
  availableBytes: number;
}) {
  const router = useRouter();
  const navigation = useCollectionNavigation("files");
  return (
    <>
      <header className="workspace-header">
        <h1>Files</h1>
      </header>
      <div className={`work-split ${selected ? "has-inspector" : ""}`}>
        {selected && (
          <FileEditor
            key={selected.id}
            item={selected}
            onClose={navigation.close}
            onSaved={() => router.refresh()}
            onDeleted={navigation.deleted}
          />
        )}
        <section className="collection-pane" aria-label="Files">
          <div className="upload-section">
            <UploadControl
              maxBytes={maxBytes}
              availableBytes={availableBytes}
              onComplete={() => router.refresh()}
              onReview={(item) => navigation.open(item.id)}
            />
          </div>
          <ResourceToolbar
            key={query}
            kind="files"
            query={query}
            state={state}
            onSearch={navigation.search}
            onFilter={navigation.filter}
          />
          {page.items.length ? (
            <Table className="resource-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="resource-name pl-6 max-sm:pl-4">
                    File
                  </TableHead>
                  <TableHead className="resource-size">Size</TableHead>
                  <TableHead className="resource-state">Status</TableHead>
                  <TableHead className="resource-row-actions">
                    <span className="sr-only">Share</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((item) => (
                  <TableRow
                    key={item.id}
                    data-state={
                      selected?.id === item.id ? "selected" : undefined
                    }
                  >
                    <TableCell className="resource-name pl-6 max-sm:pl-4">
                      <button
                        type="button"
                        className="resource-row-button"
                        {...navigation.rowProps(item.id)}
                        onClick={() => navigation.open(item.id)}
                      >
                        <span className="flex items-center gap-2">
                          <FileSymbol item={item} />
                          <span className="row-title">{item.title}</span>
                        </span>
                        <span className="row-sub">
                          <span className="compact-file-size">
                            {formatBytes(item.bytes ?? 0)} ·{" "}
                          </span>
                          /f/{item.slug}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="resource-size font-mono text-xs whitespace-nowrap">
                      {formatBytes(item.bytes ?? 0)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        state={
                          item.uploadState !== "ready"
                            ? (item.uploadState ?? "pending")
                            : item.displayState
                        }
                      />
                    </TableCell>
                    <TableCell className="resource-row-actions">
                      {item.displayState === "active" &&
                        item.uploadState === "ready" && (
                          <CopyButton
                            value={item.url}
                            label={`Copy link to ${item.title}`}
                          />
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="empty-state">
              <h2>
                {query || state !== "all"
                  ? "No matching files"
                  : "Upload your first file"}
              </h2>
              <p>
                {query || state !== "all"
                  ? "Try another search or filter."
                  : "Keep a file here, then publish it when you’re ready to share."}
              </p>
            </div>
          )}
          {(navigation.hasPrevious || page.nextCursor) && (
            <nav className="collection-pagination" aria-label="File pages">
              <Button
                variant="outline"
                disabled={!navigation.hasPrevious}
                onClick={navigation.previous}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                disabled={!page.nextCursor}
                onClick={() =>
                  page.nextCursor && navigation.next(page.nextCursor)
                }
              >
                Next
              </Button>
            </nav>
          )}
        </section>
      </div>
    </>
  );
}

function fileFields(item: ResourceDto) {
  return { title: item.title, expiresAt: item.expiresAt ?? "" };
}
function FileEditor({
  item: incoming,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: ResourceDto;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const editor = useEditor(incoming, fileFields);
  const { form, setForm, mutation, saved: item } = editor;
  async function save(state: ResourceState) {
    const saved = await editor.save(() =>
      api<ResourceDto>(`/api/admin/files/${item.id}`, "PATCH", {
        title: form.title,
        expiresAt: form.expiresAt || null,
        state,
        expectedRevision: item.revision,
      }),
    );
    if (saved) onSaved();
  }
  async function pause() {
    const saved = await editor.save(
      () =>
        api<ResourceDto>(`/api/admin/files/${item.id}/state`, "PATCH", {
          state: "disabled",
          expectedRevision: item.revision,
        }),
      true,
    );
    if (saved) onSaved();
  }
  return (
    <aside
      className="inspector"
      aria-label="File details"
      data-revision={item.revision}
    >
      <EditorReady>
        <Button variant="ghost" className="inspector-back" onClick={onClose}>
          <ArrowLeft />
          Back to files
        </Button>
        <div className="inspector-top">
          <h2 data-editor-heading tabIndex={-1}>
            {item.title}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close editor"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <div className="form-stack">
          <ResourceSummary
            url={item.url}
            title={item.title}
            state={
              item.uploadState === "ready"
                ? item.displayState
                : (item.uploadState ?? "pending")
            }
          />
          <EditorActions dirty={editor.dirty} pending={mutation.pending}>
            {item.uploadState === "ready" && item.state !== "active" && (
              <Button
                disabled={mutation.pending}
                onClick={() => void save("active")}
              >
                {editor.dirty ? "Save and publish" : "Publish file"}
              </Button>
            )}
            <Button
              variant={
                item.state === "active" && editor.dirty ? "default" : "outline"
              }
              disabled={mutation.pending || !editor.dirty}
              onClick={() => void save(item.state)}
            >
              Save changes
            </Button>
            {item.state === "active" && (
              <Button
                variant="outline"
                disabled={mutation.pending}
                onClick={() => void pause()}
              >
                Pause sharing
              </Button>
            )}
          </EditorActions>
          <MutationFeedback
            {...mutation}
            onReauthenticated={() => mutation.setError(null)}
          />
          <ConflictRecovery
            error={mutation.error}
            draft={form}
            loadLatest={() => api<ResourceDto>(`/api/admin/files/${item.id}`)}
            onUseLatest={editor.reset}
          />
          <FormField
            id="title"
            label="Title"
            error={mutation.error?.fields?.title}
          >
            <Input
              {...fieldProps("title", mutation.error?.fields)}
              value={form.title}
              maxLength={160}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </FormField>
          <p className="muted break-all">
            {item.filename} · {formatBytes(item.bytes ?? 0)}
          </p>
          {item.previewable && item.uploadState === "ready" && (
            <Image
              unoptimized
              src={`/api/admin/files/${item.id}/preview`}
              alt={item.title}
              width={320}
              height={240}
              className="h-auto max-h-64 w-full object-contain"
            />
          )}
          <ExpiryField
            value={form.expiresAt}
            onChange={(value) => setForm({ ...form, expiresAt: value })}
            error={mutation.error?.fields?.expiresAt}
          />
          {item.uploadState !== "ready" && (
            <p className="muted">
              Upload incomplete. Retry the upload or delete this file.
            </p>
          )}
          <div className="form-actions border-t pt-5">
            {item.uploadState === "ready" && (
              <Button asChild variant="outline">
                <a href={`/api/admin/files/${item.id}/download`} download>
                  Download
                </a>
              </Button>
            )}
            <DeleteButton
              title={item.title}
              pending={mutation.pending}
              onDelete={() =>
                void mutation.run(async () => {
                  await api(`/api/admin/files/${item.id}`, "DELETE", {
                    expectedRevision: item.revision,
                  });
                  onDeleted();
                })
              }
            />
          </div>
        </div>
      </EditorReady>
    </aside>
  );
}
