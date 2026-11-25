import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadAppConfig } from "../lib/config";
import { configProblems, cuByStep } from "../lib/deploy";

const admin = Keypair.generate().publicKey;
const kusd = Keypair.generate().publicKey;
const usdc = Keypair.generate().publicKey;
const read = (f: string) => readFileSync(join(REPO_ROOT, f), "utf8");

describe("configProblems", () => {
  it("accepts Config owned by the deployer with every mint allowed", () => {
    expect(configProblems({ admin, allowedMints: [kusd, usdc] }, admin, [kusd, usdc])).toEqual([]);
  });
  it("reports a missing Config, another admin and a mint left out", () => {
    expect(configProblems(null, admin, [kusd])).toEqual(["Config account is missing"]);
    const other = Keypair.generate().publicKey;
    const problems = configProblems({ admin: other, allowedMints: [kusd] }, admin, [kusd, usdc]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(other.toBase58());
    expect(problems[1]).toContain(usdc.toBase58());
  });
});

describe("cuByStep", () => {
  it("groups by step in first-seen order and skips unknown units", () => {
    const rows = [
      { step: "issue_warranty", units: 30 },
      { step: "claim", units: 20 },
      { step: "issue_warranty", units: 10 },
      { step: "claim", units: null },
    ];
    expect(cuByStep(rows)).toEqual([
      { step: "issue_warranty", transactions: 2, min: 10, max: 30 },
      { step: "claim", transactions: 1, min: 20, max: 20 },
    ]);
  });
});

describe("devnet deploy", () => {
  it("uses one program address in declare_id!, Anchor.toml and config", () => {
    const declared = /declare_id!\("([^"]+)"\)/.exec(read("programs/kekal/src/lib.rs"))?.[1];
    const toml = /\[programs\.devnet\]\nkekal = "([^"]+)"/.exec(read("Anchor.toml"))?.[1];
    const devnet = loadAppConfig().clusters.devnet!;
    expect(declared).toBeTruthy();
    expect(toml).toBe(declared);
    expect(devnet.programId).toBe(declared);
  });
  it("creates Config right after the deploy, keeps the account at build size and closes buffers", () => {
    const lines = read("scripts/deploy-program.sh").split("\n").filter((l) => !l.trimStart().startsWith("#"));
    const deploy = lines.findIndex((l) => l.includes("solana program deploy"));
    const init = lines.findIndex((l) => l.includes("init-config.ts"));
    expect(deploy).toBeGreaterThan(-1);
    // Only the continuation of the deploy command may sit between the deploy and init-config.
    expect(init - deploy).toBe(2);
    expect(lines.join("\n")).not.toContain("--max-len");
    expect(lines.some((l) => l.includes("solana program close --buffers"))).toBe(true);
  });
});
