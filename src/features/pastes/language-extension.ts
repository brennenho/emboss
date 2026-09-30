import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
export async function languageExtension(language: string): Promise<Extension> {
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
