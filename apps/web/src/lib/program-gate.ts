// Routes that send transactions answer 503 program_not_deployed while the program is not on the cluster
// (config `deployed: false`), instead of failing later inside an RPC call with a raw error.
import type { RuntimeCluster } from "./config";
import { runtimeCluster } from "./config";

export const PROGRAM_NOT_DEPLOYED = "program_not_deployed";

/** null = go ahead; otherwise the response to return as is. */
export function programGate(cluster: Pick<RuntimeCluster, "deployed"> = runtimeCluster()): Response | null {
  if (cluster.deployed) return null;
  return Response.json({ error: PROGRAM_NOT_DEPLOYED }, { status: 503, headers: { "cache-control": "no-store" } });
}
