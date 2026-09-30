"use client";
import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { Button } from "@/components/ui/button";
import { pasteLanguageLabels } from "@/shared/resources";
import { languageExtension } from "./language-extension";

export default function CodePreview({
  body,
  language,
}: {
  body: string;
  language: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const fallback = useRef<HTMLPreElement>(null);
  const view = useRef<EditorView | null>(null);
  const presentation = useRef(new Compartment());
  const syntax = useRef(new Compartment());
  const [wrap, setWrap] = useState(true);
  const [numbered, setNumbered] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: body,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": "Code content",
            tabindex: "0",
          }),
          syntaxHighlighting(defaultHighlightStyle),
          presentation.current.of([]),
          syntax.current.of([]),
          EditorView.theme({
            "&": { fontSize: "14px", backgroundColor: "transparent" },
            ".cm-content": {
              fontFamily: "var(--font-plex-mono)",
              padding: "16px 0",
              lineHeight: "1.8",
            },
            ".cm-line": { padding: "0 20px" },
            ".cm-scroller": { overflow: "auto", maxHeight: "75vh" },
            ".cm-gutters": {
              background: "transparent",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            "&.cm-focused": {
              outline: "2px solid var(--primary)",
              outlineOffset: "2px",
            },
          }),
        ],
      }),
    });
    view.current = editor;
    const plainText = fallback.current;
    if (plainText) plainText.hidden = true;
    return () => {
      editor.destroy();
      view.current = null;
      if (plainText) plainText.hidden = false;
    };
  }, [body]);
  useEffect(() => {
    view.current?.dispatch({
      effects: presentation.current.reconfigure([
        ...(wrap ? [EditorView.lineWrapping] : []),
        ...(numbered ? [lineNumbers()] : []),
      ]),
    });
  }, [wrap, numbered, body]);
  useEffect(() => {
    let active = true;
    void languageExtension(language)
      .then((extension) => {
        if (active)
          view.current?.dispatch({
            effects: syntax.current.reconfigure(extension),
          });
      })
      .catch(() => {
        // The readable plain code remains useful when a syntax chunk is offline.
      });
    return () => {
      active = false;
    };
  }, [language, body]);
  return (
    <div className="code-preview">
      <div className="code-preview-toolbar">
        <span className="muted">{pasteLanguageLabels[language] ?? "Code"}</span>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={numbered}
            onClick={() => setNumbered(!numbered)}
          >
            Line numbers
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            Wrap lines
          </Button>
        </div>
      </div>
      <pre
        ref={fallback}
        className="overflow-auto p-5 font-mono text-sm leading-7 break-words whitespace-pre-wrap"
      >
        {body}
      </pre>
      <div ref={host} />
    </div>
  );
}
