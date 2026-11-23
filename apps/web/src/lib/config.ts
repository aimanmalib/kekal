// Values come from config/app.json (repo root) and env; nothing here is a hard-coded setting.
import app from "../../../../config/app.json";

export { parseUrlList, runtimeCluster, type ClusterName, type RuntimeCluster } from "@kekal/server";

export type WebConfig = typeof app.web;

export const webConfig: WebConfig = app.web;

/** Reserve of the sample card on the home page: the lifecycle reserve of the default cluster, in token units. */
export function sampleReserve(): string {
  const c = app.clusters[app.defaultCluster as keyof typeof app.clusters];
  const units = Number(BigInt(c.lifecycle.reserve)) / 10 ** c.tokenDecimals;
  return units.toFixed(2);
}
