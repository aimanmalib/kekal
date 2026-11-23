import { PublicKey } from "@solana/web3.js";
import { runtimeCluster, webConfig } from "@/lib/config";
import { clientIp } from "@/lib/client-ip";
import { dataStore } from "@/lib/data";
import { relayerAddress, rpcSender } from "@/lib/relay/runtime";
import { submit } from "@/lib/submit/service";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** POST {tx: base64} -> {signature}. The transaction is signed and paid for by the caller's own wallet. */
export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > webConfig.rpc.maxBodyBytes) return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const cluster = runtimeCluster();
  const c = webConfig.submit;
  const relayer = relayerAddress();
  const result = await submit(body, clientIp(req.headers), {
    store: dataStore(),
    policy: {
      programId: new PublicKey(cluster.programId),
      forbiddenKeys: relayer ? [new PublicKey(relayer)] : [],
      allowedInstructions: c.allowedInstructions,
      maxInstructions: c.maxInstructions,
      maxTxBytes: c.maxTxBytes,
    },
    perIpPerHour: c.perIpPerHour,
    send: rpcSender({ urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses }, c.preflightCommitment),
    now: Math.floor(Date.now() / 1000),
  });
  if (result.ok) return Response.json({ signature: result.signature }, { headers: noStore });
  return Response.json({ error: result.error, detail: result.detail }, { status: result.status, headers: noStore });
}
