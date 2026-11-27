// Review findings fixed in the API routes: bounded body reads, and the sign-in message names the site, not the Host.
import { Keypair } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBodyText } from "../src/lib/body";
import { webConfig } from "../src/lib/config";

const saved = { ...process.env };
const SITE = "https://site.test";

/** A request whose body arrives as a stream with no Content-Length (as a chunked upload does). */
function streamed(url: string, text: string, headers: Record<string, string> = {}): Request {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1024) c.enqueue(bytes.slice(i, i + 1024));
      c.close();
    },
  });
  return new Request(url, { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readBodyText", () => {
  it("returns the text when it fits", async () => {
    expect(await readBodyText(streamed("http://x/", '{"a":1}'), 100)).toBe('{"a":1}');
  });
  it("refuses a declared length over the limit without reading", async () => {
    const req = new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "101" } });
    expect(await readBodyText(req, 100)).toBeNull();
  });
  it("stops a stream with no length once it passes the limit", async () => {
    expect(await readBodyText(streamed("http://x/", "x".repeat(5000)), 4096)).toBeNull();
  });
  it("counts bytes, not characters", async () => {
    expect(await readBodyText(streamed("http://x/", "é".repeat(60)), 100)).toBeNull();
  });
});

describe("POST /api/session/nonce", () => {
  let POST: typeof import("../src/app/api/session/nonce/route").POST;
  // The route is loaded once here, after the env is set, so a slow module load on a busy host
  // falls under this hook's timeout and not under a single test's 5 s timer.
  beforeAll(async () => {
    process.env.KEKAL_SQLITE_PATH = ":memory:";
    process.env.KEKAL_SESSION_SECRET = "s".repeat(webConfig.session.minSecretLength);
    process.env.KEKAL_SITE_URL = SITE;
    ({ POST } = await import("../src/app/api/session/nonce/route"));
  }, 30_000);
  afterAll(() => {
    process.env = { ...saved };
  });
  const json = (pubkey: string, pad = 0) => JSON.stringify({ pubkey, lang: "en" }) + " ".repeat(pad);

  it("names the configured site even when the request comes in under another host", async () => {
    const req = streamed("http://lookalike.example/api/session/nonce", json(Keypair.generate().publicKey.toBase58()), {
      host: "lookalike.example",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: string };
    expect(message).toContain(new URL(SITE).host);
    expect(message).not.toContain("lookalike.example");
  });
  it("answers 413 to an oversized body sent without a length", async () => {
    const pad = webConfig.rpc.maxBodyBytes + 1;
    const res = await POST(streamed("http://x/api/session/nonce", json(Keypair.generate().publicKey.toBase58(), pad)));
    expect(res.status).toBe(413);
  });
});
