import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A failed authentication stream is useful evidence, but cannot stand in for a
// successful provider or subagent session. Keep only non-identifying fields.
const cwd = mkdtempSync(join(tmpdir(), "opensybau-claude-auth-"));
try {
  const env = { ...process.env };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) delete env[key];
  const run = spawnSync("claude", ["--bare", "-p", "--output-format", "stream-json", "--verbose", "--max-turns", "1", "Reply OK."], { cwd, env, encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 2000000 });
  const events = run.stdout.split(/\r?\n/).flatMap(line => { try { const e = JSON.parse(line); if (e.type === "system") return [{ type: e.type, subtype: e.subtype }]; if (e.type === "result" && e.is_error && /not logged in/i.test(e.result || "")) return [{ type: "result", subtype: e.subtype, is_error: true, result: "Not logged in · Please run /login" }]; } catch {} return []; });
  if (!events.some(e => e.type === "result" && e.is_error)) throw new Error("No unauthenticated result was captured; existing fixture was not overwritten.");
  const fixture = { version: spawnSync("claude", ["--version"], { encoding: "utf8", windowsHide: true }).stdout.trim(), provenance: "captured-live-unauthenticated-redacted", exitCode: run.status, events };
  writeFileSync(new URL("./fixtures/claude-unauthenticated-live.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`Captured ${events.length} redacted Claude authentication events; exit ${run.status}.`);
} finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
