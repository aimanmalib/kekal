// Browser bundles must not reach server code: @kekal/server opens SQLite and key files (node:fs), which breaks the
// client build. Walks the import graph of every "use client" module through local and @/ imports.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));
const SERVER_ONLY = [/^@kekal\/server/, /^node:/, /^next\/headers$/];
const SERVER_FILES = new Set([join(src, "lib/config.ts"), join(src, "lib/data/index.ts")]);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(src, spec.slice(2)) : resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c) && c.match(/\.tsx?$/)) return c;
  return null;
}

function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
}

function serverReach(entry: string): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  const walk = (f: string, path: string[]) => {
    if (seen.has(f)) return;
    seen.add(f);
    if (SERVER_FILES.has(f)) bad.push([...path, relative(src, f)].join(" > "));
    for (const spec of imports(f)) {
      if (SERVER_ONLY.some((r) => r.test(spec))) bad.push([...path, relative(src, f), spec].join(" > "));
      else if (spec.startsWith(".") || spec.startsWith("@/")) {
        const next = resolveLocal(f, spec);
        if (next) walk(next, [...path, relative(src, f)]);
      }
    }
  };
  walk(entry, []);
  return bad;
}

describe("client bundles stay free of server code", () => {
  const clients = files(src).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  it("finds the client components", () => {
    expect(clients.length).toBeGreaterThan(3);
  });
  it.each(clients.map((f) => [relative(src, f), f]))("%s", (_name, f) => {
    expect(serverReach(f)).toEqual([]);
  });
});
