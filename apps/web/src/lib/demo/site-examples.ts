// The finished examples this site can show: config/examples.json read for the cluster the site runs on.
import report from "../../../../../config/examples.json";
import { webConfig } from "../config";
import { readExamples, type Examples } from "./examples";

/** Null when no examples are recorded for this cluster (empty report, or one written on another cluster). */
export function siteExamples(cluster: string, raw: unknown = report): Examples | null {
  return readExamples(raw, cluster, webConfig.examples.paths);
}
