// While the program is not on the cluster (config `deployed: false`): honest notice, designed /demo state,
// health says not_deployed, and the sending routes answer 503 program_not_deployed.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../config/app.json";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { DemoClosed } from "../src/components/demo/DemoClosed";
import { ExamplesView } from "../src/components/demo/ExamplesView";
import { ShopNetworkNote } from "../src/components/kedai/ShopNetworkNote";
import { WalletPicker } from "../src/components/kedai/WalletPicker";
import { HomeFacts } from "../src/components/HomeFacts";
import { SiteFrame } from "../src/components/SiteFrame";
import { parseFlag, runtimeCluster } from "../src/lib/config";
import { buildHealth } from "../src/lib/health";
import { fill, translator } from "../src/lib/i18n";
import type { Examples } from "../src/lib/demo/examples";
import { PROGRAM_NOT_DEPLOYED, programGate } from "../src/lib/program-gate";

// The language switch is a client component that asks for the app router; a static render has none.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
// Pages read the language from the request cookie; the sweep below sets it per render.
const request = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "kekal_lang" ? { value: request.lang } : undefined) }),
  headers: async () => new Headers(),
}));

// What config/examples.json holds for the cluster: set per test so the notice does not depend on the committed report.
const recorded = vi.hoisted(() => ({ examples: null as unknown }));
vi.mock("../src/lib/demo/site-examples", () => ({ siteExamples: () => recorded.examples }));

const finished: Examples = {
  cluster: "devnet",
  programId: "Prog1111111111111111111111111111111111111111",
  paths: [{ id: "B", steps: [{ step: "issue_warranty", signature: "sig1", explorer: "https://explorer.example/tx/sig1" }] }],
};
const langs = [["en", en], ["ms", ms]] as const;

const store = { backend: "sqlite", getConfig: () => null };

afterEach(() => {
  vi.unstubAllEnvs();
  recorded.examples = null;
});

describe("deployed flag", () => {
  it("each cluster's flag comes from config", () => {
    for (const [name, c] of Object.entries(app.clusters)) {
      expect(typeof c.deployed, name).toBe("boolean");
      expect(runtimeCluster({ KEKAL_CLUSTER: name }).deployed, name).toBe(c.deployed);
    }
  });
  it("KEKAL_PROGRAM_DEPLOYED overrides it both ways", () => {
    expect(runtimeCluster({ KEKAL_CLUSTER: "localnet", KEKAL_PROGRAM_DEPLOYED: "false" }).deployed).toBe(false);
    expect(runtimeCluster({ KEKAL_CLUSTER: "devnet", KEKAL_PROGRAM_DEPLOYED: "TRUE" }).deployed).toBe(true);
    expect(runtimeCluster({ KEKAL_CLUSTER: "devnet", KEKAL_PROGRAM_DEPLOYED: "0" }).deployed).toBe(false);
  });
  it("a value that is not true or false is an error, not a silent default", () => {
    expect(() => parseFlag("yes", true)).toThrow(/true or false/);
    expect(parseFlag(" ", true)).toBe(true);
    expect(parseFlag(undefined, false)).toBe(false);
  });
});

describe("health", () => {
  it("ok with program not_deployed when the program is missing", () => {
    const h = buildHealth(runtimeCluster({ KEKAL_CLUSTER: "localnet", KEKAL_PROGRAM_DEPLOYED: "false" }), store);
    expect(h).toMatchObject({ ok: true, program: "not_deployed" });
  });
  it("program deployed otherwise", () => {
    expect(buildHealth(runtimeCluster({ KEKAL_CLUSTER: "localnet", KEKAL_PROGRAM_DEPLOYED: "true" }), store).program).toBe("deployed");
  });
});

