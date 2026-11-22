import { describe, expect, it } from "vitest";
import { clientIp } from "../src/lib/client-ip";

const policy = { cdnHeader: "cf-connecting-ip", cdnRanges: ["104.16.0.0/13", "2606:4700::/32"] };
const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("CDN header believed only from a CDN peer", () => {
    expect(clientIp(h({ "x-real-ip": "104.16.1.1", "cf-connecting-ip": "203.0.113.7" }), policy)).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "2606:4700::1", "cf-connecting-ip": "2001:db8::9" }), policy)).toBe("2001:db8::9");
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
});
