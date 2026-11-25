// Bundles the keeper into one ESM file for the container image (no TypeScript toolchain at run time).
// esbuild is the copy tsx already depends on, so no extra package is installed. Usage: node bundle.mjs <outfile>
import { createRequire } from "node:module";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const outfile = process.argv[2];
if (!outfile) throw new Error("usage: node bundle.mjs <outfile>");

await esbuild.build({
  entryPoints: [join(here, "src/main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // CommonJS dependencies inside an ESM bundle still call require() and read __filename/__dirname (bindings does,
  // on its first call during a pass), so the bundle defines all three for the bundle file itself.
  banner: {
    js: [
      "import { createRequire as __kekalRequire } from 'node:module';",
      "import { fileURLToPath as __kekalPath } from 'node:url';",
      "import { dirname as __kekalDir } from 'node:path';",
      "const require = __kekalRequire(import.meta.url);",
      "const __filename = __kekalPath(import.meta.url);",
      "const __dirname = __kekalDir(__filename);",
    ].join(" "),
  },
  logLevel: "warning",
});
