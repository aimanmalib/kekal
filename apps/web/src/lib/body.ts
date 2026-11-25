// Request bodies for the API routes, read with a hard byte limit. Content-Length alone is not enough: a chunked
// request carries none, and `req.text()` would buffer the whole stream.

/** The body as UTF-8 text, or null when it is (or claims to be) larger than `maxBytes`. Reading stops at the limit. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
