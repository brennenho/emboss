"use client";
import { LocalTime } from "@/components/patterns/local-time";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [refreshing, startTransition] = useTransition();
  const router = useRouter(),
    go = useNavigationGuard();
  const [search, setSearch] = useState(query);
  function navigate(item?: string, extra?: Record<string, string>) {
    const params = new URLSearchParams({ q: query, state, ...extra });
    if (item) params.set("item", item);
    go(() => router.push(`/admin/links?${params}`));
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Links</h1>
          <p>Stable addresses for the destinations you share.</p>
        </div>
        <Button onClick={() => navigate("new")}>
          <Plus />
          New link
        </Button>
      </header>
      <div
        className={`work-split ${selected || creating ? "has-inspector" : ""}`}
      >
        <section className="min-w-0">
          <form
            className="toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(undefined, { q: search });
            }}
          >
            <Search size={16} aria-hidden="true" className="hidden sm:block" />
            <Input
              aria-label="Search links"
              placeholder="Search title, address, or destination"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={200}
            />
            <Button variant="outline" type="submit">
              Search
            </Button>
            <Select
              value={state}
              onValueChange={(value) => navigate(undefined, { state: value })}
            >
              <SelectTrigger aria-label="Filter links" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["all", "active", "draft", "disabled", "expired"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all"
                      ? "All states"
                      : s[0]!.toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </form>
          {page.items.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Address / destination</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden xl:table-cell">
                    Updated
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
                    <TableCell className="pl-6">
                      <button
                        type="button"
                        className="w-full py-1 text-left"
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
                    <TableCell className="text-muted-foreground hidden text-xs xl:table-cell">
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
                  : "Choose a short address. Change its destination whenever you need to."}
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
        {(selected || creating) && (
          <LinkEditor
            key={selected ? `${selected.id}-${selected.revision}` : "new"}
            item={selected}
            refreshing={refreshing}
            origin={origin}
            onClose={() => navigate()}
            onSaved={(item) => {
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
      </div>
    </>
  );
}
function LinkEditor({
  item,
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
  const initial = {
    title: item?.title ?? "",
    destinationUrl: item?.destinationUrl ?? "",
    slug: item?.slug ?? "",
    expiresAt: localDate(item?.expiresAt ?? null),
  };
  const [form, setForm] = useState(initial),
    [actionKey, setActionKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation();
  const go = useEditorGuard(JSON.stringify(form) !== JSON.stringify(initial));
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
    const saved = await mutation.run(() =>
      api<ResourceDto>(
        item ? `/api/admin/links/${item.id}` : "/api/admin/links",
        item ? "PATCH" : "POST",
        data,
        actionKey,
      ),
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
        <FormField
          id="title"
          label="Title"
          help="Optional; defaults to the destination host."
          error={mutation.error?.fields?.title}
        >
          <Input
            {...fieldProps("title", mutation.error?.fields)}
            value={form.title}
            maxLength={160}
            onChange={(e) => change("title", e.target.value)}
          />
        </FormField>
        {!item && (
          <FormField
            id="slug"
            label="Short address"
            error={mutation.error?.fields?.slug}
            help={`${origin}/${form.slug.trim() || "generated-address"}`}
          >
            <Input
              {...fieldProps("slug", mutation.error?.fields)}
              value={form.slug}
              maxLength={48}
              placeholder="Generate automatically"
              onChange={(e) => change("slug", e.target.value)}
            />
          </FormField>
        )}
        <ExpiryField
          value={form.expiresAt}
          onChange={(value) => change("expiresAt", value)}
          error={mutation.error?.fields?.expiresAt}
        />
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
            Reload saved version
          </Button>
        )}
        <div className="form-actions">
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
                void save(item.state === "active" ? "disabled" : "active")
              }
            >
              {item.state === "active" ? "Disable" : "Enable"}
            </Button>
          )}
        </div>
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
              Destination
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
