import { webConfig } from "@/lib/config";
import { clientIp } from "@/lib/client-ip";
import { dataStore } from "@/lib/data";
import { relayPolicy, relayRuntime, rpcSender } from "@/lib/relay/runtime";
import { relay } from "@/lib/relay/service";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  let runtime;
  try {
    runtime = relayRuntime();
  } catch {
    return Response.json({ error: "relayer_unavailable" }, { status: 503, headers: noStore });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > webConfig.rpc.maxBodyBytes) return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const { cluster, relayer } = runtime;
  const result = await relay(body, clientIp(req.headers), {
    store: dataStore(),
    policy: relayPolicy(cluster, relayer.publicKey),
    limits: webConfig.relay,
    relayer,
    send: rpcSender(
      { urls: cluster.rpcUrls, timeoutMs: webConfig.rpc.timeoutMs, retryStatuses: webConfig.rpc.retryStatuses },
      webConfig.relay.preflightCommitment,
    ),
    now: Math.floor(Date.now() / 1000),
  });
  if (result.ok) return Response.json({ signature: result.signature }, { headers: noStore });
  return Response.json({ error: result.error, detail: result.detail }, { status: result.status, headers: noStore });
}
