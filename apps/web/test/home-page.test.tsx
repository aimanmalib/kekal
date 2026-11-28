// Home page for a first-time visitor: brand mark in the header and footer, the reviewer links only when their targets
// exist, and the sample card on a drawn phone directly under the title.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { readFileSync } from "node:fs";
import app from "../../../config/app.json";
import { JudgeLinks } from "../src/components/JudgeLinks";
import { SeeItHappen } from "../src/components/home/SeeItHappen";
import { SiteFrame } from "../src/components/SiteFrame";
import { fill, translator } from "../src/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const request = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "kekal_lang" ? { value: request.lang } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("../src/lib/demo/site-examples", () => ({ siteExamples: () => null }));

/** Bullets in the README's Limits section: the home page lists the same limits. */
const readmeLimits = () => {
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("## Limits"), readme.indexOf("\n## ", readme.indexOf("## Limits") + 1));
  return section.split("\n").filter((l) => l.startsWith("- ")).length;
};

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
  it("tells the story in the first screen: title, one sentence, the demo button, the printed card, the paid phone", { timeout: 30_000 }, async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "true");
    for (const [lang, dict] of langs) {
      const html = await render(lang);
      const at = {
        title: html.indexOf(`<h1 class="home-title">${dict["home.title"]}</h1>`),
        story: html.indexOf(`<p class="home-story">${dict["home.story"].replaceAll("'", "&#x27;")}</p>`),
        button: html.indexOf(`<a class="button" href="/demo">${dict["home.cta"]}</a>`),
        printed: html.indexOf('<svg class="printed-card"'),
        phone: html.indexOf('<div class="phone"'),
        intro: html.indexOf('<section class="intro">'),
      };
      expect(Object.values(at).every((i) => i > -1), `${lang} ${JSON.stringify(at)}`).toBe(true);
      expect(Object.values(at), lang).toEqual([...Object.values(at)].sort((a, b) => a - b));
      // At most 25 words of prose before the button: the title and the one sentence.
      const words = `${dict["home.title"]} ${dict["home.story"]}`.split(/\s+/).length;
      expect(words, lang).toBeLessThanOrEqual(25);
      const printed = html.slice(at.printed, html.indexOf("</svg>", at.printed));
      expect(printed, lang).toContain(`aria-label="${dict["home.print.label"]}"`);
      for (const key of ["card.title", "card.sample.product", "card.sample.serial"] as const) expect(printed, `${lang} ${key}`).toContain(`>${dict[key]}</text>`);
      const onPhone = html.slice(at.phone, at.intro);
      expect(onPhone, lang).toContain(`aria-label="${dict["home.phone.label"]}"`);
      expect(onPhone, lang).toContain(`class="card-title">${dict["card.title"]}`);
      expect(onPhone, lang).toContain(dict["stamp.paid"]);
      expect(onPhone, lang).toContain(dict["card.sample.note"]);
    }
  });
  it("offers the finished examples, not the closed demo, in the first screen while the program is not deployed", { timeout: 30_000 }, async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    for (const [lang, dict] of langs) {
      const html = await render(lang);
      expect(html, lang).not.toContain('href="/demo"');
      expect(html.indexOf('<svg class="printed-card"'), lang).toBeGreaterThan(html.indexOf(`<p class="home-story">`));
      expect(html, lang).toContain(dict["card.sample.notePending"]);
    }
  });
  it("shows the reviewer row only for the links config has, while the program is not deployed", async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    const html = await render("en");
    const { repoUrl, videoUrl } = app.web.home as { repoUrl: string | null; videoUrl: string | null };
    expect(html.includes("judge-links")).toBe(Boolean(repoUrl || videoUrl));
    if (repoUrl) expect(html).toContain(`href="${repoUrl}"`);
  });
});

describe("home page below the first screen", () => {
  const render = async (lang: "en" | "ms") => {
    request.lang = lang;
    const { default: Home } = await import("../src/app/page");
    return renderToStaticMarkup(await Home());
  };
  it("follows the intro with how it works, see it happen, why, questions and limits, in both languages", { timeout: 30_000 }, async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    for (const [lang, dict] of langs) {
      const html = await render(lang);
      const at = (key: keyof typeof dict) => html.indexOf(`>${dict[key]}</h2>`);
      const order = [html.indexOf('<section class="intro">'), at("home.how.title"), at("home.see.title"), at("home.why.title"), at("home.faq.title"), at("home.limits.title")];
      expect(order.every((i) => i > -1), lang).toBe(true);
      expect([...order].sort((a, b) => a - b), lang).toEqual(order);
      // Three steps, each a screen in the page's own language, AVIF first with WebP as the fallback, sized to avoid layout shift.
      const how = html.slice(order[1]!, order[2]);
      expect(how.match(/<source type="image\/avif" srcSet="[^"]+\.avif"/g), lang).toHaveLength(3);
      // Loaded with the page, not on scroll: a full-page screenshot (a reviewer's tool, a link preview) shows all three.
      expect(how.match(/<img [^>]*loading="eager"/g), lang).toHaveLength(3);
      expect(how, lang).not.toContain('loading="lazy"');
      for (const step of ["shop", "card", "paid"]) {
        expect(how, lang).toMatch(new RegExp(`<img src="[^"]*${step}-${lang}[^"]*\\.webp"[^>]*width="390" height="780"`));
        expect(how, lang).toContain(`alt="${dict[`home.how.${step}.alt` as keyof typeof dict].replaceAll("'", "&#x27;")}"`);
      }
      // No run recorded for devnet yet: the endings are described with no record links.
      const see = html.slice(order[2]!, order[3]);
      expect(see, lang).toContain(fill(dict["home.see.ledePending"], { network: dict["cluster.devnet"] }));
      expect(see, lang).not.toContain(dict["home.see.record"]);
      expect(html.slice(order[3]!, order[4]), lang).toContain(`href="${app.web.home.whySourceUrl}"`);
      expect(html.slice(order[4]!, order[5]).match(/<dt>/g), lang).toHaveLength(6);
      expect(html.slice(order[5]!).match(/<li>/g)?.length, lang).toBe(readmeLimits());
    }
  });
});

describe("see it happen", () => {
  const examples = {
    cluster: "devnet",
    programId: "Prog",
    paths: [
      { id: "B", steps: [{ step: "issue_warranty", signature: "s1", explorer: "https://explorer.example/tx/s1" }, { step: "settle_unanswered", signature: "s2", explorer: "https://explorer.example/tx/s2" }] },
    ],
  };
  it("links the public record of the step that settled each recorded path, and the video once it exists", () => {
    const html = renderToStaticMarkup(
      <SeeItHappen t={translator("en")} examples={examples} order={["B", "C"]} network="devnet" videoUrl="https://video.example/k" />,
    );
    expect(html).toContain('href="https://explorer.example/tx/s2"');
    expect(html).not.toContain("tx/s1");
    expect(html.match(new RegExp(en["home.see.record"], "g"))).toHaveLength(1);
    expect(html).toContain(en["examples.path.C.title"]);
    expect(html).toContain('href="/contoh"');
    expect(html).toContain('href="https://video.example/k"');
  });
  it("leaves out the video and the full list while they do not exist", () => {
    const html = renderToStaticMarkup(<SeeItHappen t={translator("en")} examples={null} order={["B"]} network="devnet" videoUrl={null} />);
    expect(html).not.toContain("/contoh");
    expect(html).not.toContain(en["home.see.video"]);
  });
});
