"use client";

import { useRef, useState } from "react";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApiError } from "@/shared/client-api";
import { formatBytes } from "@/shared/format";

const fieldLabels: Record<string, string> = {
  body: "Content",
  slug: "Address",
  expiresAt: "Expires",
  destinationUrl: "Destination",
  displayName: "Name",
  publicEmail: "Email",
  publicPhone: "Phone",
  avatarBlobId: "Portrait",
  showScheduling: "Scheduling link",
  websiteUrl: "Personal website",
  providerLabel: "Booking provider",
  uploadMaxBytes: "Maximum file size",
  pasteMaxBytes: "Maximum paste size",
  quotaBytes: "Storage limit",
  showPoweredBy: "Emboss credit",
};
const hiddenFields = new Set([
  "id",
  "revision",
  "updatedAt",
  "createdAt",
  // A rename command option, not a value stored on the saved resource.
  "previousAddress",
]);

function fieldValue(key: string, value: unknown): string {
  if (key === "avatarBlobId")
    return value ? "Portrait selected" : "No portrait";
  if (value === null || value === undefined || value === "")
    return key === "expiresAt" ? "No expiry" : "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number" && key.endsWith("Bytes"))
    return formatBytes(value);
  if (key === "expiresAt" && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  if (Array.isArray(value))
    return (
      value
        .map((item: unknown) => {
          if (
            item &&
            typeof item === "object" &&
            "label" in item &&
            "url" in item
          )
            return `${String(item.label)}\n${String(item.url)}`;
          return String(item);
        })
        .join("\n\n") || "None"
    );
  return String(value);
}

function DraftFields({ value, label }: { value: unknown; label: string }) {
  const entries: [string, unknown][] =
    value && typeof value === "object"
      ? Object.entries(value).filter(([key]) => !hiddenFields.has(key))
      : [["body", value]];
  return (
    <dl
      tabIndex={0}
      aria-label={label}
      className="bg-card max-h-80 overflow-auto rounded border px-3"
    >
      {entries.map(([key, value]) => (
        <div key={key} className="border-b py-3 last:border-0">
          <dt className="text-muted-foreground mb-1 text-xs">
            {fieldLabels[key] ??
              key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (letter) => letter.toUpperCase())}
          </dt>
          <dd
            className={`text-sm break-words whitespace-pre-wrap ${key === "body" ? "font-mono" : ""}`}
          >
            {fieldValue(key, value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function draftText(draft: unknown) {
  if (typeof draft === "string") return draft;
  return JSON.stringify(draft, null, 2);
}

function comparableFields(latest: unknown, draft: unknown) {
  if (
    !draft ||
    typeof draft !== "object" ||
    !latest ||
    typeof latest !== "object"
  )
    return latest;
  const saved = latest as Record<string, unknown>;
  return Object.fromEntries(Object.keys(draft).map((key) => [key, saved[key]]));
}

export function ConflictRecovery<R>({
  error,
  draft,
  loadLatest,
  onUseLatest,
}: {
  error: ApiError | null;
  draft: unknown;
  loadLatest: () => Promise<R>;
  onUseLatest: (record: R) => void;
}) {
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<{ record: R } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const requestId = useRef(0);

  if (error?.code !== "CONFLICT") return null;

  async function review() {
    const request = ++requestId.current;
    setOpen(true);
    setPending(true);
    setLoadError("");
    setLatest(null);
    try {
      const record = await loadLatest();
      if (request === requestId.current) setLatest({ record });
    } catch (cause) {
      if (request === requestId.current)
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "Could not load the saved version. Try again.",
        );
    } finally {
      if (request === requestId.current) setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draftText(draft));
      setMessage("Draft copied");
    } catch {
      setMessage("Could not copy. Download your draft to keep a copy.");
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([draftText(draft)], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "emboss-unsaved-draft.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Draft downloaded");
  }

  return (
    <div className="conflict-recovery form-stack">
      <p className="text-sm">
        Your edits are still here. Keep a copy before using the latest saved
        version.
      </p>
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <Copy />
          Copy my draft
        </Button>
        <Button type="button" variant="ghost" onClick={download}>
          <Download />
          Download draft
        </Button>
        <Button type="button" variant="outline" onClick={() => void review()}>
          Review latest
        </Button>
      </div>
      <p role="status" className="text-muted-foreground text-sm">
        {message}
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review the saved version</DialogTitle>
            <DialogDescription>
              Nothing changes until you choose a version. Using the saved
              version replaces your unsaved edits.
            </DialogDescription>
          </DialogHeader>
          {pending && <p role="status">Loading the latest version…</p>}
          {loadError && <p role="alert">{loadError}</p>}
          {latest && (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">Your unsaved edits</h3>
                <DraftFields value={draft} label="Your unsaved edits" />
              </section>
              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">
                  Latest saved version
                </h3>
                <DraftFields
                  value={comparableFields(latest.record, draft)}
                  label="Latest saved version"
                />
              </section>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Keep editing
            </Button>
            {loadError && (
              <Button type="button" onClick={() => void review()}>
                Try again
              </Button>
            )}
            {latest && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  onUseLatest(latest.record);
                  setOpen(false);
                }}
              >
                Discard my edits and use saved version
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