describe("program gate", () => {
  it("lets requests through when deployed", () => expect(programGate({ deployed: true })).toBeNull());
  it("answers 503 program_not_deployed, never cached, when not", async () => {
    const r = programGate({ deployed: false });
    expect(r?.status).toBe(503);
    expect(r?.headers.get("cache-control")).toBe("no-store");
    expect(await r?.json()).toEqual({ error: PROGRAM_NOT_DEPLOYED });
    expect(en).toHaveProperty(`error.${PROGRAM_NOT_DEPLOYED}`);
  });
});

describe("site notice and /demo state", () => {
  const frame = (deployed: string, lang: "en" | "ms" = "en") => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", deployed);
    return renderToStaticMarkup(
      <SiteFrame lang={lang} t={translator(lang)}>
        <main />
      </SiteFrame>,
    );
  };
  it("every page says the program is not on the network yet, in both languages", () => {
    recorded.examples = finished;
    for (const [lang, dict] of [["en", en], ["ms", ms]] as const) {
      const html = frame("false", lang);
      expect(html).toContain('class="program-notice" role="status"');
      expect(html).toContain(fill(dict["notice.notDeployed"], { network: dict["cluster.devnet"] }));
    }
  });
  it("the notice does not promise finished examples while none are recorded", () => {
    for (const [lang, dict] of langs) {
      const html = frame("false", lang);
      const network = dict["cluster.devnet"];
      expect(html).toContain(fill(dict["notice.notDeployedPending"], { network }));
      expect(html).not.toContain(fill(dict["notice.notDeployed"], { network }));
    }
    expect(en["notice.notDeployedPending"]).not.toMatch(/example/i);
  });
  it("no notice once the program is deployed", () => expect(frame("true")).not.toContain("program-notice"));
  it("the footer does not claim the site runs on the network while the program is missing", () => {
    for (const [lang, dict] of [["en", en], ["ms", ms]] as const) {
      const network = dict["cluster.devnet"];
      const pending = frame("false", lang);
      expect(pending).not.toContain(fill(dict["footer.network"], { network }));
      expect(pending).toContain(fill(dict["footer.networkPending"], { network }));
      expect(frame("true", lang)).toContain(fill(dict["footer.network"], { network }));
    }
  });
  const home = (programId: string | null, examplesReady = true) =>
    renderToStaticMarkup(
      <HomeFacts
        t={translator("en")}
        stats={null}
        decimals={6}
        currency="USDC"
        programId={programId}
        explorer="https://explorer.example/x"
        network={en["cluster.devnet"]}
        examplesReady={examplesReady}
        repoUrl={null}
        videoUrl={null}
      />,
    );
  it("the home page offers the finished examples, not the closed demo, while the program is missing", () => {
    const html = home(null);
    expect(html).not.toContain(en["home.cta"]);
    expect(html).not.toContain('href="/demo"');
    expect(html).toMatch(/<a class="button" href="\/contoh">/);
  });
  it("the home page links neither the closed demo nor /contoh while no examples are recorded", () => {
    const html = home(null, false);
    expect(html).not.toContain('href="/contoh"');
    expect(html).not.toContain('href="/demo"');
    expect(html).not.toContain("home-cta");
    expect(html).toContain('href="/kedai"');
  });
  it("the sample card note does not point at the closed demo while the program is missing", () => {
    expect(en["card.sample.notePending"]).not.toMatch(/demo/i);
    expect(ms["card.sample.notePending"]).not.toMatch(/demo/i);
  });
  it("the home page leads with the live demo once deployed", () => {
    const html = home("Prog1111111111111111111111111111111111111111");
    expect(html).toContain(en["home.cta"]);
    expect(html).toMatch(/<a class="button" href="\/demo">/);
  });
  it("/demo closed state names the network and links to the finished examples", () => {
    const html = renderToStaticMarkup(<DemoClosed t={translator("en")} network={en["cluster.devnet"]} examplesReady />);
    expect(html).toContain(fill(en["demo.closed.notDeployed.title"], { network: en["cluster.devnet"] }));
    expect(html).toContain('href="/contoh"');
    expect(html).toContain(en["demo.examplesLink"]);
  });
});

