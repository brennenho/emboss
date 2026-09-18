"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import { ToggleField } from "@/components/patterns/toggle-field";
import { useEditorGuard } from "@/components/patterns/navigation-guard";
import {
  MutationFeedback,
  useMutation,
} from "@/components/patterns/mutation-feedback";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { StatusBadge } from "@/components/patterns/resource-controls";
import type { SchedulingData } from "@/shared/configuration";
import { api } from "@/shared/client-api";
export function SchedulingWorkspace({
  data,
  origin,
}: {
  data: SchedulingData;
  origin: string;
}) {
  const [form, setForm] = useState(data);
  const router = useRouter(),
    mutation = useMutation();
  useEditorGuard(JSON.stringify(form) !== JSON.stringify(data));
  const url = origin + "/meet";
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Scheduling</h1>
          <p>A permanent address for making time.</p>
        </div>
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void mutation.run(async () => {
              await api("/api/admin/scheduling", "PATCH", {
                enabled: form.enabled,
                providerLabel: form.providerLabel,
                destinationUrl: form.destinationUrl,
                expectedRevision: data.revision,
              });
              router.refresh();
            });
          }}
        >
          <h2>Booking destination</h2>
          <MutationFeedback
            {...mutation}
            onReauthenticated={() => mutation.setError(null)}
          />
          <FormField
            id="providerLabel"
            label="Provider label"
            help="For your reference, such as Cal.com or Calendly."
            error={mutation.error?.fields?.providerLabel}
          >
            <Input
              {...fieldProps("providerLabel", mutation.error?.fields)}
              value={form.providerLabel}
              onChange={(e) =>
                setForm({ ...form, providerLabel: e.target.value })
              }
              maxLength={80}
            />
          </FormField>
          <FormField
            id="destinationUrl"
            label="Booking URL"
            help="An HTTPS link to your booking page."
            error={mutation.error?.fields?.destinationUrl}
          >
            <Input
              {...fieldProps("destinationUrl", mutation.error?.fields)}
              value={form.destinationUrl}
              onChange={(e) =>
                setForm({ ...form, destinationUrl: e.target.value })
              }
              type="url"
              placeholder="https://cal.com/your-name"
              maxLength={2048}
            />
          </FormField>
          <ToggleField
            id="enabled"
            label="Enable scheduling"
            help="Visitors to /meet will be sent to this destination."
            checked={form.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
          />
          <div className="form-actions">
            <Button disabled={mutation.pending}>
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
        <aside className="quiet-panel form-stack">
          <div>
            <h2>Your scheduling address</h2>
            <p className="muted mt-2">
              Change providers without changing the link you share.
            </p>
          </div>
          <StatusBadge state={data.enabled ? "active" : "disabled"} />
          <AddressPlate url={url} />
          <div className="form-actions">
            <ShareDialog
              url={url}
              title="Scheduling"
              state={data.enabled ? "active" : "disabled"}
            />
            {data.destinationUrl && (
              <Button asChild variant="outline">
                <a href={data.destinationUrl} target="_blank" rel="noreferrer">
                  Test destination
                </a>
              </Button>
            )}
          </div>
          <p className="muted">
            Add the scheduling button to your business card when you want it to
            appear there.
          </p>
        </aside>
      </div>
    </>
  );
}
