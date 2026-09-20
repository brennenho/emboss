"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import {
  ExpiryField,
  StatusBadge,
  DeleteButton,
} from "@/components/patterns/resource-controls";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { useNavigationGuard } from "@/components/patterns/navigation-guard";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { ResourceToolbar } from "@/components/patterns/resource-toolbar";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { emptyResource } from "@/shared/resources";
import { api } from "@/shared/client-api";
import {
  generatedSlugLength,
  pasteFormatLabels,
  pasteLanguageLabels,
  type ResourceDto,
  type ResourcePage,
} from "@/shared/resources";
const CodeEditor = dynamic(() => import("./code-editor"), {
  ssr: false,
  loading: () => (
    <p className="editor-surface p-4" role="status">
      Loading editor…
    </p>
  ),
});
const MarkdownPreview = dynamic(
  () => import("./paste-content").then((m) => m.PasteContent),
  { loading: () => <p role="status">Loading preview…</p> },
);
export function PasteWorkspace({
  page,
  selected,
  creating,
  origin,
  query,
  state,
  maxBytes,
}: {
  page: ResourcePage;
  selected: ResourceDto | null;
  creating: boolean;
  origin: string;
  query: string;
  state: string;
  maxBytes: number;
}) {
  const [newVersion, setNewVersion] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const router = useRouter(),
    go = useNavigationGuard();
  function navigate(item?: string, extra?: Record<string, string>) {
    const p = new URLSearchParams({ q: query, state, ...extra });
    if (item) p.set("item", item);
    go(() => {
      if (item === "new") {
        setCreatedId(null);
        setNewVersion((v) => v + 1);
      }
      router.push(`/admin/pastes?${p}`);
    });
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Pastes</h1>
        </div>
        <Button onClick={() => navigate("new")}>
          <Plus />
          New paste
        </Button>
      </header>
      <div className="paste-workspace" data-editing={!!selected || creating}>
        {selected || creating ? (
          <PasteEditor
            key={
              selected && selected.id !== createdId
                ? selected.id
                : `new-${newVersion}`
            }
            item={selected}
            origin={origin}
            maxBytes={maxBytes}
            onClose={() => navigate()}
            onSaved={(item) => {
              if (creating) setCreatedId(item.id);
              router.replace(`/admin/pastes?item=${item.id}`);
              router.refresh();
            }}
            onDeleted={() => {
              router.replace("/admin/pastes");
              router.refresh();
            }}
          />
        ) : (
          <section className="empty-state paste-empty">
            <h2>Select a paste</h2>
            <p>Choose a paste or create one.</p>
            <Button onClick={() => navigate("new")}>
              <Plus />
              New paste
            </Button>
          </section>
        )}
        <section className="paste-library">
          <ResourceToolbar
            key={query}
            kind="pastes"
            query={query}
            state={state}
            onSearch={(q) => navigate(undefined, { q })}
            onFilter={(state) => navigate(undefined, { state })}
            compact
          />
          {page.items.map((item) => (
            <button
              key={item.id}
              className="paste-row"
              onClick={() => navigate(item.id)}
              aria-pressed={selected?.id === item.id}
            >
              <span className="row-title block">{item.title}</span>
              <span className="row-sub font-mono">
                /p/{item.slug} · {pasteFormatLabels[item.format ?? "text"]}
              </span>
              <StatusBadge state={item.displayState} />
            </button>
          ))}
          {!page.items.length && (
            <p className="muted p-4">
              {query || state !== "all"
                ? "No matching pastes."
                : "No pastes yet."}
            </p>
          )}
          {page.nextCursor && (
            <Button
              variant="outline"
              className="m-4"
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
function pasteFields(item: ResourceDto) {
  return {
    title: item.title ?? "",
    slug: item.slug ?? "",
    body: item.body ?? "",
    format: item.format ?? "text",
    language: item.language ?? "text",
    expiresAt: item.expiresAt ?? "",
  };
}
function PasteEditor({
  item: incoming,
  origin,
  maxBytes,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: ResourceDto | null;
  origin: string;
  maxBytes: number;
  onClose: () => void;
  onSaved: (item: ResourceDto) => void;
  onDeleted: () => void;
}) {
  const editor = useEditor(incoming ?? emptyResource("paste"), pasteFields);
  const { form, setForm, mutation } = editor;
  const item = editor.saved.id ? editor.saved : null;
  const [tab, setTab] = useState("edit"),
    [key, setKey] = useState(() => crypto.randomUUID());
  const bytes = new TextEncoder().encode(form.body).length;
  function change(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setKey(crypto.randomUUID());
  }
  async function save(state: "draft" | "active" | "disabled") {
    const saved = await editor.save(async () => {
      const payload = {
        title: form.title,
        body: form.body,
        format: form.format,
        language: form.language,
        expiresAt: form.expiresAt || null,
        state,
        ...(item
          ? { expectedRevision: item.revision }
          : form.slug
            ? { slug: form.slug }
            : {}),
      };
      return api<ResourceDto>(
        item ? `/api/admin/pastes/${item.id}` : "/api/admin/pastes",
        item ? "PATCH" : "POST",
        payload,
        key + state,
      );
    });
    if (saved) onSaved(saved);
  }
  async function changeState(state: "active" | "disabled") {
    if (!item) return;
    const saved = await editor.save(
      () =>
        api<ResourceDto>(`/api/admin/pastes/${item.id}/state`, "PATCH", {
          state,
          expectedRevision: item.revision,
        }),
      true,
    );
    if (saved) onSaved(saved);
  }
  return (
    <section className="paste-editor">
      <div className="inspector-top">
        <div>
          <h2>{item ? item.title : "New paste"}</h2>
          {item && <StatusBadge state={item.displayState} />}
        </div>
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
            disabled={mutation.pending || bytes > maxBytes || !form.body}
            onClick={() =>
              void save(
                item?.state === "disabled"
                  ? "disabled"
                  : item?.state === "active"
                    ? "active"
                    : "draft",
              )
            }
          >
            {mutation.pending
              ? "Saving…"
              : item
                ? "Save changes"
                : "Save draft"}
          </Button>
          <Button
            variant="outline"
            disabled={
              mutation.pending ||
              (item?.state !== "active" && (bytes > maxBytes || !form.body))
            }
            onClick={() =>
              void (item?.state === "active"
                ? changeState("disabled")
                : save("active"))
            }
          >
            {item?.state === "active" ? "Disable" : "Publish paste"}
          </Button>
        </EditorActions>
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {mutation.error?.status === 409 && item && (
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
        {item && <AddressPlate url={item.url} />}
        <FormField
          id="title"
          label="Title"
          error={mutation.error?.fields?.title}
        >
          <Input
            {...fieldProps("title", mutation.error?.fields)}
            value={form.title}
            onChange={(e) => change("title", e.target.value)}
            maxLength={160}
            autoFocus={!item}
            placeholder="Untitled paste"
          />
        </FormField>
        <div className="form-grid">
          <FormField id="format" label="Format">
            <Select
              value={form.format}
              onValueChange={(v) => change("format", v)}
            >
              <SelectTrigger id="format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(pasteFormatLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="language" label="Language">
            <Select
              value={form.language}
              onValueChange={(v) => change("language", v)}
              disabled={form.format !== "code"}
            >
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(pasteLanguageLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Paste view">
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <FormField
              id="body"
              label="Content"
              error={mutation.error?.fields?.body}
              help={`${bytes.toLocaleString()} / ${maxBytes.toLocaleString()} bytes`}
            >
              {form.format === "code" ? (
                <CodeEditor
                  error={mutation.error?.fields?.body}
                  value={form.body}
                  language={form.language}
                  onChange={(v) => change("body", v)}
                />
              ) : (
                <Textarea
                  {...fieldProps("body", mutation.error?.fields, true)}
                  className="paste-body [field-sizing:fixed] h-[clamp(260px,44dvh,480px)] min-h-85 font-mono"
                  value={form.body}
                  onChange={(e) => change("body", e.target.value)}
                  spellCheck={true}
                />
              )}
            </FormField>
          </TabsContent>
          <TabsContent value="preview">
            <div className="editor-surface paste-preview p-5">
              <MarkdownPreview body={form.body} format={form.format} />
            </div>
            <p className="muted mt-2">
              Preview updates as you edit. Save to apply changes.
            </p>
          </TabsContent>
        </Tabs>
        <div className="form-grid">
          <FormField
            id="slug"
            label={item ? "Short address" : "Custom address"}
            help={
              item
                ? "Fixed after creation."
                : form.slug.trim()
                  ? `${origin}/p/${form.slug.trim()}`
                  : `Leave blank to generate ${generatedSlugLength} characters.`
            }
            error={mutation.error?.fields?.slug}
          >
            <Input
              {...fieldProps("slug", mutation.error?.fields, true)}
              value={form.slug}
              onChange={(e) => change("slug", e.target.value)}
              disabled={!!item}
              placeholder="Automatic"
              maxLength={48}
              autoCapitalize="none"
              spellCheck={false}
            />
          </FormField>
          <ExpiryField
            value={form.expiresAt}
            onChange={(v) => change("expiresAt", v)}
            error={mutation.error?.fields?.expiresAt}
          />
        </div>

        {item && (
          <div className="form-actions border-t pt-5">
            <ShareDialog
              url={item.url}
              title={item.title}
              state={item.displayState}
            />
            <DeleteButton
              title={item.title}
              pending={mutation.pending}
              onDelete={() =>
                void mutation.run(async () => {
                  await api(`/api/admin/pastes/${item.id}`, "DELETE", {
                    expectedRevision: item.revision,
                  });
                  onDeleted();
                })
              }
            />
          </div>
        )}
        <p className="muted">
          Anyone with the address can read published pastes.
        </p>
      </div>
    </section>
  );
}