describe("/contoh, /kedai and the wallet picker while the program is missing", () => {
  const view = (examples: Examples | null, deployed: boolean, lang: "en" | "ms" = "en") =>
    renderToStaticMarkup(
      <ExamplesView
        t={translator(lang)}
        examples={examples}
        deployed={deployed}
        network={(lang === "en" ? en : ms)["cluster.devnet"]}
        order={app.web.examples.paths}
      />,
    );
  it("/contoh describes the paths without claiming they ran or that the demo works", () => {
    for (const [lang, dict] of langs) {
      const html = view(null, false, lang);
      expect(html).not.toContain('href="/demo"');
      expect(html).not.toContain(dict["examples.empty"]);
      expect(html).not.toContain(dict["examples.lede"]);
      expect(html).not.toContain(dict["examples.title"]);
      expect(html).toContain(dict["examples.titlePending"]);
      expect(html).toContain(fill(dict["examples.ledePending"], { network: dict["cluster.devnet"] }));
      expect(html).toContain(dict["examples.path.B.title"]);
    }
    expect(view(null, false)).not.toMatch(/live demo works|already finished/i);
  });
  it("/contoh offers the live demo only once the program is deployed", () => {
    const html = view(null, true);
    expect(html).toContain(en["examples.empty"]);
    expect(html).toContain('href="/demo"');
    expect(view(finished, false)).not.toContain('href="/demo"');
    expect(view(finished, true)).toContain('href="/demo"');
  });
  it("/contoh shows the records and the finished wording once a run is recorded", () => {
    const html = view(finished, false);
    expect(html).toContain(en["examples.title"]);
    expect(html).toContain('href="https://explorer.example/tx/sig1"');
  });
  it("/kedai does not say it runs on the network or link to the closed demo", () => {
    for (const [lang, dict] of langs) {
      const network = dict["cluster.devnet"];
      const html = renderToStaticMarkup(<ShopNetworkNote t={translator(lang)} cluster={{ name: "devnet", deployed: false }} />);
      expect(html).not.toContain(fill(dict["kedai.devnet"], { network }));
      expect(html).not.toContain('href="/demo"');
      expect(html).toContain(fill(dict["kedai.pending"], { network }));
    }
    const live = renderToStaticMarkup(<ShopNetworkNote t={translator("en")} cluster={{ name: "devnet", deployed: true }} />);
    expect(live).toContain('href="/demo"');
  });
  it("the wallet picker offers the no-wallet demo only when it is open", () => {
    const picker = (demoOpen: boolean) =>
      renderToStaticMarkup(<WalletPicker t={translator("en")} wallets={[]} failed={false} demoOpen={demoOpen} onPick={() => undefined} />);
    expect(picker(false)).not.toContain('href="/demo"');
    expect(picker(false)).toContain(en["wallet.nonePending"]);
    expect(picker(true)).toContain('href="/demo"');
  });
  it("/demo closed state does not promise finished examples while none are recorded", () => {
    const html = renderToStaticMarkup(<DemoClosed t={translator("en")} network={en["cluster.devnet"]} examplesReady={false} />);
    expect(html).not.toContain(en["demo.examplesLink"]);
    expect(html).not.toContain(en["demo.closed.notDeployed.body"]);
    expect(html).toContain(en["demo.closed.notDeployed.bodyPending"]);
    expect(html).not.toMatch(/<a class="button" href="\/contoh">/);
  });
});

