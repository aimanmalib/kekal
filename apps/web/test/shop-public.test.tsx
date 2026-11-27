// /kedai/[owner]: the public view of a shop board, its cache in front of the chain, and the server-rendered page in
// both languages. Fixtures are frozen here; no network.
import { ShopStatus, vaultPda } from "@kekal/sdk";
import { PublicKey } from "@solana/web3.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShopRecord, ShopRecordMissing } from "../src/components/kedai/ShopRecord";
import type { ShopBoard, ShopSummary } from "../src/lib/shop/board";
import { publicShop, publicShopReader, shopState, type PublicShop } from "../src/lib/shop/public";
import { translator, type Lang } from "../src/lib/i18n";
import { formatSpan } from "../src/lib/warranty/format";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const PROGRAM = key(7);
const OWNER = key(3);
const SHOP = key(4);
const T0 = 1_800_000_000;
const DAY = 86_400;

const summary = (over: Partial<ShopSummary> = {}): ShopSummary => ({
  address: SHOP.toBase58(),
  mint: key(5).toBase58(),
  arbiter: key(6).toBase58(),
  free: "125000000",
  locked: "75000000",
  status: ShopStatus.Active,
  lastSeen: T0 - 2 * DAY,
  dormantAt: 0,
  silentAt: T0 - 2 * DAY + 44 * DAY,
  windows: { responseSecs: 7 * DAY, repairSecs: 21 * DAY, disputeSecs: 14 * DAY, heartbeatSecs: 30 * DAY, graceSecs: 14 * DAY },
  nextWarrantyId: "3",
  activeWarranties: 3,
  openClaims: 0,
  issued: "3",
  paidCount: "1",
  paidAmount: "25000000",
  ...over,
});

const board = (shop: ShopSummary | null = summary()): ShopBoard => ({
  owner: OWNER.toBase58(),
  programId: PROGRAM.toBase58(),
  decimals: 6,
  chainNow: T0,
  limits: null,
  shop,
  warranties: [],
  claims: [],
});

const EXPLORER = "https://explorer.example/address/{address}?cluster=devnet";
const addressUrl = (a: string) => EXPLORER.replace("{address}", a);
const PAGE = `https://kekal.example/kedai/${OWNER.toBase58()}`;
const render = (lang: Lang, v: PublicShop, now = T0) =>
  renderToStaticMarkup(<ShopRecord view={v} lang={lang} t={translator(lang)} now={now} addressUrl={addressUrl} pageUrl={PAGE} />);

describe("public shop view", () => {
  it("is null for an owner without a shop, and derives the vault and the next check-in otherwise", () => {
    expect(publicShop(board(null))).toBeNull();
    const v = publicShop(board())!;
    expect(v.vault).toBe(vaultPda(PROGRAM, SHOP).toBase58());
    expect(v.checkInDue).toBe(T0 - 2 * DAY + 30 * DAY);
  });

  it("calls a shop late after its check-in is due and silent once marked dormant", () => {
    const v = publicShop(board())!;
    expect(shopState(v, T0)).toBe("active");
    expect(shopState(v, v.checkInDue + 1)).toBe("late");
    expect(shopState(publicShop(board(summary({ status: ShopStatus.Dormant, dormantAt: T0 })))!, T0)).toBe("silent");
  });
});

describe("public shop cache", () => {
  const settings = { cacheSecs: 60, cacheMax: 2 };

  it("reads the chain once per owner within cacheSecs, again after it, and keeps a missing shop too", async () => {
    const read = vi.fn(async (o: PublicKey) => (o.equals(OWNER) ? board() : board(null)));
    const get = publicShopReader(read, settings);
    expect(await get(OWNER, 0)).not.toBeNull();
    await get(OWNER, 59_999);
    expect(read).toHaveBeenCalledTimes(1);
    await get(OWNER, 60_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await get(key(9), 0)).toBeNull();
    expect(await get(key(9), 1)).toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("never caches a network failure and drops the oldest owner past cacheMax", async () => {
    let fail = true;
    const read = vi.fn(async () => {
      if (fail) throw new Error("429");
      return board();
    });
    const get = publicShopReader(read, settings);
    await expect(get(OWNER, 0)).rejects.toThrow("429");
    fail = false;
    await get(OWNER, 1);
    expect(read).toHaveBeenCalledTimes(2);
    await get(key(10), 2);
    await get(key(11), 3);
    await get(OWNER, 4);
    expect(read).toHaveBeenCalledTimes(5);
  });
});

describe("public shop page markup", () => {
  it("links every figure to the explorer, shows the windows and a QR slip, in English", () => {
    const v = publicShop(board())!;
    const html = render("en", v);
    const t = translator("en");
    expect(html).toContain(t("shopPage.title"));
    expect(html).toContain("75.00 kUSD");
    expect(html).toContain("125.00 kUSD");
    expect(html).toContain("7 days");
    expect(html).toContain(addressUrl(v.vault));
    const figures = [...html.matchAll(/<a class="[^"]*fig-link[^"]*" href="([^"]+)"/g)].map((m) => m[1]!);
    expect(figures.length).toBe(6 + 6);
    for (const href of figures) expect(href.startsWith("https://explorer.example/address/")).toBe(true);
    expect(html).toContain('class="shop-slip-qr"');
    expect(html).toContain(PAGE);
    expect(html).not.toContain("shop-state-alert");
  });

  it("speaks Malay and warns when the check-in is late", () => {
    const v = publicShop(board())!;
    const html = render("ms", v, v.checkInDue + 10);
    expect(html).toContain(translator("ms")("shopPage.title"));
    expect(html).toContain("7 hari");
    expect(html).toContain("shop-state-alert");
  });

  it("says so when there is no shop at the address", () => {
    const html = renderToStaticMarkup(<ShopRecordMissing reason="not_found" t={translator("en")} />);
    expect(html).toContain(translator("en")("shopPage.missing.not_found.title"));
  });

  it("states window lengths in their largest whole unit", () => {
    expect(formatSpan(14 * DAY, "en")).toBe("14 days");
    expect(formatSpan(90, "en")).toBe("90 seconds");
    expect(formatSpan(2 * 3600, "ms")).toBe("2 jam");
  });
});
