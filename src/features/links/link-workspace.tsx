"use client";
import { LocalTime } from "@/components/patterns/local-time";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import {
  DeleteButton,
  ExpiryField,
  isoDate,
  localDate,
  StatusBadge,
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
  type ResourceDto,
  type ResourcePage,
} from "@/shared/resources";

export function LinkWorkspace({
  page,
  selected,
  creating,
  origin,
  query,
  state,
}: {
  page: ResourcePage;
  selected: ResourceDto | null;
  creating: boolean;
  origin: string;
  query: string;
  state: string;
}) {
  const [newVersion, setNewVersion] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const router = useRouter(),
    go = useNavigationGuard();
  function navigate(item?: string, extra?: Record<string, string>) {
    const params = new URLSearchParams({ q: query, state, ...extra });
    if (item) params.set("item", item);
    go(() => {
      if (item === "new") {
        setCreatedId(null);
        setNewVersion((v) => v + 1);
      }
      router.push(`/admin/links?${params}`);
    });
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Links</h1>
        </div>
        <Button onClick={() => navigate("new")}>
          <Plus />
          New link
        </Button>
      </header>
      <div
        className={`work-split ${selected || creating ? "has-inspector" : ""}`}
      >
        {(selected || creating) && (
          <LinkEditor
            key={
              selected && selected.id !== createdId
                ? selected.id
                : `new-${newVersion}`
            }
            item={selected}
            refreshing={refreshing}
            origin={origin}
            onClose={() => navigate()}
            onSaved={(item) => {
              if (creating) setCreatedId(item.id);
              startTransition(() => {
                router.replace(`/admin/links?item=${item.id}`);
                router.refresh();
              });
            }}
            onDeleted={() => {
              router.replace("/admin/links");
              router.refresh();
            }}
          />
        )}
        <section className="collection-pane">
          <ResourceToolbar
            key={query}
            kind="links"
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
                    Address / destination
                  </TableHead>
                  <TableHead className="resource-state">State</TableHead>
                  <TableHead className="resource-updated">Updated</TableHead>
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
                        onClick={() => navigate(item.id)}
                      >
                        <span className="row-title font-mono">
                          /{item.slug}
                        </span>
                        <span className="row-sub">
                          {item.title} · {item.destinationUrl}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <StatusBadge state={item.displayState} />
                    </TableCell>
                    <TableCell className="resource-updated text-muted-foreground font-mono text-xs">
                      <LocalTime value={item.updatedAt} dateOnly />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="empty-state">
              <h2>
                {query || state !== "all"
                  ? "No matching links"
                  : "Create your first link"}
              </h2>
              <p>
                {query || state !== "all"
                  ? "Try another search or filter."
                  : "Add a destination URL to get started."}
              </p>
              {!query && state === "all" && (
                <Button onClick={() => navigate("new")}>
                  <Plus />
                  New link
                </Button>
              )}
            </div>
          )}
          {page.nextCursor && (
            <div className="p-4">
              <Button
                variant="outline"
                onClick={() =>
                  navigate(undefined, { cursor: page.nextCursor! })
                }
              >
                Next page
              </Button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function linkFields(item: ResourceDto) {
  return {
    title: item.title ?? "",
    destinationUrl: item.destinationUrl ?? "",
    slug: item.slug ?? "",
    expiresAt: localDate(item.expiresAt ?? null),
  };
}
function LinkEditor({
  item: incoming,
  refreshing,
  origin,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: ResourceDto | null;
  refreshing: boolean;
  origin: string;
  onClose: () => void;
  onSaved: (item: ResourceDto) => void;
  onDeleted: () => void;
}) {
  const editor = useEditor(incoming ?? emptyResource("link"), linkFields);
  const { form, setForm, mutation, go } = editor;
  const item = editor.saved.id ? editor.saved : null;
  const [actionKey, setActionKey] = useState(() => crypto.randomUUID());
  const change = (key: keyof typeof form, value: string) => {
    setForm({ ...form, [key]: value });
    setActionKey(crypto.randomUUID());
  };
  async function save(state = "active") {
    const data = {
      title: form.title,
      destinationUrl: form.destinationUrl,
      expiresAt: isoDate(form.expiresAt),
      state,
      ...(item
        ? { expectedRevision: item.revision }
        : form.slug.trim()
          ? { slug: form.slug.trim() }
          : {}),
    };
    const saved = await editor.save(() =>
      api<ResourceDto>(
        item ? `/api/admin/links/${item.id}` : "/api/admin/links",
        item ? "PATCH" : "POST",
        data,
        actionKey,
      ),
    );
    if (saved) onSaved(saved);
  }
  async function changeState(state: "active" | "disabled") {
    if (!item) return;
    const saved = await editor.save(
      () =>
        api<ResourceDto>(`/api/admin/links/${item.id}/state`, "PATCH", {
          state,
          expectedRevision: item.revision,
        }),
      true,
    );
    if (saved) onSaved(saved);
  }
  return (
    <aside
      className="inspector"
      aria-label={item ? "Edit link" : "New link"}
      aria-busy={refreshing}
      data-revision={item?.revision}
    >
      <div className="inspector-top">
        <h2>{item ? "Edit link" : "New link"}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close editor"
          onClick={() => go(onClose)}
        >
          <X />
        </Button>
      </div>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save(item?.state ?? "active");
        }}
      >
        <EditorActions
          dirty={editor.dirty}
          pending={mutation.pending}
          isNew={!editor.saved.id}
        >
          <Button type="submit" disabled={mutation.pending || refreshing}>
            {mutation.pending
              ? "Saving…"
              : item
                ? "Save changes"
                : "Create link"}
          </Button>
          {item && (
            <Button
              type="button"
              variant="outline"
              disabled={mutation.pending || refreshing}
              onClick={() =>
                void changeState(
                  item.state === "active" ? "disabled" : "active",
                )
              }
            >
              {item.state === "active" ? "Disable" : "Enable"}
            </Button>
          )}
        </EditorActions>
        {item && <AddressPlate url={item.url} />}
        <FormField
          id="destinationUrl"
          label="Destination URL"
          error={mutation.error?.fields?.destinationUrl}
        >
          <Input
            {...fieldProps("destinationUrl", mutation.error?.fields)}
            type="url"
            autoFocus={!item}
            maxLength={2048}
            required
            value={form.destinationUrl}
            placeholder="https://example.com/page"
            onChange={(e) => change("destinationUrl", e.target.value)}
          />
        </FormField>
        <fieldset className="min-w-0 border-t pt-4">
          <legend className="text-muted-foreground pr-3 font-mono text-[11px] tracking-wider uppercase">
            Optional
          </legend>
          <div className="form-stack">
            <FormField
              id="title"
              label="Label"
              help="Defaults to the destination domain."
              error={mutation.error?.fields?.title}
            >
              <Input
                {...fieldProps("title", mutation.error?.fields, true)}
                value={form.title}
                maxLength={160}
                onChange={(e) => change("title", e.target.value)}
              />
            </FormField>
            {!item && (
              <FormField
                id="slug"
                label="Custom address"
                error={mutation.error?.fields?.slug}
                help={
                  form.slug.trim()
                    ? `${origin}/${form.slug.trim()}`
                    : `Leave blank to generate ${generatedSlugLength} characters.`
                }
              >
                <Input
                  {...fieldProps("slug", mutation.error?.fields, true)}
                  value={form.slug}
                  maxLength={48}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Automatic"
                  onChange={(e) => change("slug", e.target.value)}
                />
              </FormField>
            )}
            <ExpiryField
              showOptionalHint={false}
              value={form.expiresAt}
              onChange={(value) => change("expiresAt", value)}
              error={mutation.error?.fields?.expiresAt}
            />
          </div>
        </fieldset>
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {mutation.error?.code === "CONFLICT" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => go(() => window.location.reload())}
          >
            Reload
          </Button>
        )}
      </form>
      {item && (
        <div className="form-actions mt-6 border-t pt-5">
          <ShareDialog
            url={item.url}
            state={item.displayState}
            disabled={mutation.pending || refreshing}
          />
          <Button variant="ghost" asChild>
            <a href={item.destinationUrl} target="_blank" rel="noreferrer">
              Open destination
              <ExternalLink />
            </a>
          </Button>
          <DeleteButton
            title={item.title}
            pending={mutation.pending}
            onDelete={() => {
              void mutation.run(async () => {
                await api(`/api/admin/links/${item.id}`, "DELETE", {
                  expectedRevision: item.revision,
                });
                onDeleted();
              });
            }}
          />
        </div>
      )}
    </aside>
  );
}
