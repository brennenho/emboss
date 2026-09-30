"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** Server-rendered fields must not accept edits before their handlers exist. */
export function EditorReady({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const root = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (!ready || !root.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && !root.current.contains(active))
      return;
    const target = root.current.querySelector<HTMLElement>("[autofocus]");
    if (target?.getClientRects().length && target !== active) target.focus();
  }, [ready]);

  return (
    <fieldset
      ref={root}
      className="contents"
      disabled={!ready}
      inert={!ready}
      aria-busy={!ready}
    >
      {children}
    </fieldset>
  );
}
