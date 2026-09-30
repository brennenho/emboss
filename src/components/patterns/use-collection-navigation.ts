"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavigationGuard } from "./navigation-guard";

type Collection = "links" | "pastes" | "files" | "trash";
type ReturnPosition = {
  id: string | null;
  scrollY: number;
  libraryScroll: number;
  query: string;
};

function collectionQuery(params: URLSearchParams) {
  const query = new URLSearchParams(params);
  query.delete("item");
  return query.toString();
}

function visibleElement(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.getClientRects().length > 0,
  );
}

/** Keep the collection's location intact while its detail view changes. */
export function useCollectionNavigation(kind: Collection) {
  const router = useRouter();
  const params = useSearchParams();
  const go = useNavigationGuard();
  const item = params.get("item");
  const query = collectionQuery(new URLSearchParams(params));
  const previousItem = useRef<string | null>(null);
  const returnPosition = useRef<ReturnPosition | null>(null);

  useEffect(() => {
    const previous = previousItem.current;
    previousItem.current = item;
    if (item === previous) return;

    const frame = requestAnimationFrame(() => {
      if (item && item !== "new" && previous !== "new") {
        const heading = visibleElement("[data-editor-heading]");
        const pane = heading?.closest(".inspector, .paste-editor");
        // Interaction may have started before this deferred focus runs.
        if (document.activeElement && pane?.contains(document.activeElement))
          return;
        heading?.focus({ preventScroll: true });
        if (window.matchMedia("(max-width: 900px)").matches)
          window.scrollTo({ top: 0, behavior: "instant" });
      } else if (!item && previous) {
        const position = returnPosition.current;
        if (position && position.query !== query) return;
        const row = position?.id
          ? visibleElement(`[data-resource-id="${CSS.escape(position.id)}"]`)
          : position
            ? visibleElement(".workspace-header button")
            : undefined;
        const fallback =
          visibleElement(
            '.collection-pane [role="search"] input, .paste-library [role="search"] input',
          ) ?? visibleElement(".workspace-header button");
        (row ?? fallback)?.focus({ preventScroll: true });
        if (position) {
          const library = visibleElement(".paste-library");
          if (library) library.scrollTop = position.libraryScroll;
          window.scrollTo({ top: position.scrollY, behavior: "instant" });
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [item, query]);

  function target(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    update(next);
    const search = next.toString();
    return `/admin/${kind}${search ? `?${search}` : ""}`;
  }

  function changeCollection(update: (next: URLSearchParams) => void) {
    const destination = target((next) => {
      next.delete("item");
      update(next);
    });
    go(() => {
      returnPosition.current = null;
      router.push(destination);
    }, destination);
  }

  function setFilter(name: string, value: string) {
    changeCollection((next) => {
      if (value && (name !== "state" || value !== "all")) next.set(name, value);
      else next.delete(name);
      next.delete("cursor");
      next.delete("previous");
    });
  }

  return {
    open(id: string, onNavigate?: () => void) {
      const destination = target((next) => next.set("item", id));
      go(
        () => {
          returnPosition.current = {
            id: id === "new" ? null : id,
            scrollY: window.scrollY,
            libraryScroll: visibleElement(".paste-library")?.scrollTop ?? 0,
            query,
          };
          onNavigate?.();
          router.push(destination, { scroll: false });
        },
        destination,
        { resetEditor: id === item && !!onNavigate },
      );
    },
    close() {
      const destination = target((next) => next.delete("item"));
      go(() => router.push(destination, { scroll: false }), destination);
    },
    saved(id: string) {
      router.replace(
        target((next) => next.set("item", id)),
        { scroll: false },
      );
      router.refresh();
    },
    deleted() {
      router.replace(
        target((next) => next.delete("item")),
        { scroll: false },
      );
      router.refresh();
    },
    search(value: string) {
      setFilter("q", value);
    },
    filter(value: string) {
      setFilter("state", value);
    },
    next(cursor: string) {
      changeCollection((next) => {
        next.append("previous", next.get("cursor") ?? "");
        next.set("cursor", cursor);
      });
    },
    previous() {
      changeCollection((next) => {
        const history = next.getAll("previous");
        const cursor = history.pop();
        next.delete("previous");
        for (const previous of history) next.append("previous", previous);
        if (cursor) next.set("cursor", cursor);
        else next.delete("cursor");
      });
    },
    hasPrevious: params.has("cursor"),
    rowProps(id: string) {
      return { id: `resource-${id}`, "data-resource-id": id };
    },
  };
}
