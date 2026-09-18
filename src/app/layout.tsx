import "./globals.css";
import localFont from "next/font/local";
import type { Metadata } from "next";
import { bindings } from "@/server/runtime";
import { database } from "@/server/db";
import { installation } from "@/server/db/schema";
const sans = localFont({
  src: [
    { path: "../styles/fonts/plex-sans-400.woff2", weight: "400" },
    { path: "../styles/fonts/plex-sans-500.woff2", weight: "500" },
    { path: "../styles/fonts/plex-sans-600.woff2", weight: "600" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});
const mono = localFont({
  src: "../styles/fonts/plex-mono-400.woff2",
  variable: "--font-plex-mono",
  display: "swap",
});
const barlow = localFont({
  src: "../styles/fonts/barlow-condensed-600.woff2",
  variable: "--font-barlow",
  display: "swap",
});
export const metadata: Metadata = {
  title: { default: "Emboss", template: "%s · Emboss" },
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};
export const dynamic = "force-dynamic";
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await database(bindings())
    .select({ accent: installation.accent })
    .from(installation)
    .get();
  return (
    <html
      lang="en"
      data-accent={settings?.accent ?? "oxide"}
      className={`${sans.variable} ${mono.variable} ${barlow.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
