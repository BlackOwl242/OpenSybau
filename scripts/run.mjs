import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mode = process.argv[2];
if (!["dev", "production"].includes(mode)) throw new Error("Usage: node scripts/run.mjs <dev|production>");

try {
  const source = await readFile(resolve(process.env.WORKBENCH_ENV_FILE || resolve(root, ".env")), "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

process.env.WORKBENCH_MODE = mode;
// Development is always local-only, even when .env contains the production/LAN
// bind address. Network access remains available through the guarded production
// server (`npm start`).
if (mode === "dev") process.env.WORKBENCH_HOST = "127.0.0.1";
const { startWorkbench, stopWorkbench } = await import("../server.mjs");
await startWorkbench();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stopWorkbench();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
