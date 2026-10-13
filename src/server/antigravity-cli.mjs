import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cliIsInstalled } from "./cli-status.mjs";

export function parseWindowsRegisteredEnvironmentValue(output, name) {
  const escapedName = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^\\s*${escapedName}\\s+REG_(?:EXPAND_)?SZ\\s+`, "i");
  const line = String(output || "").split(/\r?\n/).find((item) => prefix.test(item));
  return line ? line.replace(prefix, "").trim() : "";
}

export function findAntigravityCli({ env = process.env, home = homedir(), platform = process.platform, cachedPath = "", findOnPath = () => "", fileExists = existsSync } = {}) {
  const candidates = [];
  if (env.ANTIGRAVITY_CLI_PATH) candidates.push(resolve(env.ANTIGRAVITY_CLI_PATH));
  if (cachedPath && isAbsolute(cachedPath)) candidates.push(cachedPath);
  if (platform === "win32") {
    for (const local of [env.LOCALAPPDATA, resolve(home, "AppData/Local"), env.USERPROFILE && resolve(env.USERPROFILE, "AppData/Local")].filter(Boolean)) {
      candidates.push(resolve(local, "agy/bin/agy.exe"));
    }
  } else {
    candidates.push(resolve(home, ".local/bin/agy"));
  }
  const installedPath = [...new Set(candidates)].find((candidate) => candidate && fileExists(candidate));
  if (installedPath) return installedPath;
  return (platform === "win32" ? [findOnPath("agy.exe"), findOnPath("agy")] : [findOnPath("agy")])
    .find((candidate) => candidate && fileExists(candidate)) || "agy";
}

export function parseAntigravityModels(output) {
  return String(output || "").replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)
    .filter((line) => !/^fetching\b/i.test(line.trim()))
    .map((line) => {
      const [id, ...label] = line.trim().split(/\s+/);
      const effort = id?.match(/-(low|medium|high|xhigh|max)$/)?.[1];
      return id && label.length ? { id, name: label.join(" "), efforts: effort ? [effort] : ["low", "medium", "high", "xhigh", "max"] } : null;
    }).filter(Boolean);
}

function authenticationFailed(result) {
  return /(?:not (?:logged|signed) in|unauthenticated|authentication (?:required|failed)|please (?:log|sign) in|no saved session|invalid (?:credentials|refresh token)|GEMINI_API_KEY.*(?:not set|missing))/i.test(`${result.stderr || ""}\n${result.stdout || ""}`);
}

export async function probeAntigravityCli({ resolveExecutable, run, fileExists = existsSync, pause = delay }) {
  let probe;
  for (let attempt = 0; attempt < 3; attempt++) {
    const executable = resolveExecutable();
    const version = await run(executable, ["--version"], { timeout: 10000, maxBuffer: 10000 });
    const installed = cliIsInstalled(executable, version.code, fileExists);
    const catalog = installed
      ? await run(executable, ["models"], { timeout: 30000, maxBuffer: 2_000_000 })
      : { code: -1, stdout: "", stderr: version.stderr || "Không tìm thấy agy CLI trên máy." };
    const models = catalog.code === 0 ? parseAntigravityModels(catalog.stdout) : [];
    const available = installed && catalog.code === 0 && models.length > 0;
    const needsLogin = installed && authenticationFailed(catalog);
    const detail = catalog.stderr?.trim() || catalog.stdout?.trim() || "CLI chưa trả danh sách model.";
    probe = {
      executable, installed, available, authenticated: available ? true : needsLogin ? false : null,
      version: version.code === 0 ? version.stdout.trim() : "unavailable", models,
      error: available ? null : !installed ? "Không tìm thấy agy CLI trên máy." : needsLogin ? detail
        : `Đã tìm thấy Antigravity CLI nhưng chưa đọc được model${catalog.timedOut ? " (hết thời gian chờ)" : ""}: ${detail}`,
    };
    if (available || needsLogin) break;
    if (attempt < 2) await pause(attempt === 0 ? 500 : 1500);
  }
  return probe;
}
