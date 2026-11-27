// Footage for the demo video, only when recording explorer shots (E2E_VIDEO and E2E_EXPLORER): the public Solana
// Explorer showing the transactions and the program from the recorded devnet run (config/examples.json). The shot list
// lives in scripts/video/demo-cut.json `explorerFootage`. Filmed in Chromium at desktop size: the explorer's host turns
// headless WebKit away with a browser check, and that check is not worked around. Skipped in normal test runs, which
// stay offline.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { videoDir } from "../lib/env";
import { glide } from "../lib/film";
import { closeContext, expect, test } from "../lib/test";

const root = resolve(import.meta.dirname, "..", "..");
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(root, ...parts), "utf8")) as T;

interface Stop {
  heading?: string;
  text?: string;
  hold: number;
}
interface Shot {
  id: string;
  tx?: [string, string];
  address?: string;
  /** A ready explorer URL (live shots from the last recording on the public site). */
  url?: string;
  stops: Stop[];
}
interface LiveShot {
  id: string;
  run: string;
  step: number;
  like: string;
}
interface Footage {
  viewport: { width: number; height: number };
  loadSecs: number;
  marginPx: number;
  shots: Shot[];
  liveShots: LiveShot[];
}
interface Examples {
  cluster: string;
  paths: Record<string, { step: string; signature: string }[]>;
  [key: string]: unknown;
}

const footage = readJson<{ explorerFootage: Footage }>("scripts", "video", "demo-cut.json").explorerFootage;
const examples = readJson<Examples>("config", "examples.json");
const cluster = readJson<{ clusters: Record<string, { explorerTx: string; explorerAddress: string }> }>("config", "app.json")
  .clusters[examples.cluster]!;

/** Shots of the transactions from the last live recording (film-live.spec.ts writes live-run.json), when there is one. */
function liveShots(): Shot[] {
  const file = videoDir() ? join(videoDir()!, "live-run.json") : "";
  if (!file || !existsSync(file)) return [];
  const run = JSON.parse(readFileSync(file, "utf8")) as Record<string, [string, string][] | undefined>;
  return footage.liveShots.flatMap((live) => {
    const steps = run[live.run];
    const like = footage.shots.find((s) => s.id === live.like);
    if (!steps?.length || !like) return [];
    const url = steps.at(live.step)?.[1];
    return url ? [{ id: live.id, url, stops: like.stops }] : [];
  });
}

function shotUrl(shot: Shot): string {
  if (shot.url) return shot.url;
  if (shot.tx) {
    const [path, step] = shot.tx;
    const found = examples.paths[path]?.find((s) => s.step === step);
    if (!found) throw new Error(`config/examples.json has no step ${step} in path ${path}`);
    return cluster.explorerTx.replace("{sig}", found.signature);
  }
  const address = examples[shot.address ?? ""];
  if (typeof address !== "string") throw new Error(`config/examples.json has no address ${shot.address}`);
  return cluster.explorerAddress.replace("{address}", address);
}

for (const shot of [...footage.shots, ...liveShots()]) {
  test(`film: explorer ${shot.id}`, async ({ browser }, info) => {
    test.skip(!videoDir() || !process.env.E2E_EXPLORER, "explorer footage is only filmed when E2E_VIDEO and E2E_EXPLORER are set");
    test.skip(browser.browserType().name() !== "chromium", "explorer footage is filmed in Chromium");
    // Chromium films at the viewport size; the cut scales it up to the video size.
    const context = await browser.newContext({
      viewport: footage.viewport,
      recordVideo: { dir: join(videoDir()!, "raw"), size: footage.viewport },
    });
    const page = await context.newPage();
    await page.goto(shotUrl(shot), { waitUntil: "networkidle" });
    await page.waitForTimeout(footage.loadSecs * 1000);
    for (const stop of shot.stops) {
      const target = stop.heading
        ? page.getByRole("heading", { name: stop.heading, exact: true }).first()
        : stop.text
          ? page.getByText(stop.text).first()
          : null;
      if (target) {
        await expect(target).toBeVisible();
        const top = await target.evaluate((el, margin) => el.getBoundingClientRect().top + window.scrollY - margin, footage.marginPx);
        await glide(page, Math.max(0, top), 1500);
      }
      await page.waitForTimeout(stop.hold * 1000);
    }
    await closeContext(context, info, shot.id);
  });
}
