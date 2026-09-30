"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalTime } from "@/components/patterns/local-time";
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
import { ConflictRecovery } from "@/components/patterns/conflict-recovery";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
import { MaintenanceStatus } from "./maintenance-status";
import type { MaintenanceHealth } from "@/server/maintenance/health";
import type { z } from "zod";
import type { settingsSchema } from "@/shared/configuration";

type Settings = Omit<z.infer<typeof settingsSchema>, "expectedRevision"> & {
  revision: number;
};
function settingsFields(record: Settings) {
  return {
    label: record.label,
    websiteUrl: record.websiteUrl,
    accent: record.accent,
    showPoweredBy: record.showPoweredBy,
    uploadMaxBytes: record.uploadMaxBytes,
    quotaBytes: record.quotaBytes,
    pasteMaxBytes: record.pasteMaxBytes,
  };
}

export function SettingsWorkspace({
  data: incoming,
  origin,
  usage,
  ceilings,
  readOnly,
  expiresAt,
  passwordCommand,
  health,
}: {
  data: Settings;
  origin: string;
  usage: { used: number; pending: number; retained: number };
  ceilings: { upload: number; quota: number; paste: number };
  readOnly: boolean;
  expiresAt: string;
  passwordCommand: string;
  health: MaintenanceHealth;
}) {
  const editor = useEditor(incoming, settingsFields);
  const { form, setForm, saved: data, dirty, mutation } = editor;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const router = useRouter();
  const total = usage.used + usage.pending + usage.retained;
  const available = Math.max(0, data.quotaBytes - total);
  const usedPercent = Math.min(100, (total / data.quotaBytes) * 100);
  const limits = [
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
  ] as const;
  const hasAdvancedError = limits.some(
    ({ key }) => mutation.error?.fields?.[key],
  );
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Identity, appearance, and storage.</p>
        </div>
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void editor
              .save(async () => {
                const saved = await api<Settings>(
                  "/api/admin/settings",
                  "PATCH",
                  { ...form, expectedRevision: data.revision },
                );
                document.documentElement.dataset.accent = saved.accent;
                return saved;
              })
              .then((saved) => {
                if (saved) router.refresh();
              });
          }}
        >
          <EditorActions dirty={dirty} pending={mutation.pending}>
            <Button disabled={mutation.pending || readOnly || !dirty}>
              {mutation.pending ? "Saving…" : "Save changes"}
            </Button>
          </EditorActions>
          <MutationFeedback
            {...mutation}
            onReauthenticated={() => mutation.setError(null)}
          />
          <ConflictRecovery
            error={mutation.error}
            draft={form}
            loadLatest={() => api<Settings>("/api/admin/settings")}
            onUseLatest={(record) => editor.reset(record)}
          />
          {readOnly && (
            <p
              role="status"
              className="border-primary bg-accent rounded-md border p-3"
            >
              Changes paused for maintenance. Viewing and downloads still work.
            </p>
          )}
          <section className="form-stack" aria-labelledby="identity-title">
            <h2 id="identity-title">Identity</h2>
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
                onChange={(event) =>
                  setForm({ ...form, label: event.target.value })
                }
              />
            </FormField>
            <FormField
              id="websiteUrl"
              label="Personal website"
              help="Your site address redirects here. Leave blank to use your published card."
              error={mutation.error?.fields?.websiteUrl}
            >
              <Input
                {...fieldProps("websiteUrl", mutation.error?.fields, true)}
                type="url"
                value={form.websiteUrl}
                maxLength={2048}
                onChange={(event) =>
                  setForm({ ...form, websiteUrl: event.target.value })
                }
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
                className="font-mono text-sm"
              />
            </FormField>
          </section>
          <section
            className="form-stack border-t pt-5"
            aria-labelledby="appearance-title"
          >
            <h2 id="appearance-title">Appearance</h2>
            <FormField id="accent" label="Accent">
              <Select
                value={form.accent}
                onValueChange={(value) =>
                  setForm({ ...form, accent: value as typeof form.accent })
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
              onChange={(value) => setForm({ ...form, showPoweredBy: value })}
            />
          </section>
          <details
            className="border-t pt-5"
            open={advancedOpen || hasAdvancedError}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer font-medium">Advanced</summary>
            <p className="muted mt-2">
              Storage limits, cleanup, exports, and sign-in.
            </p>
            <div className="form-stack mt-6">
              <section className="form-stack" aria-labelledby="limits-title">
                <h2 id="limits-title">Storage limits</h2>
                <p className="muted">
                  Lowering a limit never deletes existing content.
                </p>
                {limits.map((field) => (
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
                      onChange={(event) =>
                        setForm({
                          ...form,
                          [field.key]: Math.round(
                            Number(event.target.value) * field.unit,
                          ),
                        })
                      }
                    />
                  </FormField>
                ))}
              </section>
              <div className="border-t pt-5">
                <MaintenanceStatus health={health} readOnly={readOnly} />
              </div>
              <section
                className="form-stack border-t pt-5"
                aria-labelledby="export-title"
              >
                <h2 id="export-title">Metadata export</h2>
                <p className="muted">
                  Settings, links, paste contents, and file details. Uploaded
                  files and sign-in data are excluded.
                </p>
                <Button type="button" variant="outline" asChild>
                  <a href="/api/admin/export" download>
                    Export metadata
                  </a>
                </Button>
                <p className="muted">
                  A full backup also needs the database and uploaded files.
                  Backups are managed from the project terminal; this app does
                  not track when they last ran.
                </p>
              </section>
              <section
                className="form-stack border-t pt-5"
                aria-labelledby="session-title"
              >
                <h2 id="session-title">Admin session</h2>
                <p className="muted">
                  Expires <LocalTime value={expiresAt} />.
                </p>
                <p className="muted">
                  Reset your password from the project terminal. This signs out
                  all sessions.
                </p>
                <code className="bg-secondary rounded-md p-3 text-xs break-all">
                  {passwordCommand}
                </code>
              </section>
            </div>
          </details>
        </form>
        <aside className="form-stack">
          <section
            className="quiet-panel form-stack"
            aria-labelledby="storage-title"
          >
            <h2 id="storage-title">Storage</h2>
            <div className="storage-meter">
              <p>
                <strong>{formatBytes(total)}</strong>
                <span>of {formatBytes(data.quotaBytes)} used</span>
              </p>
              <Progress value={usedPercent} aria-label="Storage used" />
            </div>
            <dl className="data-list">
              {[
                ["Active", usage.used],
                ["Uploading", usage.pending],
                ["In Trash", usage.retained],
                ["Available", available],
              ].map(([label, bytes]) => (
                <div className="flex justify-between gap-3" key={label}>
                  <dt>{label}</dt>
                  <dd className="font-mono text-sm">
                    {formatBytes(Number(bytes))}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Active storage includes drafts and your card portrait. Retained
              files count until automatic cleanup, including replaced portraits
              and unfinished uploads.
            </p>
            <Button type="button" variant="outline" asChild>
              <Link href="/admin/trash">Review Trash</Link>
            </Button>
          </section>
        </aside>
      </div>
    </>
  );
}
