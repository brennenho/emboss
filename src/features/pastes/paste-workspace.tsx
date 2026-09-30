"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
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
import { useCollectionNavigation } from "@/components/patterns/use-collection-navigation";
import { ConflictRecovery } from "@/components/patterns/conflict-recovery";
import { CopyButton } from "@/components/sharing/share-dialog";
import { ResourceSummary } from "@/components/patterns/resource-summary";
import { ResourceToolbar } from "@/components/patterns/resource-toolbar";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { emptyResource } from "@/shared/resources";
import { api } from "@/shared/client-api";
import {
  generatedContentSlugLength,
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
  const navigation = useCollectionNavigation("pastes");
  function create() {
    navigation.open("new", () => {
      setCreatedId(null);
      setNewVersion((v) => v + 1);
    });
  }
  return (
    <>
      <header
        className="workspace-header"
        data-editing={!!selected || creating}
      >
        <div>
          <h1>Pastes</h1>
        </div>
        <Button className="workspace-new-action" onClick={create}>
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
            onClose={navigation.close}
            onSaved={(item) => {
              if (creating) setCreatedId(item.id);
              navigation.saved(item.id);
            }}
            onDeleted={navigation.deleted}
          />
        ) : (
          <section className="empty-state paste-empty">
            <h2>Select a paste</h2>
            <p>Choose a paste or create one.</p>
            <Button onClick={create}>
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
            onSearch={navigation.search}
            onFilter={navigation.filter}
            compact
          />
          {page.items.map((item) => (
            <div
              key={item.id}
              className="paste-row"
              data-selected={selected?.id === item.id}
            >
              <button
                {...navigation.rowProps(item.id)}
                className="paste-row-open"
                onClick={() => navigation.open(item.id)}
                aria-pressed={selected?.id === item.id}
              >
                <span className="row-title block">{item.title}</span>
                <span className="row-sub font-mono">
                  /p/{item.slug} · {pasteFormatLabels[item.format ?? "text"]}
                </span>
                <StatusBadge state={item.displayState} />
              </button>
              {item.displayState === "active" && (
                <div className="row-actions">
                  <CopyButton
                    value={item.url}
                    label={`Copy link to ${item.title}`}
                  />
                </div>
              )}
            </div>
          ))}
          {!page.items.length && (
            <p className="muted p-4">
              {query || state !== "all"
                ? "No matching pastes."
                : "No pastes yet."}
            </p>
          )}
          {(navigation.hasPrevious || page.nextCursor) && (
            <nav className="collection-pagination" aria-label="Paste pages">
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
  const bodyError =
    mutation.error?.fields?.body ??
    (bytes > maxBytes
      ? `Content is ${(bytes - maxBytes).toLocaleString()} bytes over the limit.`
      : undefined);
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
    <section className="paste-editor" aria-labelledby="paste-editor-title">
      <Button className="inspector-back" variant="ghost" onClick={onClose}>
        <ArrowLeft />
        Back to pastes
      </Button>
      <div className="inspector-top">
        <h2 id="paste-editor-title" data-editor-heading tabIndex={-1}>
          {item ? item.title : "New paste"}
        </h2>
        <Button
          className="inspector-close"
          size="icon"
          variant="ghost"
          aria-label="Close editor"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="form-stack paste-composer">
        {item && (
          <ResourceSummary
            url={item.url}
            title={item.title}
            state={item.displayState}
          />
        )}
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {item && (
          <ConflictRecovery
            error={mutation.error}
            draft={form}
            loadLatest={() =>
              api<ResourceDto>(`/api/admin/pastes/${item.id}`, "GET")
            }
            onUseLatest={editor.reset}
          />
        )}
        <div className="paste-title-field">
          <FormField
            id="title"
            label="Title (optional)"
            error={mutation.error?.fields?.title}
          >
            <Input
              {...fieldProps("title", mutation.error?.fields)}
              value={form.title}
              onChange={(e) => change("title", e.target.value)}
              maxLength={160}
              placeholder="Untitled paste"
            />
          </FormField>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="paste-toolbar">
            <div className="paste-format-controls">
              <Select
                value={form.format}
                onValueChange={(v) => change("format", v)}
              >
                <SelectTrigger id="format" aria-label="Format">
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
              {form.format === "code" && (
                <Select
                  value={form.language}
                  onValueChange={(v) => change("language", v)}
                >
                  <SelectTrigger id="language" aria-label="Language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(pasteLanguageLabels).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            <TabsList aria-label="Paste view">
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="edit" forceMount hidden={tab !== "edit"}>
            <FormField
              id="body"
              label="Content"
              error={bodyError}
              help={`${bytes.toLocaleString()} / ${maxBytes.toLocaleString()} bytes`}
            >
              {form.format === "code" ? (
                <CodeEditor
                  autoFocus={!item}
                  error={bodyError}
                  value={form.body}
                  language={form.language}
                  onChange={(v) => change("body", v)}
                />
              ) : (
                <Textarea
                  {...fieldProps(
                    "body",
                    bodyError ? { body: bodyError } : undefined,
                    true,
                  )}
                  className="paste-body [field-sizing:fixed] h-[clamp(260px,44dvh,480px)] font-mono"
                  value={form.body}
                  onChange={(e) => change("body", e.target.value)}
                  autoFocus={!item}
                  spellCheck={true}
                  placeholder="Write or paste your content…"
                />
              )}
            </FormField>
          </TabsContent>
          <TabsContent value="preview">
            <div className="editor-surface paste-preview p-5">
              {form.body ? (
                <MarkdownPreview
                  body={form.body}
                  format={form.format}
                  language={form.language}
                />
              ) : (
                <p className="muted">Your content will appear here.</p>
              )}
            </div>
            <p className="muted mt-2">Preview of your current edits.</p>
          </TabsContent>
        </Tabs>
        <details
          className="sharing-options paste-sharing-options"
          open={
            !!(
              mutation.error?.fields?.slug || mutation.error?.fields?.expiresAt
            )
          }
        >
          <summary>Sharing options</summary>
          <div className="form-grid">
            <FormField
              id="slug"
              label={item ? "Short address" : "Custom address"}
              help={
                item
                  ? "Fixed after creation."
                  : form.slug.trim()
                    ? `${origin}/p/${form.slug.trim()}`
                    : `Leave blank to generate ${generatedContentSlugLength} characters.`
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
          <p className="muted">
            Anyone with the link can read a published paste.
          </p>
        </details>
        {!item && (
          <p className="muted">Only you can open this until you publish it.</p>
        )}
        <EditorActions
          dirty={editor.dirty}
          pending={mutation.pending}
          isNew={!editor.saved.id}
        >
          {item?.displayState === "active" && !editor.dirty ? (
            <CopyButton
              value={item.url}
              label="Copy link"
              showLabel
              variant="default"
            />
          ) : (
            <Button
              disabled={
                mutation.pending ||
                bytes > maxBytes ||
                !form.body ||
                (!!item && !editor.dirty)
              }
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
          )}
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
            {item?.state === "active" ? "Pause sharing" : "Publish paste"}
          </Button>
        </EditorActions>
        {item && (
          <div className="form-actions resource-danger-zone">
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
      </div>
    </section>
  );
}
