"use client";

import { useState, useTransition } from "react";
import { Plus, X, ExternalLink, ArrowLeft } from "lucide-react";
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
import { LocalTime } from "@/components/patterns/local-time";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { ConflictRecovery } from "@/components/patterns/conflict-recovery";
import { CopyButton } from "@/components/sharing/share-dialog";
import { ResourceSummary } from "@/components/patterns/resource-summary";
import { ResourceToolbar } from "@/components/patterns/resource-toolbar";
import { useCollectionNavigation } from "@/components/patterns/use-collection-navigation";
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
  const navigation = useCollectionNavigation("links");
  function create() {
    navigation.open("new", () => {
      setCreatedId(null);
      setNewVersion((version) => version + 1);
    });
  }
  return (
    <>
      <header
        className="workspace-header"
        data-editing={!!selected || creating}
      >
        <h1>Links</h1>
        <Button className="workspace-new-action" onClick={create}>
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
            onClose={navigation.close}
            onSaved={(item) => {
              if (creating) setCreatedId(item.id);
              startTransition(() => navigation.saved(item.id));
            }}
            onDeleted={navigation.deleted}
          />
        )}
        <section className="collection-pane" aria-label="Links">
          <ResourceToolbar
            key={query}
            kind="links"
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
                    Address / destination
                  </TableHead>
                  <TableHead className="resource-updated">Updated</TableHead>
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
                          <span className="row-title font-mono">
                            /{item.slug}
                          </span>
                          {item.displayState !== "active" && (
                            <StatusBadge state={item.displayState} />
                          )}
                        </span>
                        <span className="row-sub">
                          {item.title} · {item.destinationUrl}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="resource-updated text-muted-foreground font-mono text-xs">
                      <LocalTime value={item.updatedAt} dateOnly />
                    </TableCell>
                    <TableCell className="resource-row-actions">
                      {item.displayState === "active" && (
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
                  ? "No matching links"
                  : "Create your first link"}
              </h2>
              <p>
                {query || state !== "all"
                  ? "Try another search or filter."
                  : "Create a short link for a page you share often."}
              </p>
              {!query && state === "all" && (
                <Button onClick={create}>
                  <Plus />
                  New link
                </Button>
              )}
            </div>
          )}
          {(navigation.hasPrevious || page.nextCursor) && (
            <nav className="collection-pagination" aria-label="Link pages">
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

function linkFields(item: ResourceDto) {
  return {
    title: item.title ?? "",
    destinationUrl: item.destinationUrl ?? "",
    slug: item.slug ?? "",
    expiresAt: localDate(item.expiresAt ?? null),
    previousAddress: "alias" as "alias" | "retire",
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
  const { form, setForm, mutation } = editor;
  const item = editor.saved.id ? editor.saved : null;
  const [actionKey, setActionKey] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(!!item);
  const change = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm({ ...form, [key]: value });
    setActionKey(crypto.randomUUID());
  };
  async function save(
    state = item?.state === "disabled" ? "disabled" : "active",
  ) {
    const data = {
      title: form.title,
      destinationUrl: form.destinationUrl,
      expiresAt: isoDate(form.expiresAt),
      state,
      ...(item
        ? {
            expectedRevision: item.revision,
            previousAddress: form.previousAddress,
          }
        : {}),
      ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
    };
    const saved = await editor.save(() =>
      api<ResourceDto>(
        item ? `/api/admin/links/${item.id}` : "/api/admin/links",
        item ? "PATCH" : "POST",
        data,
        actionKey,
      ),
    );
    if (saved) {
      if (!item) setCreated(true);
      onSaved(saved);
    }
  }
  async function pause() {
    if (!item) return;
    const saved = await editor.save(
      () =>
        api<ResourceDto>(`/api/admin/links/${item.id}/state`, "PATCH", {
          state: "disabled",
          expectedRevision: item.revision,
        }),
      true,
    );
    if (saved) onSaved(saved);
  }
  const optionalError =
    mutation.error?.fields?.title ||
    mutation.error?.fields?.slug ||
    mutation.error?.fields?.expiresAt;
  return (
    <aside
      className="inspector"
      aria-label={item ? "Edit link" : "New link"}
      aria-busy={refreshing}
      data-revision={item?.revision}
    >
      <Button variant="ghost" className="inspector-back" onClick={onClose}>
        <ArrowLeft />
        Back to links
      </Button>
      <div className="inspector-top">
        <h2 data-editor-heading tabIndex={-1}>
          {item ? item.title : "New link"}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close editor"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {item && (
        <ResourceSummary
          url={item.url}
          title={item.title}
          state={item.displayState}
          notice={
            created && item.displayState === "active" && !editor.dirty
              ? "Your link is ready"
              : undefined
          }
        />
      )}
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <EditorActions
          dirty={editor.dirty}
          pending={mutation.pending}
          isNew={!item}
        >
          <Button
            type="submit"
            variant={!item || editor.dirty ? "default" : "outline"}
            disabled={
              mutation.pending || refreshing || (!!item && !editor.dirty)
            }
          >
            {mutation.pending
              ? "Saving…"
              : item
                ? "Save changes"
                : "Create live link"}
          </Button>
          {item && (
            <Button
              type="button"
              variant="outline"
              disabled={mutation.pending || refreshing}
              onClick={() =>
                item.state === "active" ? void pause() : void save("active")
              }
            >
              {item.state === "active" ? "Pause sharing" : "Resume link"}
            </Button>
          )}
        </EditorActions>
        {!item && (
          <p className="muted">
            Anyone with the link can open it as soon as you create it.
          </p>
        )}
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
            onChange={(event) => change("destinationUrl", event.target.value)}
          />
        </FormField>
        <details
          className="sharing-options"
          open={optionsOpen || !!optionalError}
          onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
        >
          <summary>
            {item ? "Link settings" : "Label, address and expiry"}
          </summary>
          <div className="form-stack pt-4">
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
                onChange={(event) => change("title", event.target.value)}
              />
            </FormField>
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
                required={!!item}
                maxLength={48}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Automatic"
                onChange={(event) => change("slug", event.target.value)}
              />
            </FormField>
            {item && form.slug.trim() !== item.slug && (
              <div className="form-stack gap-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary mt-1"
                    checked={form.previousAddress === "alias"}
                    onChange={(event) =>
                      change(
                        "previousAddress",
                        event.target.checked ? "alias" : "retire",
                      )
                    }
                  />
                  Keep /{item.slug} working
                </label>
                <p className="muted">
                  {form.previousAddress === "alias"
                    ? "Existing links and QR codes will reach the same destination."
                    : "The previous address will stop working and stay reserved."}
                </p>
              </div>
            )}
            {!!item?.aliases?.length && (
              <p className="muted">
                Also available at{" "}
                {item.aliases.map((alias) => `/${alias}`).join(", ")}
              </p>
            )}
            <ExpiryField
              showOptionalHint={false}
              value={form.expiresAt}
              onChange={(value) => change("expiresAt", value)}
              error={mutation.error?.fields?.expiresAt}
            />
          </div>
        </details>
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {item && (
          <ConflictRecovery
            error={mutation.error}
            draft={form}
            loadLatest={() => api<ResourceDto>(`/api/admin/links/${item.id}`)}
            onUseLatest={editor.reset}
          />
        )}
      </form>
      {item && (
        <div className="form-actions mt-6 border-t pt-5">
          <Button variant="ghost" asChild>
            <a href={item.destinationUrl} target="_blank" rel="noreferrer">
              Open destination
              <ExternalLink />
            </a>
          </Button>
          <DeleteButton
            title={item.title}
            pending={mutation.pending}
            onDelete={() =>
              void mutation.run(async () => {
                await api(`/api/admin/links/${item.id}`, "DELETE", {
                  expectedRevision: item.revision,
                });
                onDeleted();
              })
            }
          />
        </div>
      )}
    </aside>
  );
}
