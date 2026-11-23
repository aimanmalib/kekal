import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/public-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import "./warranty.css";
import "./demo.css";
import { localeMetadata } from "@/lib/page-metadata";
import { requestLang } from "@/lib/request-lang";

export async function generateMetadata(): Promise<Metadata> {
  return localeMetadata();
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await requestLang();
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
