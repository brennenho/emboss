"use client";
import { StatusBadge } from "./resource-controls";
import {
  AddressPlate,
  ShareDialog,
  sharingDescription,
} from "@/components/sharing/share-dialog";

export function ResourceSummary({
  url,
  state,
  title,
  notice,
}: {
  url: string;
  state: string;
  title?: string;
  notice?: string;
}) {
  return (
    <section className="resource-summary" aria-label="Sharing">
      <div className="resource-summary-top">
        <StatusBadge state={state} />
        {notice && (
          <p role="status" className="resource-notice">
            {notice}
          </p>
        )}
        <ShareDialog
          url={url}
          state={state}
          title={title ? `Share ${title}` : undefined}
        />
      </div>
      <p className="sharing-description">{sharingDescription(state)}</p>
      <AddressPlate url={url} />
    </section>
  );
}
