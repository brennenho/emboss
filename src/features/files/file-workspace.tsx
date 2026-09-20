"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { X } from "lucide-react";
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
import { useNavigationGuard } from "@/components/patterns/navigation-guard";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { ResourceToolbar } from "@/components/patterns/resource-toolbar";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
import { formatBytes } from "@/shared/format";
import type { ResourceDto, ResourcePage } from "@/shared/resources";
export function FileWorkspace({
  page,
  selected,
  query,
  state,
  maxBytes,
}: {
  page: ResourcePage;
  selected: ResourceDto | null;
  query: string;
  state: string;
  maxBytes: number;
}) {
  const router = useRouter(),
    go = useNavigationGuard();
  function navigate(item?: string, extra?: Record<string, string>) {
    const p = new URLSearchParams({ q: query, state, ...extra });
    if (item) p.set("item", item);
    go(() => router.push(`/admin/files?${p}`));
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Files</h1>
        </div>
      </header>
      <div className={`work-split ${selected ? "has-inspector" : ""}`}>
        {selected && (
          <FileEditor
            key={selected.id}
            item={selected}
            onClose={() => navigate()}
            onSaved={() => router.refresh()}
            onDeleted={() => {
              router.replace("/admin/files");
              router.refresh();
            }}
          />
        )}
        <section className="collection-pane">
          <div className="upload-section">
            <UploadControl
              maxBytes={maxBytes}
              onComplete={() => router.refresh()}
            />
          </div>
          <ResourceToolbar
            key={query}
            kind="files"
            query={query}
            state={state}
            onSearch={(q) => navigate(undefined, { q })}
            onFilter={(state) => navigate(undefined, { state })}
          />
          {page.items.length ? (
            <Table className="resource-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="resource-name pl-6 max-sm:pl-4">
                    File
                  </TableHead>
                  <TableHead className="resource-size">Size</TableHead>
                  <TableHead className="resource-state">State</TableHead>
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
                        className="resource-row-button"
                        onClick={() => navigate(item.id)}
                      >
                        <span className="row-title">{item.title}</span>
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
                  : "Uploads stay private until published."}
              </p>
            </div>
          )}
          {page.nextCursor && (
            <Button
              variant="outline"
              className="m-6"
              onClick={() => navigate(undefined, { cursor: page.nextCursor! })}
            >
              Next page
            </Button>
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
  async function save(state: string) {
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
  async function changeState(state: "active" | "disabled") {
    if (!item) return;
    const saved = await editor.save(
      () =>
        api<ResourceDto>(`/api/admin/files/${item.id}/state`, "PATCH", {
          state,
          expectedRevision: item.revision,
        }),
      true,
    );
    if (saved) onSaved();
  }
  return (
    <aside className="inspector">
      <div className="inspector-top">
        <h2>File details</h2>
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
        <EditorActions
          dirty={editor.dirty}
          pending={mutation.pending}
          isNew={!editor.saved.id}
        >
          <Button
            disabled={mutation.pending}
            onClick={() => void save(item.state)}
          >
            Save changes
          </Button>
          {item.uploadState === "ready" && (
            <Button
              variant="outline"
              disabled={mutation.pending}
              onClick={() =>
                void changeState(
                  item.state === "active" ? "disabled" : "active",
                )
              }
            >
              {item.state === "active" ? "Disable" : "Publish file"}
            </Button>
          )}
        </EditorActions>
        <StatusBadge
          state={
            item.uploadState !== "ready"
              ? (item.uploadState ?? "pending")
              : item.displayState
          }
        />
        <AddressPlate url={item.url} />
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {mutation.error?.status === 409 && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm("Reload and discard your edits?"))
                window.location.reload();
            }}
          >
            Reload
          </Button>
        )}
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
          {item.filename} · {item.bytes?.toLocaleString()} bytes
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
          onChange={(v) => setForm({ ...form, expiresAt: v })}
          error={mutation.error?.fields?.expiresAt}
        />

        <p className="muted">
          {item.uploadState === "ready"
            ? "Anyone with the address can download published files."
            : "Upload incomplete. Retry the upload or delete this file."}
        </p>
        <div className="form-actions">
          <ShareDialog
            url={item.url}
            title={item.title}
            state={item.displayState}
          />
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
    </aside>
  );
}
