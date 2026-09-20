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
const GuardContext = createContext<{
  setDirty: (id: string, dirty: boolean) => void;
  go: (action: () => void) => void;
}>({ setDirty: () => {}, go: (action) => action() });
export function NavigationGuard({ children }: { children: React.ReactNode }) {
  const [next, setNext] = useState<(() => void) | null>(null);
  const editors = useRef(new Set<string>());
  const setDirty = useCallback((id: string, value: boolean) => {
    if (value) editors.current.add(id);
    else editors.current.delete(id);
  }, []);
  const router = useRouter();
  const go = useCallback((action: () => void) => {
    if (editors.current.size) setNext(() => action);
    else action();
  }, []);
  useEffect(() => {
    const marker = "__embossHistoryIndex";
    let index = Number(window.history.state?.[marker] ?? 0);
    let currentUrl = window.location.href;
    let restoring: { index: number; delta: number } | null = null;
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
      if (!editors.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (!editors.current.size || event.defaultPrevented || event.button !== 0)
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
      event.preventDefault();
      event.stopPropagation();
      setNext(() => () => {
        if (url.origin === window.location.origin)
          router.push(url.pathname + url.search + url.hash);
        else window.location.assign(url.href);
      });
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
        const { delta } = restoring;
        restoring = null;
        setNext(() => () => window.history.go(delta));
        return;
      }
      const target = new URL(window.location.href);
      const previous = new URL(currentUrl);
      const samePage =
        target.pathname === previous.pathname &&
        target.search === previous.search;
      if (
        editors.current.size &&
        !samePage &&
        targetIndex !== undefined &&
        targetIndex !== index
      ) {
        // Stop Next's bubble listener before it can unmount the editor. Return
        // to the existing entry; do not insert duplicate history entries.
        event.stopImmediatePropagation();
        restoring = { index, delta: targetIndex - index };
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
  }, [router]);

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
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                editors.current.clear();
                next?.();
                setNext(null);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GuardContext.Provider>
  );
}
export function useEditorGuard(dirty: boolean) {
  const { setDirty, go } = useContext(GuardContext);
  const id = useId();
  useEffect(() => {
    setDirty(id, dirty);
    return () => setDirty(id, false);
  }, [dirty, setDirty, id]);
  return go;
}
export function useNavigationGuard() {
  return useContext(GuardContext).go;
}
