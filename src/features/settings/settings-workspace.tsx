"use client";
import { LocalTime } from "@/components/patterns/local-time";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import { useEditorGuard } from "@/components/patterns/navigation-guard";
import { api } from "@/shared/client-api";
import type { z } from "zod";
import type { settingsSchema } from "@/shared/configuration";
type Settings = Omit<z.infer<typeof settingsSchema>, "expectedRevision"> & {
  revision: number;
};
export function SettingsWorkspace({
  data,
  origin,
  usage,
  ceilings,
  readOnly,
  expiresAt,
}: {
  data: Settings;
  origin: string;
  usage: { used: number; pending: number; retained: number };
  ceilings: { upload: number; quota: number; paste: number };
  readOnly: boolean;
  expiresAt: string;
}) {
  const [form, setForm] = useState(data);
  const mutation = useMutation(),
    router = useRouter();
  useEditorGuard(JSON.stringify(form) !== JSON.stringify(data));
  const total = usage.used + usage.pending + usage.retained;
  const mib = (bytes: number) => (bytes / 1024 ** 2).toFixed(2) + " MiB";
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Settings</h1>
          <p>Identity, appearance, and the space your shares use.</p>
        </div>
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void mutation.run(async () => {
              await api("/api/admin/settings", "PATCH", {
                label: form.label,
                websiteUrl: form.websiteUrl,
                accent: form.accent,
                showPoweredBy: form.showPoweredBy,
                uploadMaxBytes: form.uploadMaxBytes,
                quotaBytes: form.quotaBytes,
                pasteMaxBytes: form.pasteMaxBytes,
                expectedRevision: data.revision,
              });
              document.documentElement.dataset.accent = form.accent;
              router.refresh();
            });
          }}
        >
          <h2>General</h2>
          <MutationFeedback
            {...mutation}
            onReauthenticated={() => mutation.setError(null)}
          />
          {readOnly && (
            <p role="status" className="border-primary bg-accent border p-3">
              Changes are paused for maintenance. Reading and downloading remain
              available.
            </p>
          )}
          <FormField
            id="label"
            label="Installation label"
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
            help="The root address redirects here. Leave blank to use your published card."
            error={mutation.error?.fields?.websiteUrl}
          >
            <Input
              {...fieldProps("websiteUrl", mutation.error?.fields)}
              type="url"
              value={form.websiteUrl}
              maxLength={2048}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
            />
          </FormField>
          <FormField
            id="origin"
            label="Canonical address"
            help="Configured by the operator for this installation."
          >
            <Input
              id="origin"
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
            help="A discreet footer on public pages."
            checked={form.showPoweredBy}
            onChange={(v) => setForm({ ...form, showPoweredBy: v })}
          />
          <h2 className="border-t pt-5">Storage limits</h2>
          {(
            [
              {
                key: "uploadMaxBytes",
                label: "File limit (MiB)",
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
                label: "Paste limit (KiB)",
                unit: 1024,
                max: ceilings.paste,
              },
            ] as const
          ).map((field) => (
            <FormField
              key={field.key}
              id={field.key}
              label={field.label}
              help={`Operator maximum: ${field.max / field.unit}.`}
              error={mutation.error?.fields?.[field.key]}
            >
              <Input
                {...fieldProps(field.key, mutation.error?.fields)}
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
          <div className="form-actions">
            <Button disabled={mutation.pending || readOnly}>
              {mutation.pending ? "Saving…" : "Save changes"}
            </Button>
            {mutation.error?.status === 409 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (window.confirm("Reload and discard your edits?"))
                    router.refresh();
                }}
              >
                Reload
              </Button>
            )}
          </div>
        </form>
        <aside className="form-stack">
          <section className="quiet-panel form-stack">
            <h2>Storage</h2>
            <dl className="space-y-3">
              {[
                ["Ready files", usage.used],
                ["Pending uploads", usage.pending],
                ["Retained deletions", usage.retained],
                ["Total", total],
              ].map(([label, bytes]) => (
                <div className="flex justify-between gap-3" key={label}>
                  <dt>{label}</dt>
                  <dd className="font-mono text-xs">{mib(Number(bytes))}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              {mib(data.quotaBytes)} available in this installation. Deleted
              binaries count toward storage until retention ends. Lowering a
              limit does not delete existing files.
            </p>
          </section>
          <section className="form-stack border-t pt-5">
            <h2>Your data</h2>
            <p className="muted">
              Export settings, share contents, and a file manifest. Binary files
              and authentication data are excluded.
            </p>
            <Button variant="outline" asChild>
              <a href="/api/admin/export" download>
                Export metadata
              </a>
            </Button>
            <p className="muted">
              For a complete backup, use the operator backup procedure to copy
              D1 and R2 together.
            </p>
          </section>
          <section className="form-stack border-t pt-5">
            <h2>Admin session</h2>
            <p className="muted">
              Expires <LocalTime value={expiresAt} />. Sign out from the Admin
              session menu.
            </p>
            <p className="muted">
              To change or recover the password, run the protected operator
              command on the installation host. A password rotation signs out
              every session.
            </p>
            <code className="bg-secondary p-3 text-xs break-all">
              pnpm admin:password --env production
            </code>
          </section>
        </aside>
      </div>
    </>
  );
}
