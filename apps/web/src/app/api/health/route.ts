import { runtimeCluster } from "@/lib/config";
import { dataStore } from "@/lib/data";
import { buildHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export function GET(): Response {
  let store;
  try {
    store = dataStore();
  } catch (e) {
    console.error("health: data store", (e as Error).message);
    store = e as Error;
  }
  const health = buildHealth(runtimeCluster(), store);
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
