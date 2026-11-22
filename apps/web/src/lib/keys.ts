import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

/** Loads `<keysDir>/<role>.json` (a solana-keygen file). The error never carries file contents. */
export function loadKeypair(keysDir: string | null, role: string): Keypair {
  if (!keysDir) throw new Error(`no key folder configured for role ${role}`);
  const dir = keysDir === "~" || keysDir.startsWith("~/") ? join(homedir(), keysDir.slice(1)) : keysDir;
  const path = join(dir, `${role}.json`);
  let bytes: unknown;
  try {
    bytes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`key for role ${role} is missing or unreadable`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`key for role ${role} is not a 64-byte keypair`);
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}
