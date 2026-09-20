"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { mergeSavedDraft } from "@/shared/editor-state";
import { useMutation } from "./mutation-feedback";
import { useEditorGuard } from "./navigation-guard";

export function useEditor<R extends { revision: number }, F extends object>(
  record: R,
  fields: (record: R) => F,
) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState(() => ({
    saved: record,
    form: fields(record),
  }));
  const mutation = useMutation();
  const dirty =
    JSON.stringify(state.form) !== JSON.stringify(fields(state.saved));
  const go = useEditorGuard(dirty);

  // Only clean editors adopt background refreshes. Dirty editors retain their
  // revision so a concurrent writer is still detected by the server.
  if (record.revision > state.saved.revision && !dirty && !mutation.pending)
    setState({ saved: record, form: fields(record) });

  function setForm(value: SetStateAction<F>) {
    setState((current) => ({
      ...current,
      form: typeof value === "function" ? value(current.form) : value,
    }));
  }
  async function save(action: () => Promise<R>, visibilityOnly = false) {
    const submitted = visibilityOnly ? fields(state.saved) : state.form;
    const saved = await mutation.run(action);
    if (!mounted.current) return;
    if (saved)
      setState((current) => ({
        saved,
        form: mergeSavedDraft(current.form, submitted, fields(saved)),
      }));
    return saved;
  }
  return { ...state, setForm, dirty, go, mutation, save };
}
