// Home page for a first-time visitor: brand mark in the header and footer, the reviewer links only when their targets
// exist, and the sample card on a drawn phone directly under the title.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { JudgeLinks } from "../src/components/JudgeLinks";
import { SiteFrame } from "../src/components/SiteFrame";
import { fill, translator } from "../src/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const request = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "kekal_lang" ? { value: request.lang } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("../src/lib/demo/site-examples", () => ({ siteExamples: () => null }));

const langs = [["en", en], ["ms", ms]] as const;
const program = { id: "Prog1111111111111111111111111111111111111111", explorer: "https://explorer.example/address/Prog" };

afterEach(() => {
  vi.unstubAllEnvs();
  request.lang = "en";
});

describe("reviewer links", () => {
  it("render nothing while there is no video, no public source and no program", () => {
    const html = renderToStaticMarkup(<JudgeLinks t={translator("en")} videoUrl={null} repoUrl={null} program={null} network="devnet" />);
    expect(html).toBe("");
  });
  it("show each link only when its target exists, in both languages", () => {
    for (const [lang, dict] of langs) {
      const t = translator(lang);
      const network = dict["cluster.devnet"];
      const repoOnly = renderToStaticMarkup(
        <JudgeLinks t={t} videoUrl={null} repoUrl="https://code.example/kekal" program={null} network={network} />,
      );
      expect(repoOnly).toContain('href="https://code.example/kekal"');
      expect(repoOnly).toContain(dict["home.link.repo"]);
      expect(repoOnly).not.toContain(dict["home.link.video"]);
      expect(repoOnly).not.toContain(fill(dict["home.judge.program"], { network }));
      const all = renderToStaticMarkup(
        <JudgeLinks t={t} videoUrl="https://video.example/k" repoUrl="https://code.example/kekal" program={program} network={network} />,
      );
      expect(all).toContain(`aria-label="${dict["home.judge.label"]}"`);
      expect(all).toContain('href="https://video.example/k"');
      expect(all).toContain(`href="${program.explorer}"`);
      expect(all).toContain(fill(dict["home.judge.program"], { network }));
      // The full address stays available on the link; the visible text is shortened so it fits a phone.
      expect(all).toContain(`title="${program.id}"`);
      expect(all).toContain("Prog…1111");
      // Order on the page: video, source code, program.
      expect(all.indexOf("video.example")).toBeLessThan(all.indexOf("code.example"));
      expect(all.indexOf("code.example")).toBeLessThan(all.indexOf(program.explorer));
    }
  });
});

describe("brand mark", () => {
  it("sits in the header link home and in the footer, drawn from the tokens", () => {
    const html = renderToStaticMarkup(
      <SiteFrame lang="en" t={translator("en")}>
        <main />
      </SiteFrame>,
    );
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(header).toMatch(/<a class="wordmark" href="\/"><svg class="brand-mark"/);
    expect(footer).toContain('class="brand-mark"');
    // Colours come from CSS classes, so the mark follows the palette tokens.
    expect(html).not.toMatch(/<svg class="brand-mark"[^]*?fill="#/);
  });
});

describe("home page", () => {
  const render = async (lang: "en" | "ms") => {
    request.lang = lang;
    const { default: Home } = await import("../src/app/page");
    return renderToStaticMarkup(await Home());
  };
  it("puts the sample card on a phone right after the title, in both languages", { timeout: 30_000 }, async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    for (const [lang, dict] of langs) {
      const html = await render(lang);
      const title = html.indexOf(`<h1 class="home-title">${dict["home.title"]}</h1>`);
      const phone = html.indexOf('<div class="phone"');
      const lede = html.indexOf(`<section class="intro">`);
      expect(title, lang).toBeGreaterThan(-1);
      expect(phone, lang).toBeGreaterThan(title);
      expect(lede, lang).toBeGreaterThan(phone);
      const onPhone = html.slice(phone, lede);
      expect(onPhone, lang).toContain(`aria-label="${dict["home.phone.label"]}"`);
      expect(onPhone, lang).toContain(`class="card-title">${dict["card.title"]}`);
      expect(onPhone, lang).toContain(dict["stamp.paid"]);
      expect(onPhone, lang).toContain(dict["card.sample.notePending"]);
    }
  });
  it("shows no reviewer row while config has no video, no public source and the program is not deployed", async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    expect(await render("en")).not.toContain("judge-links");
  });
});
