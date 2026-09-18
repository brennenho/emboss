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
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import {
  useEditorGuard,
  useNavigationGuard,
} from "@/components/patterns/navigation-guard";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { api } from "@/shared/client-api";
import type { ResourceDto, ResourcePage } from "@/shared/resources";
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
const languages = [
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
];
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
  const router = useRouter(),
    go = useNavigationGuard();
  const [search, setSearch] = useState(query);
  function navigate(item?: string, extra?: Record<string, string>) {
    const p = new URLSearchParams({ q: query, state, ...extra });
    if (item) p.set("item", item);
    go(() => router.push(`/admin/pastes?${p}`));
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Pastes</h1>
          <p>Text, code, and notes at a lasting address.</p>
        </div>
        <Button onClick={() => navigate("new")}>
          <Plus />
          New paste
        </Button>
      </header>
      <div className="paste-workspace">
        <section className="paste-library">
          <form
            className="form-stack border-b p-4"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(undefined, { q: search });
            }}
          >
            <Input
              aria-label="Search pastes"
              placeholder="Search pastes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={200}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="outline">
                Search
              </Button>
              <Select
                value={state}
                onValueChange={(v) => navigate(undefined, { state: v })}
              >
                <SelectTrigger aria-label="Filter pastes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["all", "active", "draft", "disabled", "expired"].map(
                    (v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </form>
          {page.items.map((item) => (
            <button
              key={item.id}
              className={`hover:bg-accent block w-full border-b p-4 text-left ${selected?.id === item.id ? "bg-accent" : ""}`}
              onClick={() => navigate(item.id)}
              aria-pressed={selected?.id === item.id}
            >
              <span className="row-title block">{item.title}</span>
              <span className="muted mb-2 block">
                /p/{item.slug} · {item.format}
              </span>
              <StatusBadge state={item.displayState} />
            </button>
          ))}
          {!page.items.length && (
            <p className="muted p-4">
              {query ? "No matching pastes." : "Your pastes will appear here."}
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
        {selected || creating ? (
          <PasteEditor
            key={`${selected?.id ?? "new"}:${selected?.revision ?? 0}`}
            item={selected}
            origin={origin}
            maxBytes={maxBytes}
            onClose={() => navigate()}
            onSaved={(item) => {
              router.replace(`/admin/pastes?item=${item.id}`);
              router.refresh();
            }}
            onDeleted={() => {
              router.replace("/admin/pastes");
              router.refresh();
            }}
          />
        ) : (
          <section className="empty-state">
            <h2>A small place for useful things.</h2>
            <p>
              Create a paste or select one from the library. Drafts stay private
              until you publish.
            </p>
            <Button onClick={() => navigate("new")}>
              <Plus />
              New paste
            </Button>
          </section>
        )}
      </div>
    </>
  );
}
function PasteEditor({
  item,
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
  const initial = {
    title: item?.title ?? "",
    slug: item?.slug ?? "",
    body: item?.body ?? "",
    format: item?.format ?? "text",
    language: item?.language ?? "text",
    expiresAt: item?.expiresAt ?? "",
  };
  const [form, setForm] = useState(initial),
    [tab, setTab] = useState("edit"),
    [key, setKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation();
  useEditorGuard(JSON.stringify(form) !== JSON.stringify(initial));
  const bytes = new TextEncoder().encode(form.body).length;
  function change(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setKey(crypto.randomUUID());
  }
  async function save(state: "draft" | "active" | "disabled") {
    await mutation.run(async () => {
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
      const saved = await api<ResourceDto>(
        item ? `/api/admin/pastes/${item.id}` : "/api/admin/pastes",
        item ? "PATCH" : "POST",
        payload,
        key + state,
      );
      onSaved(saved);
    });
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
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {mutation.error?.status === 409 && item && (
          <Button
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  "Reload the saved version and discard your edits?",
                )
              )
                onSaved(item);
            }}
          >
            Reload saved version
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
                {["text", "code", "markdown"].map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
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
                {languages.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <FormField
              id="body"
              label="Content"
              error={mutation.error?.fields?.body}
              help={`${bytes.toLocaleString()} / ${maxBytes.toLocaleString()} bytes · UTF-8`}
            >
              {form.format === "code" ? (
                <CodeEditor
                  value={form.body}
                  language={form.language}
                  onChange={(v) => change("body", v)}
                />
              ) : (
                <Textarea
                  {...fieldProps("body", mutation.error?.fields)}
                  className="bg-card min-h-90 resize-y font-mono text-sm"
                  value={form.body}
                  onChange={(e) => change("body", e.target.value)}
                  spellCheck={true}
                />
              )}
            </FormField>
          </TabsContent>
          <TabsContent value="preview">
            <div className="editor-surface p-5">
              <MarkdownPreview body={form.body} format={form.format} />
            </div>
            <p className="muted mt-2">Private preview of your current edits.</p>
          </TabsContent>
        </Tabs>
        <div className="form-grid">
          <FormField
            id="slug"
            label="Short address"
            help={
              item
                ? "This address is permanent."
                : `${origin}/p/${form.slug.trim() || "generated-address"}`
            }
            error={mutation.error?.fields?.slug}
          >
            <Input
              {...fieldProps("slug", mutation.error?.fields)}
              value={form.slug}
              onChange={(e) => change("slug", e.target.value)}
              disabled={!!item}
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
        <div className="form-actions">
          <Button
            disabled={mutation.pending || bytes > maxBytes || !form.body}
            onClick={() =>
              void save(item?.state === "active" ? "active" : "draft")
            }
          >
            {mutation.pending
              ? "Saving…"
              : item?.state === "active"
                ? "Save changes"
                : "Save draft"}
          </Button>
          <Button
            variant="outline"
            disabled={mutation.pending || bytes > maxBytes || !form.body}
            onClick={() =>
              void save(item?.state === "active" ? "disabled" : "active")
            }
          >
            {item?.state === "active" ? "Disable" : "Publish paste"}
          </Button>
          {item && (
            <>
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
            </>
          )}
        </div>
        <p className="muted">
          Published pastes are unlisted. Anyone with the address can read them.
        </p>
      </div>
    </section>
  );
}
