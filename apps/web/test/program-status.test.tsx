// While the program is not on the cluster (config `deployed: false`): honest notice, designed /demo state,
// health says not_deployed, and the sending routes answer 503 program_not_deployed.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../../config/app.json";
import en from "../../../locales/en.json";
import ms from "../../../locales/ms.json";
import { DemoClosed } from "../src/components/demo/DemoClosed";
import { SiteFrame } from "../src/components/SiteFrame";
import { parseFlag, runtimeCluster } from "../src/lib/config";
import { buildHealth } from "../src/lib/health";
import { fill, translator } from "../src/lib/i18n";
import { PROGRAM_NOT_DEPLOYED, programGate } from "../src/lib/program-gate";

// The language switch is a client component that asks for the app router; a static render has none.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const store = { backend: "sqlite", getConfig: () => null };

afterEach(() => vi.unstubAllEnvs());

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
    for (const [lang, dict] of [["en", en], ["ms", ms]] as const) {
      const html = frame("false", lang);
      expect(html).toContain('class="program-notice" role="status"');
      expect(html).toContain(fill(dict["notice.notDeployed"], { network: dict["cluster.devnet"] }));
    }
  });
  it("no notice once the program is deployed", () => expect(frame("true")).not.toContain("program-notice"));
  it("/demo closed state names the network and links to the finished examples", () => {
    const html = renderToStaticMarkup(<DemoClosed t={translator("en")} network={en["cluster.devnet"]} />);
    expect(html).toContain(fill(en["demo.closed.notDeployed.title"], { network: en["cluster.devnet"] }));
    expect(html).toContain('href="/contoh"');
    expect(html).toContain(en["demo.examplesLink"]);
  });
});