describe("error texts and the sweep of every page while the program is missing and no examples are recorded", () => {
  it("(6) error texts shown by the boards do not point at finished examples", () => {
    for (const dict of [en, ms]) {
      for (const k of ["error.program_not_deployed", "error.demo_unavailable", "error.demo_shop_missing"] as const) {
        expect(dict[k], k).not.toContain(en["examples.title"]);
        expect(dict[k], k).not.toMatch(/example|contoh|every path|setiap laluan/i);
      }
    }
  });
  it("(7) a warranty page says no card exists yet instead of reading the network", () => {
    for (const dict of [en, ms]) {
      expect(dict["missing.not_deployed.title"]).toBeTruthy();
      expect(dict["missing.not_deployed.body"]).not.toMatch(/demo|runs on|berjalan di/i);
    }
  });

  // Text that promises something which does not exist yet: fixed phrases, plus the deployed-only locale texts in both languages.
  // Matched without case, so "runs on" also catches "Runs on" and "This runs on".
  const phrases = ["live demo works", "opens now", "This runs on", "runs on", "show every path", "still show every path", "Try it yourself", "already finished"];
  const deployedOnly = [
    "footer.network", "kedai.devnet", "examples.title", "examples.lede", "examples.empty", "examples.demoLink", "notice.notDeployed",
    "home.cta", "home.examples", "demo.examplesLink", "demo.closed.notDeployed.body", "card.sample.note", "wallet.tryDemo",
    "error.demo_unavailable",
  ] as const;
  const forbidden = (dict: typeof en) => [...phrases, ...deployedOnly.map((k) => fill(dict[k], { network: dict["cluster.devnet"] }))];
  const pages: [string, () => Promise<{ default: (props: never) => Promise<React.ReactElement> }>, object?][] = [
    ["/", () => import("../src/app/page")],
    ["/contoh", () => import("../src/app/contoh/page")],
    ["/demo", () => import("../src/app/demo/page")],
    ["/kedai", () => import("../src/app/kedai/page")],
    ["/semak", () => import("../src/app/semak/page")],
    ["/timbang", () => import("../src/app/timbang/page")],
    ["/w/<pda>", () => import("../src/app/w/[pda]/page"), { params: Promise.resolve({ pda: finished.programId }) }],
  ];
  it("(8) no page says the demo works, the site runs on the network or the examples are finished", { timeout: 30_000 }, async () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "false");
    const found: string[] = [];
    for (const [lang, dict] of langs) {
      request.lang = lang;
      for (const [path, load, props] of pages) {
        const html = renderToStaticMarkup(await (await load()).default((props ?? {}) as never));
        if (!html.includes(dict["app.name"])) found.push(`${lang} ${path}: did not render`);
        if (html.includes('href="/demo"')) found.push(`${lang} ${path}: links to the closed demo`);
        for (const f of forbidden(dict)) if (html.toLowerCase().includes(f.toLowerCase())) found.push(`${lang} ${path}: "${f}"`);
      }
    }
    expect(found).toEqual([]);
  });
  it("(9) once deployed with recorded examples, the demo and the examples come back", () => {
    vi.stubEnv("KEKAL_CLUSTER", "devnet");
    vi.stubEnv("KEKAL_PROGRAM_DEPLOYED", "true");
    recorded.examples = finished;
    const t = translator("en");
    const network = en["cluster.devnet"];
    const homeHtml = renderToStaticMarkup(
      <HomeFacts t={t} stats={null} decimals={6} currency="USDC" programId={finished.programId} explorer="https://explorer.example/x"
        network={network} examplesReady repoUrl={null} videoUrl={null} />,
    );
    expect(homeHtml).toMatch(/<a class="button" href="\/demo">/);
    expect(homeHtml).toContain('href="/contoh"');
    const contoh = renderToStaticMarkup(<ExamplesView t={t} examples={finished} deployed network={network} order={app.web.examples.paths} />);
    expect(contoh).toContain(en["examples.title"]);
    expect(contoh).toContain('href="/demo"');
    const frameHtml = renderToStaticMarkup(<SiteFrame lang="en" t={t}><main /></SiteFrame>);
    expect(frameHtml).toContain(fill(en["footer.network"], { network }));
    expect(frameHtml).not.toContain("program-notice");
    expect(renderToStaticMarkup(<ShopNetworkNote t={t} cluster={{ name: "devnet", deployed: true }} />)).toContain(fill(en["kedai.devnet"], { network }));
    expect(renderToStaticMarkup(<DemoClosed t={t} network={network} examplesReady />)).toContain(en["demo.examplesLink"]);
  });
});
