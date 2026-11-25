import { BlockList, isIP } from "node:net";
import { webConfig } from "./config";

export interface ClientIpPolicy {
  cdnHeader: string;
  cdnRanges: string[];
  /** IPv6 callers share one bucket per prefix of this many bits (one home or server usually holds a whole /64). */
  ipv6PrefixBits: number;
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

/** The IPv6 address cut to its first `bits` bits, as `<groups>::/<bits>`; an IPv4-mapped address becomes the IPv4. */
export function ipv6Bucket(ip: string, bits: number): string {
  let s = ip.toLowerCase();
  const v4 = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return v4[1]!;
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[2]!.split(".").map(Number) as [number, number, number, number];
    s = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.includes("::") ? (s.split("::") as [string, string]) : [s, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const words = groups.map((g) => parseInt(g, 16));
  const out: string[] = [];
  for (let i = 0; i < 8; i++) {
    const keep = Math.max(0, Math.min(16, bits - i * 16));
    const mask = keep === 0 ? 0 : (0xffff << (16 - keep)) & 0xffff;
    out.push(((words[i] ?? 0) & mask).toString(16));
  }
  return `${out.slice(0, Math.ceil(bits / 16)).join(":")}::/${bits}`;
}

/**
 * Client address for rate limits. The peer is what the reverse proxy saw (X-Real-IP, else the last X-Forwarded-For hop);
 * the CDN header is believed only when that peer is a CDN edge. Unknown = "unknown" (all such callers share one bucket).
 * An IPv6 result is the caller's prefix (`ipv6PrefixBits`), since one network can rotate through many addresses.
 */
export function clientIp(headers: Headers, policy: ClientIpPolicy = webConfig.clientIp): string {
  const xff = (headers.get("x-forwarded-for") ?? "").split(",");
  const peer = clean(headers.get("x-real-ip")) ?? clean(xff[xff.length - 1]);
  if (!peer) return "unknown";
  const cdn = clean(headers.get(policy.cdnHeader));
  const client = cdn && rangeList(policy.cdnRanges).check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4") ? cdn : peer;
  return isIP(client) === 6 ? ipv6Bucket(client, policy.ipv6PrefixBits) : client;
}
