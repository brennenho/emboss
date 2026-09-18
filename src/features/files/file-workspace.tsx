"use client";
import { useState } from "react";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import {
  StatusBadge,
  ExpiryField,
  DeleteButton,
} from "@/components/patterns/resource-controls";
import { UploadControl } from "@/components/patterns/upload-control";
import {
  useEditorGuard,
  useNavigationGuard,
} from "@/components/patterns/navigation-guard";
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { api } from "@/shared/client-api";
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
  const [search, setSearch] = useState(query);
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
          <p>Upload once. Share a stable address when you’re ready.</p>
        </div>
      </header>
      <div className={`work-split ${selected ? "has-inspector" : ""}`}>
        <section className="min-w-0">
          <div className="border-b p-6">
            <UploadControl
              maxBytes={maxBytes}
              onComplete={() => router.refresh()}
            />
          </div>
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(undefined, { q: search });
            }}
          >
            <Input
              aria-label="Search files"
              placeholder="Search files"
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="outline">Search</Button>
            <Select
              value={state}
              onValueChange={(v) => navigate(undefined, { state: v })}
            >
              <SelectTrigger className="w-36" aria-label="Filter files">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "active", "draft", "disabled", "expired"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </form>
          {page.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">File</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
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
                    <TableCell className="pl-6">
                      <button
                        className="text-left"
                        onClick={() => navigate(item.id)}
                      >
                        <span className="row-title">{item.title}</span>
                        <span className="row-sub">/f/{item.slug}</span>
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {((item.bytes ?? 0) / 1024 ** 2).toFixed(2)} MiB
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
                {query ? "No matching files" : "Your files, ready to share."}
              </h2>
              <p>Choose a file above. Uploads begin as private drafts.</p>
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
        {selected && (
          <FileEditor
            key={`${selected.id}:${selected.revision}`}
            item={selected}
            onClose={() => navigate()}
            onSaved={() => router.refresh()}
            onDeleted={() => {
              router.replace("/admin/files");
              router.refresh();
            }}
          />
        )}
      </div>
    </>
  );
}
function FileEditor({
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: ResourceDto;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const initial = { title: item.title, expiresAt: item.expiresAt ?? "" };
  const [form, setForm] = useState(initial);
  useEditorGuard(JSON.stringify(form) !== JSON.stringify(initial));
  const mutation = useMutation();
  async function save(state: string) {
    await mutation.run(async () => {
      await api(`/api/admin/files/${item.id}`, "PATCH", {
        title: form.title,
        expiresAt: form.expiresAt || null,
        state,
        expectedRevision: item.revision,
      });
      onSaved();
    });
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
              if (window.confirm("Reload and discard your edits?")) onSaved();
            }}
          >
            Reload saved version
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
        <div className="form-actions">
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
                void save(item.state === "active" ? "disabled" : "active")
              }
            >
              {item.state === "active" ? "Disable" : "Publish file"}
            </Button>
          )}
        </div>
        <p className="muted">
          {item.uploadState === "ready"
            ? "Published files are unlisted. Anyone with the address can download them."
            : "This upload is not ready. Retry from the upload control or delete this attempt."}
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
