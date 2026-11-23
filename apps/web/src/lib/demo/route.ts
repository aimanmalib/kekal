// Shared wiring for the four /api/demo/* route handlers.
import { clientIp } from "../client-ip";
import { webConfig } from "../config";
import { dataStore } from "../data";
import { demoExplorer, demoRuntime } from "./runtime";
import type { DemoDeps, DemoResult } from "./service";

const noStore = { "cache-control": "no-store" };

export async function demoRoute(
  req: Request,
  handler: (body: unknown, ip: string, deps: DemoDeps) => Promise<DemoResult>,
): Promise<Response> {
  let runtime;
  try {
    runtime = demoRuntime();
  } catch (e) {
    console.error("demo: unavailable", (e as Error).message);
    return Response.json({ error: "demo_unavailable" }, { status: 503, headers: noStore });
  }
  if (Number(req.headers.get("content-length") ?? "0") > webConfig.rpc.maxBodyBytes) {
    return Response.json({ error: "too_large" }, { status: 413, headers: noStore });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const result = await handler(body, clientIp(req.headers), {
    store: dataStore(),
    ops: runtime.ops,
    limits: webConfig.demo,
    explorer: demoExplorer(runtime.cluster),
    now: Math.floor(Date.now() / 1000),
  });
  if (result.ok) return Response.json(result.body, { headers: noStore });
  return Response.json({ error: result.error, detail: result.detail }, { status: result.status, headers: noStore });
}
