// Terms text of a warranty issued from /kedai. Canonical JSON whose SHA-256 is the on-chain terms_hash; /w/[pda] reads
// `product` and `promise` (see lib/warranty/terms.ts). Shared by the browser (issue) and the server (accept).
import { canonicalJson, productHash, sha256Bytes } from "@kekal/sdk";
import type { PublicKey } from "@solana/web3.js";

export interface ShopTermsInput {
  product: string;
  serial: string;
  promise: { en: string; ms: string };
  /** Base units, as a decimal string. */
  reserve: string;
  termSecs: number;
}

const clean = (s: string) => s.normalize("NFC").trim();

export function shopTermsJson(i: ShopTermsInput): string {
  return canonicalJson({
    v: 1,
    kind: "shop",
    product: clean(i.product),
    serial: clean(i.serial),
    promise: { en: clean(i.promise.en), ms: clean(i.promise.ms) },
    reserve: i.reserve,
    termSecs: i.termSecs,
  });
}

export function termsHashOf(json: string): Uint8Array {
  return sha256Bytes(new TextEncoder().encode(json));
}

/** product_hash binds the card to this shop, serial and product name (SDK productHash). */
export function shopProductHash(shop: PublicKey, i: Pick<ShopTermsInput, "product" | "serial">): Uint8Array {
  return productHash(shop, i.serial, i.product);
}
