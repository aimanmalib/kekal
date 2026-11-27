import { NextResponse, type NextRequest } from "next/server";
import { webConfig } from "@/lib/web-config";
import { LANG_HEADER, queryLang } from "@/lib/lang-query";

/** ?lang=ms|en: this request renders in that language and the choice is saved in the language cookie. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(LANG_HEADER);
  const lang = queryLang(request.nextUrl.searchParams);
  if (!lang) return NextResponse.next({ request: { headers } });
  headers.set(LANG_HEADER, lang);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(webConfig.locales.cookie, lang, {
    path: "/",
    maxAge: webConfig.locales.cookieMaxAgeDays * 86400,
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image).*)"],
};
