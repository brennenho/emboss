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
  const [dirty, setDirtyState] = useState(false),
    [next, setNext] = useState<(() => void) | null>(null);
  const editors = useRef(new Set<string>());
  const setDirty = useCallback((id: string, value: boolean) => {
    if (value) editors.current.add(id);
    else editors.current.delete(id);
    setDirtyState(editors.current.size > 0);
  }, []);
  const router = useRouter();
  const location = useRef("");
  const go = useCallback((action: () => void) => {
    if (editors.current.size) setNext(() => action);
    else action();
  }, []);
  useEffect(() => {
    location.current = window.location.href;
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const a = (event.target as Element).closest("a");
      if (
        !a ||
        !a.href ||
        a.target === "_blank" ||
        a.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const url = new URL(a.href);
      if (url.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setNext(() => () => {
        if (url.origin === window.location.origin)
          router.push(url.pathname + url.search);
        else window.location.assign(url.href);
      });
    };
    const pop = () => {
      const target = window.location.href;
      window.history.pushState(null, "", location.current);
      setNext(
        () => () =>
          router.push(new URL(target).pathname + new URL(target).search),
      );
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, router]);
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
              Your changes have not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                editors.current.clear();
                setDirtyState(false);
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
