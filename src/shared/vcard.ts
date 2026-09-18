import type { CardData } from "./configuration";
export function escapeVCard(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}
export function foldVCard(line: string) {
  const encoder = new TextEncoder();
  let result = "",
    length = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}
export function vCard(card: CardData, url: string) {
  const escape = escapeVCard;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escape(card.displayName)}`,
    `N:;${escape(card.displayName)};;;`,
  ];
  if (card.organization) lines.push(`ORG:${escape(card.organization)}`);
  if (card.role) lines.push(`TITLE:${escape(card.role)}`);
  if (card.intro) lines.push(`NOTE:${escape(card.intro)}`);
  if (card.publicEmail) lines.push(`EMAIL:${escape(card.publicEmail)}`);
  if (card.publicPhone) lines.push(`TEL:${escape(card.publicPhone)}`);
  if (card.website) lines.push(`URL:${escape(card.website)}`);
  lines.push(`URL:${escape(url)}`, "END:VCARD");
  return lines.map(foldVCard).join("\r\n") + "\r\n";
}
