/* /meet is an HTTP redirect endpoint; it must issue a normal navigation. */
/* eslint-disable @next/next/no-html-link-for-pages */
import { webUrl } from "@/shared/resources";
import Image from "next/image";
import { ArrowUpRight, Download, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CardData } from "@/shared/configuration";
export function BusinessCardView({
  card,
  schedulingEnabled,
  preview = false,
}: {
  card: CardData;
  schedulingEnabled: boolean;
  preview?: boolean;
}) {
  return (
    <article className="business-card">
      <div className="bg-primary h-1 w-10" />
      {card.avatarBlobId && (
        <Image
          src={
            preview
              ? `/api/admin/business-card/avatar/preview?id=${card.avatarBlobId}`
              : "/contact/avatar"
          }
          alt=""
          unoptimized
          width={88}
          height={88}
          className="mt-7 h-22 w-22 rounded-sm object-cover"
        />
      )}
      <h1>{card.displayName || "Your name"}</h1>
      {(card.role || card.organization) && (
        <p className="text-sm">
          {[card.role, card.organization].filter(Boolean).join(" · ")}
        </p>
      )}
      {card.intro && <p className="intro">{card.intro}</p>}
      <Button className="my-5 w-full" asChild={!preview} disabled={preview}>
        {preview ? (
          <>
            <Download />
            Save contact
          </>
        ) : (
          <a href="/contact.vcf" download>
            <Download />
            Save contact
          </a>
        )}
      </Button>
      {card.website && (
        <a
          className="contact-link"
          href={webUrl(card.website) ? card.website : undefined}
          target="_blank"
          rel="noreferrer"
        >
          Website
          <ArrowUpRight size={16} />
        </a>
      )}
      {card.publicEmail && (
        <a className="contact-link" href={`mailto:${card.publicEmail}`}>
          {card.publicEmail}
          <ArrowUpRight size={16} />
        </a>
      )}
      {card.publicPhone && (
        <a
          className="contact-link"
          href={`tel:${card.publicPhone.replace(/[ ().-]/g, "")}`}
        >
          {card.publicPhone}
          <ArrowUpRight size={16} />
        </a>
      )}
      {card.links.map((link, index) => (
        <a
          className="contact-link"
          key={`${index}:${link.url}`}
          href={webUrl(link.url) ? link.url : undefined}
          target="_blank"
          rel="noreferrer"
        >
          {link.label || "Link"}
          <ArrowUpRight size={16} />
        </a>
      ))}
      {card.showScheduling && schedulingEnabled && (
        <a
          className="contact-link"
          href="/meet"
          target={preview ? "_blank" : undefined}
        >
          <span className="flex items-center gap-2">
            <CalendarDays size={16} />
            Schedule a time
          </span>
          <ArrowUpRight size={16} />
        </a>
      )}
    </article>
  );
}
