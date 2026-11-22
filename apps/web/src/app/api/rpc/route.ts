import { runtimeCluster, webConfig } from "@/lib/config";
import { checkRequest, forwardWithFailover } from "@/lib/rpc-proxy";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

function rpcError(status: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status, headers: noStore });
}

export async function POST(req: Request): Promise<Response> {
  const cluster = runtimeCluster();
  const policy = { ...webConfig.rpc, programId: cluster.programId };
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > policy.maxBodyBytes) return rpcError(413, "request body too large");
  const checked = checkRequest(await req.text(), policy);
  if (!checked.ok) return rpcError(checked.status, checked.error);
  const payload = JSON.stringify(checked.batch ? checked.calls : checked.calls[0]);
  try {
    const up = await forwardWithFailover(payload, {
      urls: cluster.rpcUrls,
      timeoutMs: webConfig.rpc.timeoutMs,
      retryStatuses: webConfig.rpc.retryStatuses,
    });
    return new Response(up.body, { status: up.status, headers: { "content-type": "application/json", ...noStore } });
  } catch {
    return rpcError(502, "no RPC endpoint answered");
  }
}
