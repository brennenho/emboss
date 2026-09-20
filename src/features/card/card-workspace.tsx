"use client";
import { useRouter } from "next/navigation";
import { Plus, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import { ToggleField } from "@/components/patterns/toggle-field";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { UploadControl } from "@/components/patterns/upload-control";
import { AddressPlate, ShareDialog } from "@/components/sharing/share-dialog";
import { StatusBadge } from "@/components/patterns/resource-controls";
import { BusinessCardView } from "./business-card-view";
import type { CardData } from "@/shared/configuration";
import { useEditor } from "@/components/patterns/use-editor";
import { EditorActions } from "@/components/patterns/editor-actions";
import { api } from "@/shared/client-api";
const fields = [
  ["displayName", "Display name", 100],
  ["role", "Role", 100],
  ["organization", "Organization", 100],
  ["website", "Website", 2048],
  ["publicEmail", "Public email", 254],
  ["publicPhone", "Public phone", 50],
] as const;
export function CardWorkspace({
  data: incoming,
  origin,
  schedulingEnabled,
  maxAvatarBytes,
}: {
  data: CardData;
  origin: string;
  schedulingEnabled: boolean;
  maxAvatarBytes: number;
}) {
  const editor = useEditor(incoming, (record) => record);
  const { form, setForm, saved: data, dirty, mutation } = editor;
  const router = useRouter();
  const url = origin + "/contact";
  async function save(published: boolean) {
    const saved = await editor.save(async () => {
      const { revision, updatedAt: _at, ...values } = form;
      return api<CardData>("/api/admin/business-card", "PATCH", {
        ...values,
        published,
        expectedRevision: revision,
      });
    });
    if (saved) router.refresh();
  }
  async function unpublish() {
    const saved = await editor.save(
      () =>
        api<CardData>("/api/admin/business-card/unpublish", "PATCH", {
          expectedRevision: data.revision,
        }),
      true,
    );
    if (saved) router.refresh();
  }
  function move(index: number, offset: number) {
    const links = [...form.links];
    [links[index], links[index + offset]] = [
      links[index + offset]!,
      links[index]!,
    ];
    setForm({ ...form, links });
  }
  return (
    <>
      <header className="workspace-header">
        <div>
          <h1>Business card</h1>
        </div>
        <StatusBadge state={data.published ? "active" : "draft"} />
      </header>
      <div className="config-workspace">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save(data.published);
          }}
        >
          <EditorActions dirty={dirty} pending={mutation.pending}>
            <Button disabled={mutation.pending}>
              {mutation.pending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.pending}
              onClick={() => void (data.published ? unpublish() : save(true))}
            >
              {data.published ? "Unpublish card" : "Publish card"}
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
          <h2>Public details</h2>
          {fields.map(([name, label, max]) => (
            <FormField
              key={name}
              id={name}
              label={label}
              required={name === "displayName"}
              error={mutation.error?.fields?.[name]}
            >
              <Input
                {...fieldProps(name, mutation.error?.fields)}
                value={form[name]}
                onChange={(e) => setForm({ ...form, [name]: e.target.value })}
                maxLength={max}
                required={name === "displayName"}
                type={
                  name === "publicEmail"
                    ? "email"
                    : name === "website"
                      ? "url"
                      : name === "publicPhone"
                        ? "tel"
                        : "text"
                }
              />
            </FormField>
          ))}
          <FormField
            id="intro"
            label="Introduction"
            help="600 characters maximum."
            error={mutation.error?.fields?.intro}
          >
            <Textarea
              {...fieldProps("intro", mutation.error?.fields, true)}
              value={form.intro}
              onChange={(e) => setForm({ ...form, intro: e.target.value })}
              maxLength={600}
            />
          </FormField>
          <section className="form-stack border-t pt-5">
            <h2>Avatar</h2>
            <UploadControl
              avatar
              maxBytes={maxAvatarBytes}
              onComplete={(result) =>
                setForm((f) => ({ ...f, avatarBlobId: result.uploadId }))
              }
            />
            {form.avatarBlobId && (
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => setForm({ ...form, avatarBlobId: null })}
              >
                Remove avatar
              </Button>
            )}
          </section>
          <section className="form-stack border-t pt-5">
            <div className="flex items-center justify-between">
              <h2>Links</h2>
              <Button
                type="button"
                variant="outline"
                disabled={form.links.length >= 10}
                onClick={() =>
                  setForm({
                    ...form,
                    links: [...form.links, { label: "", url: "" }],
                  })
                }
              >
                <Plus />
                Add link
              </Button>
            </div>
            {form.links.map((link, index) => (
              <div key={index} className="form-stack border-l-2 pl-4">
                <div className="flex items-center justify-between">
                  <span className="muted">Link {index + 1}</span>
                  <div className="flex">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={`Move link ${index + 1} up`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={index === form.links.length - 1}
                      aria-label={`Move link ${index + 1} down`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove link ${index + 1}`}
                      onClick={() =>
                        setForm({
                          ...form,
                          links: form.links.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                </div>
                {(["label", "url"] as const).map((key) => (
                  <FormField
                    key={key}
                    id={`link-${index}-${key}`}
                    label={key === "label" ? "Label" : "URL"}
                    error={mutation.error?.fields?.[`links.${index}.${key}`]}
                  >
                    <Input
                      id={`link-${index}-${key}`}
                      value={link[key]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          links: form.links.map((l, i) =>
                            i === index ? { ...l, [key]: e.target.value } : l,
                          ),
                        })
                      }
                      type={key === "url" ? "url" : "text"}
                      required
                      maxLength={key === "url" ? 2048 : 60}
                      aria-invalid={
                        !!mutation.error?.fields?.[`links.${index}.${key}`]
                      }
                      aria-describedby={
                        mutation.error?.fields?.[`links.${index}.${key}`]
                          ? `link-${index}-${key}-error`
                          : undefined
                      }
                    />
                  </FormField>
                ))}
              </div>
            ))}
          </section>
          <ToggleField
            id="showScheduling"
            label="Include scheduling"
            help={
              schedulingEnabled
                ? "Add a booking button to your card."
                : "Enable scheduling to show the booking button."
            }
            checked={form.showScheduling}
            onChange={(v) => setForm({ ...form, showScheduling: v })}
          />

          <p className="muted">
            Anyone with the address can view your published card.
          </p>
        </form>
        <aside className="form-stack min-w-0">
          <div>
            <p className="section-label">
              Preview{dirty ? " · Unsaved changes" : ""}
            </p>
            <BusinessCardView
              card={form}
              schedulingEnabled={schedulingEnabled}
              preview
            />
          </div>
          <AddressPlate url={url} />
          <div>
            <ShareDialog
              url={url}
              title={data.displayName || "Business card"}
              state={data.published ? "active" : "draft"}
            />
          </div>
        </aside>
      </div>
    </>
  );
}
