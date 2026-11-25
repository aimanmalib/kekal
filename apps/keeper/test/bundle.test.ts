// The container runs the keeper from one ESM bundle (bundle.mjs). CommonJS dependencies inside it read require,
// __filename and __dirname (some only when first called, during a pass), so the bundle must define every one it uses.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "kekal-keeper-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("keeper bundle", () => {
  it("loads every dependency and reaches the key check", () => {
    const out = join(dir, "keeper.mjs");
    const build = spawnSync(process.execPath, [join(__dirname, "..", "bundle.mjs"), out], { encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    const keys = join(dir, "keys");
    const run = spawnSync(process.execPath, [out, "--once"], {
      encoding: "utf8",
      cwd: dir,
      timeout: 60_000,
      env: { PATH: process.env.PATH, KEKAL_CLUSTER: "localnet", KEKAL_KEYS_DIR: keys, KEKAL_SQLITE_PATH: join(dir, "k.db") },
    });
    expect(run.stderr).not.toMatch(/ReferenceError|is not defined/);
    expect(run.stderr).toMatch(/key for role \w+ is missing or unreadable/);
    const code = readFileSync(out, "utf8");
    for (const name of ["require", "__filename", "__dirname"]) {
      if (new RegExp(`\\b${name}\\b`).test(code)) expect(code, `${name} is used but never defined`).toMatch(new RegExp(`\\b(const|var|let) ${name}\\b`));
    }
  }, 120_000);
});
