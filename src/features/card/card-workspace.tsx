"use client";
import { EditorReady } from "@/components/patterns/editor-ready";
import { useState } from "react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AvatarUpload } from "./avatar-upload";
import { ConflictRecovery } from "@/components/patterns/conflict-recovery";
import { useRouter } from "next/navigation";
import { Plus, ArrowUp, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, fieldProps } from "@/components/patterns/form-field";
import { ToggleField } from "@/components/patterns/toggle-field";
import { MutationFeedback } from "@/components/patterns/mutation-feedback";
import { ResourceSummary } from "@/components/patterns/resource-summary";
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
  const [avatarPending, setAvatarPending] = useState(false);
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
  function detailFields(names: readonly string[]) {
    return fields
      .filter(([name]) => names.includes(name))
      .map(([name, label, max]) => (
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
            onChange={(event) =>
              setForm({ ...form, [name]: event.target.value })
            }
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
      ));
  }
  return (
    <EditorReady>
      <header className="workspace-header">
        <div>
          <h1>Business card</h1>
          <p className="muted">Share your contact details and links.</p>
        </div>
        {data.published && (
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noreferrer">
              View live card
            </a>
          </Button>
        )}
      </header>
      <ResourceSummary
        url={url}
        title={data.displayName || "Business card"}
        state={data.published ? "active" : "draft"}
      />
      <Tabs defaultValue="edit" className="card-workspace-tabs">
        <TabsList className="card-view-switch" aria-label="Card view">
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <div className="config-workspace">
          <TabsContent value="edit" forceMount className="card-editor-panel">
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (!avatarPending) void save(data.published);
              }}
            >
              <EditorActions dirty={dirty} pending={mutation.pending}>
                <Button disabled={mutation.pending || avatarPending || !dirty}>
                  {mutation.pending ? "Saving…" : "Save changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    mutation.pending || (!data.published && avatarPending)
                  }
                  onClick={() =>
                    void (data.published ? unpublish() : save(true))
                  }
                >
                  {data.published ? "Pause sharing" : "Publish card"}
                </Button>
              </EditorActions>
              <MutationFeedback
                {...mutation}
                onReauthenticated={() => mutation.setError(null)}
              />
              <ConflictRecovery
                error={mutation.error}
                draft={form}
                loadLatest={() => api<CardData>("/api/admin/business-card")}
                onUseLatest={editor.reset}
              />
              <section className="form-stack">
                <h2>Identity</h2>
                {detailFields(["displayName", "role", "organization"])}
                <FormField
                  id="intro"
                  label="Introduction"
                  help="600 characters maximum."
                  error={mutation.error?.fields?.intro}
                >
                  <Textarea
                    {...fieldProps("intro", mutation.error?.fields, true)}
                    value={form.intro}
                    onChange={(e) =>
                      setForm({ ...form, intro: e.target.value })
                    }
                    maxLength={600}
                  />
                </FormField>
                <AvatarUpload
                  maxBytes={maxAvatarBytes}
                  onPendingChange={setAvatarPending}
                  onComplete={(id) =>
                    setForm((current) => ({ ...current, avatarBlobId: id }))
                  }
                />
                {form.avatarBlobId && (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    disabled={avatarPending}
                    onClick={() => setForm({ ...form, avatarBlobId: null })}
                  >
                    Remove portrait
                  </Button>
                )}
              </section>
              <section className="form-stack border-t pt-5">
                <h2>Contact</h2>
                <p className="muted">
                  Only include details you are comfortable sharing publicly.
                </p>
                {detailFields(["publicEmail", "publicPhone", "website"])}
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
                        error={
                          mutation.error?.fields?.[`links.${index}.${key}`]
                        }
                      >
                        <Input
                          id={`link-${index}-${key}`}
                          value={link[key]}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              links: form.links.map((l, i) =>
                                i === index
                                  ? { ...l, [key]: e.target.value }
                                  : l,
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

              {!schedulingEnabled && (
                <Link
                  href="/admin/scheduling"
                  className="text-sm underline underline-offset-4"
                >
                  Set up scheduling
                </Link>
              )}
              <p className="muted">
                {data.published
                  ? "Anyone with the link can view your card."
                  : "Only you can open this until you publish it."}
              </p>
            </form>
          </TabsContent>
          <TabsContent
            value="preview"
            forceMount
            className="card-preview-panel"
          >
            <aside className="card-preview-sticky form-stack min-w-0">
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
            </aside>
          </TabsContent>
        </div>
      </Tabs>
    </EditorReady>
  );
}
