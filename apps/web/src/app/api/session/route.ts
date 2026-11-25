import { cookies } from "next/headers";
import { readBodyText } from "@/lib/body";
import { webConfig } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { completeSignIn, readSession, sessionSecret } from "@/lib/session";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };
const unavailable = () => Response.json({ error: "session_unavailable" }, { status: 503, headers: noStore });

/** GET -> {pubkey} of the signed-in wallet, or 401. */
export async function GET(): Promise<Response> {
  const secret = sessionSecret(process.env, webConfig.session);
  if (!secret) return unavailable();
  const token = (await cookies()).get(webConfig.session.cookie)?.value;
  const pubkey = readSession(token, secret, Math.floor(Date.now() / 1000));
  if (!pubkey) return Response.json({ error: "signed_out" }, { status: 401, headers: noStore });
  return Response.json({ pubkey }, { headers: noStore });
}

/** POST {pubkey, nonce, signature} -> sets the httpOnly session cookie. */
export async function POST(req: Request): Promise<Response> {
  const policy = webConfig.session;
  const secret = sessionSecret(process.env, policy);
  if (!secret) return unavailable();
  const text = await readBodyText(req, webConfig.rpc.maxBodyBytes);
  if (text === null) return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  let body: { pubkey?: unknown; nonce?: unknown; signature?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const r = completeSignIn(dataStore(), { ...body, now: Math.floor(Date.now() / 1000) }, policy, secret);
  if (!r.ok) return Response.json({ error: r.error }, { status: 401, headers: noStore });
  (await cookies()).set(webConfig.session.cookie, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: policy.ttlSecs,
  });
  return Response.json({ pubkey: r.pubkey, expiresAt: r.expiresAt }, { headers: noStore });
}

/** DELETE -> signs out. */
export async function DELETE(): Promise<Response> {
  (await cookies()).delete(webConfig.session.cookie);
  return new Response(null, { status: 204, headers: noStore });
}
