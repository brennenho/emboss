"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import { ToggleField } from "@/components/patterns/toggle-field";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { StatusBadge } from "@/components/patterns/resource-controls";
import type { SchedulingData } from "@/shared/configuration";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
export function SchedulingWorkspace({
  data: incoming,
  origin,
}: {
  data: SchedulingData;
  origin: string;
}) {
  const editor = useEditor(incoming, (record) => record);
  const { form, setForm, saved: data, dirty, mutation } = editor;
  const router = useRouter();
  const url = origin + "/meet";
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Scheduling</h1>
        </div>
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void editor
              .save(async () => {
                const saved = await api<SchedulingData>(
                  "/api/admin/scheduling",
                  "PATCH",
                  {
                    enabled: form.enabled,
                    providerLabel: form.providerLabel,
                    destinationUrl: form.destinationUrl,
                    expectedRevision: data.revision,
                  },
                );
                return saved;
              })
              .then((saved) => {
                if (saved) router.refresh();
              });
          }}
        >
          <h2>Booking destination</h2>
          <EditorActions dirty={dirty} pending={mutation.pending}>
            <Button disabled={mutation.pending}>
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
          <FormField
            id="providerLabel"
            label="Provider"
            help="Optional"
            error={mutation.error?.fields?.providerLabel}
          >
            <Input
              {...fieldProps("providerLabel", mutation.error?.fields, true)}
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
            help="Use an https:// URL."
            error={mutation.error?.fields?.destinationUrl}
          >
            <Input
              {...fieldProps("destinationUrl", mutation.error?.fields, true)}
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
            help="Redirect /meet to your booking page."
            checked={form.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
          />
        </form>
        <aside className="quiet-panel form-stack">
          <div>
            <h2>Scheduling address</h2>
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
                  Open destination
                </a>
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
