"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LocalTime } from "@/components/patterns/local-time";
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import { useCollectionNavigation } from "@/components/patterns/use-collection-navigation";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { api } from "@/shared/client-api";
import { formatBytes } from "@/shared/format";
import type { TrashResourceDto } from "@/shared/resources";

const collection = { link: "links", paste: "pastes", file: "files" } as const;
const kindLabel = { link: "Link", paste: "Paste", file: "File" } as const;

export function TrashWorkspace({
  page,
  query,
  readOnly,
}: {
  page: { items: TrashResourceDto[]; nextCursor: string | null };
  query: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const navigation = useCollectionNavigation("trash");
  const mutation = useMutation();
  const [search, setSearch] = useState(query);
  const [refreshing, startTransition] = useTransition();
  const [restored, setRestored] = useState<{
    href: string;
    title: string;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const busy = mutation.pending || refreshing;
  function refresh() {
    startTransition(() => router.refresh());
    heading.current?.focus();
  }
  async function restore(item: TrashResourceDto) {
    await mutation.run(async () => {
      await api(
        `/api/admin/${collection[item.kind]}/${item.id}/restore`,
        "POST",
        { expectedRevision: item.revision },
      );
      setRestored({
        href: `/admin/${collection[item.kind]}?item=${encodeURIComponent(item.id)}`,
        title: item.title || item.filename || item.slug,
      });
      mutation.setNotice(
        "Restored and paused. Review the item before publishing it again.",
      );
      refresh();
    });
  }
  async function permanentlyDelete(item: TrashResourceDto) {
    await mutation.run(async () => {
      await api(
        `/api/admin/${collection[item.kind]}/${item.id}/permanent`,
        "DELETE",
        { expectedRevision: item.revision },
      );
      setRestored(null);
      mutation.setNotice(
        item.kind === "file"
          ? "Permanently deleted. File storage will be released by automatic cleanup."
          : "Permanently deleted. Its old address remains reserved.",
      );
      refresh();
    });
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Trash
          </h1>
          <p className="muted">
            Restore an item before its recovery deadline. Restored items stay
            paused until you publish them.
          </p>
        </div>
      </header>
      <div className="form-stack">
        {readOnly && (
          <p
            role="status"
            className="border-primary bg-accent rounded-md border p-3"
          >
            Changes paused for maintenance. You can still review Trash.
          </p>
        )}
        <MutationFeedback
          {...mutation}
          onReauthenticated={() => mutation.setError(null)}
        />
        {mutation.error?.status === 409 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              mutation.setError(null);
              refresh();
            }}
          >
            Refresh Trash
          </Button>
        )}
        {restored && (
          <Link
            href={restored.href}
            className="w-fit underline underline-offset-4"
          >
            Review {restored.title}
          </Link>
        )}
        <section
          className="collection-pane"
          aria-label="Deleted items"
          aria-busy={busy}
        >
          <form
            className="resource-toolbar"
            data-search-only
            role="search"
            aria-label="Trash search"
            onSubmit={(event) => {
              event.preventDefault();
              navigation.search(search);
            }}
          >
            <div className="search-input">
              <Search aria-hidden="true" size={15} />
              <Input
                className="pl-8"
                aria-label="Search Trash"
                placeholder="Search Trash"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={200}
              />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
          {page.items.length ? (
            <ul className="divide-y">
              {page.items.map((item) => {
                const title = item.title || item.filename || item.slug;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 max-sm:px-4"
                  >
                    <div className="min-w-0 flex-1 basis-72">
                      <h2 className="text-base break-words">{title}</h2>
                      <p className="muted mt-1 break-all">
                        {kindLabel[item.kind]} ·{" "}
                        <span className="font-mono">
                          /
                          {item.kind === "link"
                            ? ""
                            : item.kind === "file"
                              ? "f/"
                              : "p/"}
                          {item.slug}
                        </span>
                        {item.bytes != null
                          ? ` · ${formatBytes(item.bytes)}`
                          : ""}
                      </p>
                      <p className="muted mt-2">
                        Moved to Trash <LocalTime value={item.deletedAt} />
                      </p>
                      <p className="text-sm">
                        Recovery ends <LocalTime value={item.purgeAfter} />
                      </p>
                      {!item.canRestore && (
                        <p className="text-muted-foreground mt-2 text-sm">
                          {item.restoreUnavailableReason ||
                            "This item can no longer be restored."}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={readOnly || busy || !item.canRestore}
                        aria-label={`Restore ${title}`}
                        onClick={() => void restore(item)}
                      >
                        <RotateCcw aria-hidden="true" />
                        Restore
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive"
                            disabled={readOnly || busy}
                            aria-label={`Delete ${title} permanently`}
                          >
                            <Trash2 aria-hidden="true" />
                            Delete permanently
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {title} permanently?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes its content and ends recovery now.
                              Its old address stays reserved.
                              {item.kind === "file"
                                ? " File storage is released when automatic cleanup finishes."
                                : ""}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep in Trash</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => void permanentlyDelete(item)}
                            >
                              Delete permanently
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty-state">
              <Trash2
                aria-hidden="true"
                className="text-muted-foreground size-7"
              />
              <h2>{query ? "No matching items" : "Trash is empty"}</h2>
              <p>
                {query
                  ? "Try another title or address."
                  : "Deleted items appear here while they can still be recovered."}
              </p>
            </div>
          )}
          {(navigation.hasPrevious || page.nextCursor) && (
            <nav
              className="flex flex-wrap items-center justify-between gap-3 border-t p-4"
              aria-label="Trash pages"
            >
              <Button
                type="button"
                variant="outline"
                disabled={!navigation.hasPrevious || busy}
                onClick={() => navigation.previous()}
              >
                Previous page
              </Button>
              <p className="muted">
                {page.items.length} {page.items.length === 1 ? "item" : "items"}{" "}
                on this page
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={!page.nextCursor || busy}
                onClick={() => {
                  if (page.nextCursor) navigation.next(page.nextCursor);
                }}
              >
                Next page
              </Button>
            </nav>
          )}
        </section>
        <p className="muted">
          Files in Trash still use storage until cleanup. Expired items remain
          in their library and are never removed just because they expire.
        </p>
      </div>
    </>
  );
}
