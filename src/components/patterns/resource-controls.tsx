"use client";
import { useId, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "./form-field";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
const stateLabels: Record<string, string> = {
  active: "Live",
  draft: "Draft",
  disabled: "Paused",
  expired: "Expired",
  ready: "Ready",
  uploading: "Uploading",
  finalizing: "Finishing",
  complete: "Uploaded",
  failed: "Upload failed",
  deleted: "In Trash",
};
export function statusLabel(state: string) {
  return stateLabels[state] ?? state.replaceAll("_", " ");
}
export function StatusBadge({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className="status-badge gap-1.5 border-[var(--status-border)] bg-[var(--status-bg)] text-xs font-normal text-[var(--status-fg)]"
      data-state={state}
    >
      <span className="status-indicator" aria-hidden="true" />
      {statusLabel(state)}
    </Badge>
  );
}
// Forms retain ISO values; only the hydrated input uses the browser timezone.
export function localDate(value: string | null) {
  return value ?? "";
}
export function isoDate(value: string) {
  return value || null;
}
const subscribe = () => () => {};
function inputDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function expiryHint(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day =
    date.toDateString() === now.toDateString()
      ? "today"
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `${date.getTime() <= now.getTime() ? "Expired" : "Expires"} ${day} at ${time}`;
}
export function ExpiryField({
  value,
  onChange,
  error,
  showOptionalHint = true,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  showOptionalHint?: boolean;
}) {
  const id = useId();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <FormField
      id={id}
      label="Expires"
      help={
        hydrated && value
          ? expiryHint(value)
          : `${showOptionalHint ? "Optional · " : ""}${hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "local time"}`
      }
      error={error}
    >
      <div className="expiry-presets" role="group" aria-label="Set expiry">
        {(
          [
            ["1 hour", 1],
            ["1 day", 24],
            ["1 week", 168],
          ] as const
        ).map(([label, hours]) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange(new Date(Date.now() + hours * 3600000).toISOString())
            }
          >
            {label}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange("")}
          aria-pressed={!value}
        >
          No expiry
        </Button>
      </div>
      <Input
        id={id}
        type="datetime-local"
        title={value || undefined}
        value={hydrated ? inputDate(value) : ""}
        onChange={(e) =>
          onChange(e.target.value ? new Date(e.target.value).toISOString() : "")
        }
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
      />
    </FormField>
  );
}
export function DeleteButton({
  title,
  onDelete,
  pending,
}: {
  title: string;
  onDelete: () => void;
  pending: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" disabled={pending}>
          Move to Trash
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move {title} to Trash?</AlertDialogTitle>
          <AlertDialogDescription>
            This item will no longer be public. You can restore it from Trash
            during the retention period. Its address stays reserved, so old
            links and QR codes cannot lead to a different item.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
