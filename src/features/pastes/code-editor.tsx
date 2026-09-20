"use client";
import { useEffect, useRef } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
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
  StreamLanguage,
} from "@codemirror/language";
async function languageExtension(language: string): Promise<Extension> {
  switch (language) {
    case "javascript":
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({
        typescript: language === "typescript",
      });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "shell":
      return StreamLanguage.define(
        (await import("@codemirror/legacy-modes/mode/shell")).shell,
      );
    case "yaml":
      return StreamLanguage.define(
        (await import("@codemirror/legacy-modes/mode/yaml")).yaml,
      );
    default:
      return [];
  }
}
export default function CodeEditor({
  value,
  language,
  onChange,
  error,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    callback = useRef(onChange),
    initial = useRef(value),
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
        doc: initial.current,
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
            if (update.docChanged)
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
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
      });
  }, [value]);
  return <div ref={host} className="editor-surface" />;
}
