"use client";
import { LocalTime } from "@/components/patterns/local-time";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/shared/format";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import { ToggleField } from "@/components/patterns/toggle-field";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
import type { z } from "zod";
import type { settingsSchema } from "@/shared/configuration";
type Settings = Omit<z.infer<typeof settingsSchema>, "expectedRevision"> & {
  revision: number;
};
export function SettingsWorkspace({
  data: incoming,
  origin,
  usage,
  ceilings,
  readOnly,
  expiresAt,
  passwordCommand,
}: {
  data: Settings;
  origin: string;
  usage: { used: number; pending: number; retained: number };
  ceilings: { upload: number; quota: number; paste: number };
  readOnly: boolean;
  expiresAt: string;
  passwordCommand: string;
}) {
  const editor = useEditor(incoming, (record) => record);
  const { form, setForm, saved: data, dirty, mutation } = editor;
  const router = useRouter();
  const total = usage.used + usage.pending + usage.retained;
  const usedPercent = Math.min(100, (total / data.quotaBytes) * 100);
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Settings</h1>
        </div>
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void editor
              .save(async () => {
                const saved = await api<Settings>(
                  "/api/admin/settings",
                  "PATCH",
                  {
                    label: form.label,
                    websiteUrl: form.websiteUrl,
                    accent: form.accent,
                    showPoweredBy: form.showPoweredBy,
                    uploadMaxBytes: form.uploadMaxBytes,
                    quotaBytes: form.quotaBytes,
                    pasteMaxBytes: form.pasteMaxBytes,
                    expectedRevision: data.revision,
                  },
                );
                document.documentElement.dataset.accent = form.accent;
                return saved;
              })
              .then((saved) => {
                if (saved) router.refresh();
              });
          }}
        >
          <h2>General</h2>
          <EditorActions dirty={dirty} pending={mutation.pending}>
            <Button disabled={mutation.pending || readOnly}>
              {mutation.pending ? "Saving…" : "Save changes"}
            </Button>
            {mutation.error?.status === 409 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (window.confirm("Reload and discard your edits?"))
                    window.location.reload();
                }}
              >
                Reload
              </Button>
            )}
          </EditorActions>
          <MutationFeedback
            {...mutation}
            onReauthenticated={() => mutation.setError(null)}
          />
          {readOnly && (
            <p role="status" className="border-primary bg-accent border p-3">
              Changes paused for maintenance. Viewing and downloads still work.
            </p>
          )}
          <FormField
            id="label"
            label="Site name"
            error={mutation.error?.fields?.label}
          >
            <Input
              {...fieldProps("label", mutation.error?.fields)}
              value={form.label}
              maxLength={80}
              required
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </FormField>
          <FormField
            id="websiteUrl"
            label="Personal website"
            help="Your site address redirects here. Blank uses your published card."
            error={mutation.error?.fields?.websiteUrl}
          >
            <Input
              {...fieldProps("websiteUrl", mutation.error?.fields, true)}
              type="url"
              value={form.websiteUrl}
              maxLength={2048}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
            />
          </FormField>
          <FormField
            id="origin"
            label="Site address"
            help="Set in deployment settings."
          >
            <Input
              id="origin"
              aria-describedby="origin-help"
              value={origin}
              readOnly
              className="font-mono text-xs"
            />
          </FormField>
          <h2 className="border-t pt-5">Appearance</h2>
          <FormField id="accent" label="Accent">
            <Select
              value={form.accent}
              onValueChange={(v) =>
                setForm({ ...form, accent: v as typeof form.accent })
              }
            >
              <SelectTrigger id="accent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oxide">Oxide orange</SelectItem>
                <SelectItem value="blue">Instrument blue</SelectItem>
                <SelectItem value="green">Field green</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <ToggleField
            id="showPoweredBy"
            label="Show Powered by Emboss"
            help="On public pages."
            checked={form.showPoweredBy}
            onChange={(v) => setForm({ ...form, showPoweredBy: v })}
          />
          <h2 className="border-t pt-5">Storage limits</h2>
          {(
            [
              {
                key: "uploadMaxBytes",
                label: "Maximum file size (MiB)",
                unit: 1024 ** 2,
                max: ceilings.upload,
              },
              {
                key: "quotaBytes",
                label: "Total storage (MiB)",
                unit: 1024 ** 2,
                max: ceilings.quota,
              },
              {
                key: "pasteMaxBytes",
                label: "Maximum paste size (KiB)",
                unit: 1024,
                max: ceilings.paste,
              },
            ] as const
          ).map((field) => (
            <FormField
              key={field.key}
              id={field.key}
              label={field.label}
              help={`Maximum: ${field.max / field.unit}.`}
              error={mutation.error?.fields?.[field.key]}
            >
              <Input
                {...fieldProps(field.key, mutation.error?.fields, true)}
                type="number"
                step="any"
                min={1 / field.unit}
                max={field.max / field.unit}
                required
                value={form[field.key] / field.unit}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [field.key]: Math.round(
                      Number(e.target.value) * field.unit,
                    ),
                  })
                }
              />
            </FormField>
          ))}
        </form>
        <aside className="form-stack">
          <section className="quiet-panel form-stack">
            <h2>Storage</h2>
            <div className="storage-meter">
              <p>
                <strong>{formatBytes(total)}</strong>
                <span>of {formatBytes(data.quotaBytes)} used</span>
              </p>
              <Progress value={usedPercent} aria-label="Storage used" />
            </div>
            <dl className="data-list">
              {[
                ["Files", usage.used],
                ["Uploading", usage.pending],
                ["Deleted files", usage.retained],
                ["Total", total],
              ].map(([label, bytes]) => (
                <div className="flex justify-between gap-3" key={label}>
                  <dt>{label}</dt>
                  <dd className="font-mono text-xs">
                    {formatBytes(Number(bytes))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              {formatBytes(Math.max(0, data.quotaBytes - total))} remaining.
              Deleted files count until cleanup. Lower limits do not delete
              files.
            </p>
          </section>
          <section className="form-stack border-t pt-5">
            <h2>Data export</h2>
            <p className="muted">
              Includes settings, links, pastes, and file details. Excludes file
              contents and sign-in data.
            </p>
            <Button variant="outline" asChild>
              <a href="/api/admin/export" download>
                Export data
              </a>
            </Button>
            <p className="muted">
              For a full backup, follow the backup procedure in the README.
            </p>
          </section>
          <section className="form-stack border-t pt-5">
            <h2>Admin session</h2>
            <p className="muted">
              Expires <LocalTime value={expiresAt} />.
            </p>
            <p className="muted">
              Reset your password from the project terminal. This signs out all
              sessions.
            </p>
            <code className="bg-secondary p-3 text-xs break-all">
              {passwordCommand}
            </code>
          </section>
        </aside>
      </div>
    </>
  );
}
