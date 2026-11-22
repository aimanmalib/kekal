import { BlockList, isIP } from "node:net";
import { webConfig } from "./config";

export interface ClientIpPolicy {
  cdnHeader: string;
  cdnRanges: string[];
}

const lists = new WeakMap<string[], BlockList>();

function rangeList(ranges: string[]): BlockList {
  let bl = lists.get(ranges);
  if (bl) return bl;
  bl = new BlockList();
  for (const r of ranges) {
    const [net, bits] = r.split("/");
    const family = isIP(net ?? "") === 6 ? "ipv6" : "ipv4";
    bl.addSubnet(net ?? "", Number(bits), family);
  }
  lists.set(ranges, bl);
  return bl;
}

function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return isIP(s) ? s : null;
}

/**
 * Client address for rate limits. The peer is what the reverse proxy saw (X-Real-IP, else the last X-Forwarded-For hop);
 * the CDN header is believed only when that peer is a CDN edge. Unknown = "unknown" (all such callers share one bucket).
 */
export function clientIp(headers: Headers, policy: ClientIpPolicy = webConfig.clientIp): string {
  const xff = (headers.get("x-forwarded-for") ?? "").split(",");
  const peer = clean(headers.get("x-real-ip")) ?? clean(xff[xff.length - 1]);
  if (!peer) return "unknown";
  const cdn = clean(headers.get(policy.cdnHeader));
  if (cdn && rangeList(policy.cdnRanges).check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4")) return cdn;
  return peer;
}
