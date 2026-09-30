"use client";
import { useEffect, useRef } from "react";
import { EditorState, Compartment, Annotation } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { languageExtension } from "./language-extension";

const externalValue = Annotation.define<boolean>();

export default function CodeEditor({
  value,
  language,
  onChange,
  error,
  autoFocus = false,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callback = useRef(onChange),
    initial = useRef({ value, autoFocus }),
    compartment = useRef(new Compartment()),
    accessibility = useRef(new Compartment());
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          compartment.current.of([]),
          accessibility.current.of([]),
          EditorView.theme({
            "&": { height: "clamp(340px,44dvh,480px)", fontSize: "13px" },
            ".cm-scroller": { overflow: "auto" },
            ".cm-content": {
              fontFamily: "var(--font-plex-mono)",
              minHeight: "100%",
            },
            ".cm-gutters": {
              background: "var(--background)",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            "&.cm-focused": {
              outline: "2px solid var(--primary)",
              outlineOffset: "2px",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              update.transactions.some(
                (transaction) =>
                  transaction.docChanged &&
                  !transaction.annotation(externalValue),
              )
            )
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    if (initial.current.autoFocus) editor.focus();
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({
      effects: accessibility.current.reconfigure(
        EditorView.contentAttributes.of({
          id: "body",
          "aria-label": "Content",
          "aria-invalid": String(!!error),
          "aria-describedby": error ? "body-help body-error" : "body-help",
        }),
      ),
    });
  }, [error]);
  useEffect(() => {
    let active = true;
    void languageExtension(language).then((extension) => {
      if (active)
        view.current?.dispatch({
          effects: compartment.current.reconfigure(extension),
        });
    });
    return () => {
      active = false;
    };
  }, [language]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: externalValue.of(true),
      });
  }, [value]);
  return <div ref={host} className="editor-surface" />;
}
