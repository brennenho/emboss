import type { ReactNode } from "react";

export function EditorActions({
  children,
  dirty,
  pending,
  isNew = false,
}: {
  children: ReactNode;
  dirty: boolean;
  pending: boolean;
  isNew?: boolean;
}) {
  return (
    <div className="editor-actions">
      <div className="form-actions">{children}</div>
      <p className="editor-status" role="status" aria-live="polite">
        {pending
          ? "Saving…"
          : dirty
            ? "Unsaved changes"
            : isNew
              ? "Not saved"
              : "Saved"}
      </p>
    </div>
  );
}
