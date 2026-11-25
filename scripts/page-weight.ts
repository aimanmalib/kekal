// Page weight as docs/MEASURED.md reports it: the HTML, then every <script src> in it, fetched once plain and once
// with gzip. Chunks a page imports later (on a button press) are not counted, which is the point: this is what a
// phone downloads before the page is ready.
// Usage: npx tsx scripts/page-weight.ts <base-url> <path> [<path> ...]
import { gzipSync } from "node:zlib";

async function bytes(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { "accept-encoding": "identity" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export function scriptSources(html: string): string[] {
  return [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&")))];
}

async function main(): Promise<void> {
  const [base, ...paths] = process.argv.slice(2);
  if (!base || paths.length === 0) throw new Error("usage: page-weight.ts <base-url> <path> [<path> ...]");
  const out = [];
  for (const path of paths) {
    const html = (await bytes(new URL(path, base).toString())).toString("utf8");
    const scripts = scriptSources(html);
    let raw = 0;
    let gzip = 0;
    for (const src of scripts) {
      const body = await bytes(new URL(src, base).toString());
      raw += body.length;
      gzip += gzipSync(body, { level: 9 }).length;
    }
    out.push({ path, htmlBytes: Buffer.byteLength(html), scripts: scripts.length, scriptBytes: raw, scriptBytesGzip: gzip });
  }
  console.log(JSON.stringify({ base, measuredAt: new Date().toISOString(), pages: out }, null, 2));
}

if (process.argv[1]?.endsWith("page-weight.ts")) main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
