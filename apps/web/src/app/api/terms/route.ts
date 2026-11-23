// POST /api/terms {warranty, terms}: keeps the terms text of a card issued from /kedai once it matches the chain.
import { decodeAccount, readOnlyProgram, type WarrantyAccount } from "@kekal/sdk";
import { failoverConnection } from "@kekal/server";
import { PublicKey } from "@solana/web3.js";
import { runtimeCluster, webConfig } from "@/lib/config";
import { clientIp } from "@/lib/client-ip";
import { dataStore } from "@/lib/data";
import { acceptTerms } from "@/lib/shop/accept-terms";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  const c = webConfig.terms;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > c.maxBytes * 2) return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const cluster = runtimeCluster();
  const conn = failoverConnection({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses });
  const program = readOnlyProgram(conn, new PublicKey(cluster.programId));
  const r = await acceptTerms(body, clientIp(req.headers), {
    store: dataStore(),
    maxBytes: c.maxBytes,
    perIpPerHour: c.perIpPerHour,
    chainTermsHash: async (pda) => {
      const info = await conn.getAccountInfo(new PublicKey(pda), "confirmed");
      if (!info || !info.owner.equals(program.programId)) return null;
      try {
        return decodeAccount<WarrantyAccount>(program, "warranty", info.data).termsHash;
      } catch {
        return null;
      }
    },
    now: Math.floor(Date.now() / 1000),
  });
  if (r.ok) return Response.json({ ok: true }, { headers: noStore });
  return Response.json({ error: r.error }, { status: r.status, headers: noStore });
}
