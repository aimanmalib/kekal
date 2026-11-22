import { clientIp } from "@/lib/client-ip";
import { webConfig } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { isLang, pickLang } from "@/lib/i18n";
import { issueNonce, sessionSecret } from "@/lib/session";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** POST {pubkey, lang?} -> {nonce, message, expiresAt}. The wallet signs `message` as-is. */
export async function POST(req: Request): Promise<Response> {
  const policy = webConfig.session;
  if (!sessionSecret(process.env, policy)) return Response.json({ error: "session_unavailable" }, { status: 503, headers: noStore });
  let body: { pubkey?: unknown; lang?: unknown };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const store = dataStore();
  const now = Math.floor(Date.now() / 1000);
  if (store.hit(`session:nonce:${clientIp(req.headers)}`, 3600, now) > policy.noncePerIpPerHour) {
    return Response.json({ error: "rate_ip" }, { status: 429, headers: noStore });
  }
  const lang = isLang(body.lang) ? body.lang : pickLang(undefined, req.headers.get("accept-language"));
  const r = issueNonce(store, { pubkey: body.pubkey, domain: new URL(req.url).host, lang, now }, policy);
  if (!r.ok) return Response.json({ error: r.error }, { status: 400, headers: noStore });
  return Response.json({ nonce: r.nonce, message: r.message, expiresAt: r.expiresAt }, { headers: noStore });
}
