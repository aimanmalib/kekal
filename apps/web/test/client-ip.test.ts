import { describe, expect, it } from "vitest";
import { clientIp, ipv6Bucket } from "../src/lib/client-ip";

const policy = { cdnHeader: "cf-connecting-ip", cdnRanges: ["104.16.0.0/13", "2606:4700::/32"], ipv6PrefixBits: 64 };
const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("CDN header believed only from a CDN peer", () => {
    expect(clientIp(h({ "x-real-ip": "104.16.1.1", "cf-connecting-ip": "203.0.113.7" }), policy)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "2606:4700::1", "cf-connecting-ip": "2001:db8::9" }), policy)).toBe("2001:db8:0:0::/64");
    expect(clientIp(h({ "x-real-ip": "198.51.100.4", "cf-connecting-ip": "203.0.113.7" }), policy)).toBe("198.51.100.4");
  });
  it("without X-Real-IP the last X-Forwarded-For hop is the peer; earlier hops are caller-supplied", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 198.51.100.4" }), policy)).toBe("198.51.100.4");
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 104.16.2.2", "cf-connecting-ip": "203.0.113.8" }), policy)).toBe("203.0.113.8");
  });
  it("junk values", () => {
    expect(clientIp(h({}), policy)).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "not-an-ip" }), policy)).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "104.16.1.1", "cf-connecting-ip": "evil" }), policy)).toBe("104.16.1.1");
  });
  it("IPv6 callers share a bucket per /64, so rotating addresses inside one network does not reset the limit", () => {
    const a = clientIp(h({ "x-real-ip": "2001:db8:aa:bb:1::1" }), policy);
    expect(a).toBe("2001:db8:aa:bb::/64");
    expect(clientIp(h({ "x-real-ip": "2001:db8:aa:bb:ffff:ffff:ffff:fffe" }), policy)).toBe(a);
    expect(clientIp(h({ "x-real-ip": "2001:db8:aa:bc::1" }), policy)).not.toBe(a);
  });
  it("ipv6Bucket expands, masks and unwraps IPv4-mapped addresses", () => {
    expect(ipv6Bucket("::1", 64)).toBe("0:0:0:0::/64");
    expect(ipv6Bucket("2001:DB8::", 48)).toBe("2001:db8:0::/48");
    expect(ipv6Bucket("2001:db8:abcd:12ff::", 56)).toBe("2001:db8:abcd:1200::/56");
    expect(ipv6Bucket("::ffff:198.51.100.4", 64)).toBe("198.51.100.4");
    expect(ipv6Bucket("64:ff9b::198.51.100.4", 128)).toBe("64:ff9b:0:0:0:0:c633:6404::/128");
  });
});
