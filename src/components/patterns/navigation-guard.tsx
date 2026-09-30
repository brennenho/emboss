"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useId,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
type GuardScope = "location" | "pathname";
type NavigationOptions = { resetEditor?: boolean };
type PendingNavigation = {
  action: () => void;
  guards: string[];
  hasUploads: boolean;
  hasEdits: boolean;
};
const GuardContext = createContext<{
  setDirty: (id: string, dirty: boolean, scope: GuardScope) => void;
  go: (
    action: () => void,
    destination?: string,
    options?: NavigationOptions,
  ) => void;
}>({ setDirty: () => {}, go: (action) => action() });
export function NavigationGuard({ children }: { children: React.ReactNode }) {
  const [next, setNext] = useState<PendingNavigation | null>(null);
  const guards = useRef(new Map<string, GuardScope>());
  const setDirty = useCallback(
    (id: string, value: boolean, scope: GuardScope) => {
      if (value) guards.current.set(id, scope);
      else guards.current.delete(id);
    },
    [],
  );
  const router = useRouter();
  const pendingNavigation = useCallback(
    (
      action: () => void,
      destination?: string,
      currentHref = window.location.href,
      options: NavigationOptions = {},
    ): PendingNavigation => {
      const current = new URL(currentHref);
      const target = destination ? new URL(destination, current) : null;
      const samePath =
        target?.origin === current.origin &&
        target.pathname === current.pathname;
      const sameLocation = samePath && target?.search === current.search;
      const blocking = [...guards.current].filter(([, scope]) =>
        scope === "pathname"
          ? !samePath
          : !sameLocation || !!options.resetEditor,
      );
      return {
        action,
        guards: blocking.map(([id]) => id),
        hasUploads: blocking.some(([, scope]) => scope === "pathname"),
        hasEdits: blocking.some(([, scope]) => scope === "location"),
      };
    },
    [],
  );
  const go = useCallback(
    (action: () => void, destination?: string, options?: NavigationOptions) => {
      const navigation = pendingNavigation(
        action,
        destination,
        undefined,
        options,
      );
      if (navigation.guards.length) setNext(navigation);
      else action();
    },
    [pendingNavigation],
  );
  useEffect(() => {
    const marker = "__embossHistoryIndex";
    let index = Number(window.history.state?.[marker] ?? 0);
    let currentUrl = window.location.href;
    let restoring: { index: number; navigation: PendingNavigation } | null =
      null;
    let disposed = false;
    let restoreHistory = () => {};

    // Install after the router's effect, preserving its push/replace wrappers.
    queueMicrotask(() => {
      if (disposed) return;
      const push = window.history.pushState;
      const replace = window.history.replaceState;
      replace.call(
        window.history,
        { ...window.history.state, [marker]: index },
        "",
      );
      const trackedPush: History["pushState"] = (data, unused, url) => {
        push.call(
          window.history,
          { ...data, [marker]: index + 1 },
          unused,
          url,
        );
        index += 1;
        currentUrl = window.location.href;
      };
      const trackedReplace: History["replaceState"] = (data, unused, url) => {
        replace.call(window.history, { ...data, [marker]: index }, unused, url);
        currentUrl = window.location.href;
      };
      window.history.pushState = trackedPush;
      window.history.replaceState = trackedReplace;
      restoreHistory = () => {
        if (window.history.pushState === trackedPush)
          window.history.pushState = push;
        if (window.history.replaceState === trackedReplace)
          window.history.replaceState = replace;
      };
    });
    const unload = (event: BeforeUnloadEvent) => {
      if (!guards.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (!guards.current.size || event.defaultPrevented || event.button !== 0)
        return;
      const a =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        !a?.href ||
        (a.target && a.target !== "_self") ||
        a.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const url = new URL(a.href);
      if (
        url.href === window.location.href ||
        (url.origin === window.location.origin &&
          url.pathname === window.location.pathname &&
          url.search === window.location.search)
      )
        return;
      const navigation = pendingNavigation(() => {
        if (url.origin === window.location.origin)
          router.push(url.pathname + url.search + url.hash);
        else window.location.assign(url.href);
      }, url.href);
      if (!navigation.guards.length) return;
      event.preventDefault();
      event.stopPropagation();
      setNext(navigation);
    };
    const pop = (event: PopStateEvent) => {
      const targetIndex = event.state?.[marker] as number | undefined;
      if (restoring) {
        event.stopImmediatePropagation();
        if (targetIndex !== restoring.index) {
          if (targetIndex !== undefined)
            window.history.go(restoring.index - targetIndex);
          return;
        }
        const { navigation } = restoring;
        restoring = null;
        setNext(navigation);
        return;
      }
      const target = new URL(window.location.href);
      const delta = targetIndex === undefined ? 0 : targetIndex - index;
      const navigation = pendingNavigation(
        () => window.history.go(delta),
        target.href,
        currentUrl,
      );
      if (
        navigation.guards.length &&
        targetIndex !== undefined &&
        targetIndex !== index
      ) {
        // Stop Next's bubble listener before it can unmount the editor. Return
        // to the existing entry; do not insert duplicate history entries.
        event.stopImmediatePropagation();
        restoring = { index, navigation };
        window.history.go(index - targetIndex);
        return;
      }
      index = targetIndex ?? index;
      currentUrl = window.location.href;
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop, true);
    document.addEventListener("click", click, true);
    return () => {
      disposed = true;
      restoreHistory();
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop, true);
      document.removeEventListener("click", click, true);
    };
  }, [router, pendingNavigation]);

  return (
    <GuardContext.Provider value={{ setDirty, go }}>
      {children}
      <AlertDialog
        open={!!next}
        onOpenChange={(open) => {
          if (!open) setNext(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {next?.hasUploads
                ? next.hasEdits
                  ? "Discard edits and leave?"
                  : "Leave while uploading?"
                : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {next?.hasEdits && "Your edits will be lost."}
              {next?.hasEdits && next.hasUploads && " "}
              {next?.hasUploads && "Uploads may stop if you leave this page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {next?.hasEdits ? "Keep editing" : "Stay here"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                for (const id of next?.guards ?? []) guards.current.delete(id);
                next?.action();
                setNext(null);
              }}
            >
              {next?.hasUploads ? "Leave page" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GuardContext.Provider>
  );
}
export function useEditorGuard(dirty: boolean, scope: GuardScope = "location") {
  const { setDirty, go } = useContext(GuardContext);
  const id = useId();
  useEffect(() => {
    setDirty(id, dirty, scope);
    return () => setDirty(id, false, scope);
  }, [dirty, setDirty, id, scope]);
  return go;
}
export function useNavigationGuard() {
  return useContext(GuardContext).go;
}
