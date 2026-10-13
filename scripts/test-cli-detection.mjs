import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findAntigravityCli, probeAntigravityCli } from "../src/server/antigravity-cli.mjs";
import desktopAntigravityPath from "../desktop/antigravity-path.cjs";
import { cliConnectionStatus } from "../src/domain/provider-guides.js";

const root = await mkdtemp(join(tmpdir(), "opensybau-cli-detection-test-"));
try {
  const home = join(root, "profile");
  const local = join(home, "AppData", "Local");
  const officialPath = join(local, "agy", "bin", "agy.exe");
  const customPath = join(root, "custom", "agy.exe");
  const roamingAppData = join(home, "AppData", "Roaming");
  await mkdir(join(local, "agy", "bin"), { recursive: true });
  await mkdir(roamingAppData, { recursive: true });
  await mkdir(join(root, "custom"), { recursive: true });
  await writeFile(officialPath, "fixture");
  await writeFile(customPath, "fixture");
  assert.equal(desktopAntigravityPath.findDesktopAntigravityPath({ home, fileExists: (candidate) => candidate === officialPath }), officialPath, "The packaged desktop must pass Electron's resolved profile path into the server.");
  assert.equal(desktopAntigravityPath.findDesktopAntigravityPath({ roamingAppData, fileExists: (candidate) => candidate === officialPath }), officialPath, "Roaming AppData must locate the sibling Local profile when Electron environment variables are stale.");
  assert.equal(desktopAntigravityPath.findDesktopAntigravityPath({ localAppData: local, home, fileExists: (candidate) => candidate === officialPath }), officialPath);
  assert.equal(desktopAntigravityPath.findDesktopAntigravityPath({ explicitPath: customPath, localAppData: local, home, fileExists: (candidate) => candidate === customPath || candidate === officialPath }), customPath, "A user-configured Antigravity executable must retain precedence.");
  const locate = (options = {}) => findAntigravityCli({ platform: "win32", home, env: {}, ...options });
  assert.equal(locate({ env: { LOCALAPPDATA: join(root, "outdated-profile") } }), officialPath, "Discovery must check the real profile even when inherited LOCALAPPDATA is stale.");
  assert.equal(locate({ cachedPath: customPath }), customPath, "A confirmed custom path survives restart without PATH or an environment override.");
  assert.equal(locate({ env: { ANTIGRAVITY_CLI_PATH: join(root, "removed.exe") }, cachedPath: join(root, "removed.exe") }), officialPath, "Deleted cached/configured paths must fall back to the actual installation.");
  assert.equal(locate({ env: { ANTIGRAVITY_CLI_PATH: customPath } }), customPath, "An existing explicit path takes precedence.");

  const catalog = "Fetching available models...\n\u001b[32mgemini-3.8-flash-high\u001b[0m\tGemini Flash (High)\n";
  let modelCalls = 0;
  const recovered = await probeAntigravityCli({
    resolveExecutable: () => officialPath,
    pause: async () => {},
    run: async (_exe, args) => args[0] === "--version"
      ? { code: 0, stdout: "1.3.4", stderr: "" }
      : ++modelCalls === 1 ? { code: 1, stdout: "", stderr: "Fetching available models..." } : { code: 0, stdout: catalog, stderr: "" },
  });
  assert.equal(modelCalls, 2, "A transient startup failure must retry the catalog automatically.");
  assert.equal(recovered.available, true);
  assert.equal(recovered.models.length, 1);
  assert.equal(recovered.models[0].id, "gemini-3.8-flash-high");

  const failedProbe = async (result) => probeAntigravityCli({
    resolveExecutable: () => officialPath, pause: async () => {},
    run: async (_exe, args) => args[0] === "--version" ? { code: 0, stdout: "1.3.4", stderr: "" } : result,
  });
  const offline = await failedProbe({ code: -1, stdout: "", stderr: "Fetching available models...", timedOut: true });
  assert.equal(offline.installed, true);
  assert.equal(offline.authenticated, null, "A network/timeout failure must not imply lost sign-in.");
  assert.equal(cliConnectionStatus(offline).label, "Cần kiểm tra");
  assert.equal(cliConnectionStatus(offline).action, "refresh", "An installed CLI with a temporary failure must offer rescanning, not sign-in.");
  const loggedOut = await failedProbe({ code: 1, stdout: "", stderr: "Please sign in" });
  assert.equal(cliConnectionStatus(loggedOut).label, "Cần đăng nhập");
  assert.equal(cliConnectionStatus(loggedOut).action, "login");
  let scans = 0;
  const replaced = await probeAntigravityCli({
    resolveExecutable: () => ++scans === 1 ? join(root, "temporarily-removed.exe") : officialPath,
    pause: async () => {},
    run: async (exe, args) => exe !== officialPath ? { code: -1, stdout: "", stderr: "ENOENT" }
      : { code: 0, stdout: args[0] === "--version" ? "1.3.4" : catalog, stderr: "" },
  });
  assert.equal(replaced.available, true, "A binary replacement during startup must be rediscovered on retry.");
  assert.equal(replaced.executable, officialPath);
  console.log("CLI discovery and startup recovery checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
