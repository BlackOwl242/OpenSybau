import assert from "node:assert/strict";
import { handleProviderSkillRoutes } from "../src/server/routes/provider-skill-routes.mjs";

async function exercise(provider, failLogout = false) {
  const calls = [];
  let result;
  const ctx = {
    getState: () => ({}),
    json: (_response, status, body) => { result = { status, body }; },
    safeError: (error) => error.message,
    run: async (exe, args) => {
      calls.push([exe, ...args]);
      return { code: failLogout && args.includes("logout") ? 1 : 0, stderr: "", stdout: "" };
    },
    cliDiscovery: {
      refreshCliExecutables() {}, expireModelCache() {}, invalidateModelCache() {},
      getCliExecutables: () => ({ codexExe: "codex", agyExe: "agy", claudeCommand: { executable: "claude", prefixArgs: [] } }),
      openCliLoginTerminal: async (...args) => { calls.push(["open", ...args]); },
    },
    skillCatalogService: {}, taskRunner: {}, providerQuotaService: { invalidateQuotaCache() {} },
  };
  await handleProviderSkillRoutes({ method: "POST" }, {}, `/api/connectors/${provider}/switch-account`, ctx);
  return { calls, result };
}

const codex = await exercise("codex");
assert.deepEqual(codex.calls[1], ["codex", "logout"]);
assert.equal(codex.calls[2][0], "open");
assert.equal(codex.result.status, 200);
const claude = await exercise("claude");
assert.deepEqual(claude.calls[1], ["claude", "auth", "logout"]);
assert.equal(claude.result.status, 200);
const anti = await exercise("antigravity");
assert.equal(anti.calls.length, 2);
assert.match(anti.result.body.message, /\/logout/);
const failed = await exercise("codex", true);
assert.equal(failed.result.status, 501);
assert.equal(failed.calls.some((call) => call[0] === "open"), false);
console.log("CLI account switch routing passed.");
