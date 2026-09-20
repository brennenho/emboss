"use client";
import { useSyncExternalStore } from "react";
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
export function StatusBadge({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className="status-badge gap-1.5 border-[var(--status-border)] bg-[var(--status-bg)] font-mono text-[11px] font-normal tracking-wide text-[var(--status-fg)] uppercase"
      data-state={state}
    >
      <span className="status-indicator" aria-hidden="true" />
      {state.replaceAll("_", " ")}
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
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
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
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <FormField
      id="expiresAt"
      label="Expires"
      help={`${showOptionalHint ? "Optional · " : ""}${hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "local time"}`}
      error={error}
    >
      <Input
        id="expiresAt"
        type="datetime-local"
        value={hydrated ? inputDate(value) : ""}
        onChange={(e) =>
          onChange(e.target.value ? new Date(e.target.value).toISOString() : "")
        }
        aria-invalid={!!error}
        aria-describedby={
          error ? "expiresAt-help expiresAt-error" : "expiresAt-help"
        }
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
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
          <AlertDialogDescription>
            This address will stop working. Reusing it will send old links and
            QR codes to the new item.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>
            Delete item
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
