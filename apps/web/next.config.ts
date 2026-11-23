import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  output: "standalone",
  // The monorepo root, so standalone output traces workspace packages and config/.
  outputFileTracingRoot: resolve(here, "../.."),
  transpilePackages: ["@kekal/sdk", "@kekal/server"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Anchor's browser build mentions fs for its Node wallet helper; the browser never calls it.
  turbopack: { resolveAlias: { fs: { browser: "./src/empty-module.ts" } } },
};

export default config;
