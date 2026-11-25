import { webConfig } from "@/lib/config";
import { readBodyText } from "@/lib/body";
import { clientIp } from "@/lib/client-ip";
import { dataStore } from "@/lib/data";
import { relayPolicy, relayRuntime, rpcSender } from "@/lib/relay/runtime";
import { programGate } from "@/lib/program-gate";
import { relay } from "@/lib/relay/service";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  const gate = programGate();
  if (gate) return gate;
  let runtime;
  try {
    runtime = relayRuntime();
  } catch {
    return Response.json({ error: "relayer_unavailable" }, { status: 503, headers: noStore });
  }
  const text = await readBodyText(req, webConfig.rpc.maxBodyBytes);
  if (text === null) return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  let body: unknown;
  try {
    body = JSON.parse(text);
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
