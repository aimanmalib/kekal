// /contoh: the lifecycle report is shown only for the cluster the site runs on, in the configured order.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import report from "../../../config/examples.json";
import { ExamplePaths } from "../src/components/demo/ExamplePaths";
import { readExamples } from "../src/lib/demo/examples";
import { translator } from "../src/lib/i18n";

const step = (name: string, n: number) => ({ step: name, signature: `sig${n}`, explorer: `https://explorer.example/tx/sig${n}` });
const sample = {
  cluster: "devnet",
  programId: "Prog1111111111111111111111111111111111111111",
  seconds: 30,
  paths: {
    setup: [step("init_config", 0)],
    A: [step("issue_warranty", 1), step("file_claim", 2), step("respond_claim", 3), step("confirm_resolved", 4)],
    B: [step("issue_warranty", 5), step("file_claim", 6), step("settle_unanswered", 7)],
    C: [step("issue_warranty", 8), step("declare_dormant", 9), step("claim_orphan", 10)],
  },
};

describe("readExamples", () => {
  it("returns the known paths in the configured order and leaves setup out", () => {
    const ex = readExamples(sample, "devnet", ["B", "C", "A", "E", "D"]);
    expect(ex?.paths.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("shows nothing for another cluster, an empty report or links that are not https", () => {
    expect(readExamples(sample, "localnet", ["B"])).toBeNull();
    const empty = { cluster: null, programId: null, seconds: null, paths: {} };
    expect(readExamples(empty, "devnet", ["B"])).toBeNull();
    const bad = { ...sample, paths: { B: [{ ...step("file_claim", 1), explorer: "javascript:alert(1)" }] } };
    expect(readExamples(bad, "devnet", ["B"])).toBeNull();
  });
});

describe("committed report (config/examples.json)", () => {
  it("is either empty or a full run on its own cluster with https explorer links", () => {
    if (report.cluster === null) return;
    const ex = readExamples(report, report.cluster, ["A", "B", "C", "D", "E"]);
    expect(ex?.paths.map((p) => p.id)).toEqual(["A", "B", "C", "D", "E"]);
    for (const p of ex!.paths) for (const s of p.steps) expect(new URL(s.explorer).protocol).toBe("https:");
  });
});

describe("ExamplePaths markup", () => {
  it.each(["en", "ms"] as const)("names every step and links each record (%s)", (lang) => {
    const t = translator(lang);
    const html = renderToStaticMarkup(<ExamplePaths examples={readExamples(sample, "devnet", ["B", "C", "A"])!} t={t} />);
    expect(html).toContain(t("examples.path.B.title"));
    expect(html).toContain(t("examples.step.claim_orphan"));
    expect(html.match(/href="https:\/\/explorer\.example/g)).toHaveLength(10);
    expect(html).not.toContain("undefined");
  });
});
