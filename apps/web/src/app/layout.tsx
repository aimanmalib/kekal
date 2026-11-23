import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/public-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { translator } from "@/lib/i18n";
import { requestLang } from "@/lib/request-lang";
import { pageMetadata } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return pageMetadata(translator(lang), lang);
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await requestLang();
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
