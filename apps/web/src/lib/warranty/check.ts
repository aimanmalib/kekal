// /semak input: a bare warranty address, or a card link (https://…/w/<address>#k=…). The fragment is discarded.
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function addressFromInput(raw: string): string | null {
  const text = raw.trim().split("#")[0] ?? "";
  if (ADDRESS.test(text)) return text;
  const m = /\/w\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?(?:[?].*)?$/.exec(text);
  return m ? m[1]! : null;
}
