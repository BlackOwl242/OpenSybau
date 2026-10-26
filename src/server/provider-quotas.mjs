import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";

const QUOTA_CACHE_TTL_MS = 60_000;

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function toIsoTime(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatPlanLabel(raw) {
  const str = String(raw || "").trim();
  if (!str) return null;
  if (/ultra/i.test(str)) return "Ultra";
  if (/max/i.test(str)) return "Max";
  if (/plus/i.test(str)) return "Plus";
  if (/pro/i.test(str)) return "Pro";
  if (/team/i.test(str) && !/^TEAMS_TIER_/i.test(str)) return "Team";
  if (/free/i.test(str)) return "Free";
  const cleaned = str.replace(/^TEAMS_TIER_/i, "").replace(/_/g, " ").toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function readLatestCodexSessionQuota(home = homedir()) {
  const sessionsDir = resolve(home, ".codex", "sessions");
  if (!existsSync(sessionsDir)) return null;
  const files = [];
  function walk(dir, depth = 0) {
    if (depth > 5) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".jsonl")) {
        try { files.push({ path: full, mtimeMs: statSync(full).mtimeMs }); } catch {}
      }
    }
  }
  walk(sessionsDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files.slice(0, 8)) {
    try {
      const lines = readFileSync(file.path, "utf8").trim().split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes("rate_limits")) continue;
        const parsed = JSON.parse(line);
        const rl = parsed?.payload?.rate_limits || parsed?.rate_limits;
        if (!rl || (!rl.primary && !rl.secondary)) continue;
        const windows = [];
        if (rl.primary && typeof rl.primary.used_percent === "number") {
          const usedPercent = clampPercent(rl.primary.used_percent);
          windows.push({
            id: "codex-5h",
            label: "5h",
            windowMinutes: Number(rl.primary.window_minutes || 300),
            usedPercent,
            remainingPercent: Math.max(0, 100 - usedPercent),
            resetsAt: toIsoTime(rl.primary.resets_at),
          });
        }
        if (rl.secondary && typeof rl.secondary.used_percent === "number") {
          const usedPercent = clampPercent(rl.secondary.used_percent);
          windows.push({
            id: "codex-7d",
            label: "7d",
            windowMinutes: Number(rl.secondary.window_minutes || 10080),
            usedPercent,
            remainingPercent: Math.max(0, 100 - usedPercent),
            resetsAt: toIsoTime(rl.secondary.resets_at),
          });
        }
        if (windows.length) {
          return {
            provider: "codex",
            status: "ok",
            source: "session-cache",
            planType: formatPlanLabel(rl.plan_type),
            email: null,
            windows,
            groups: [],
            updatedAt: new Date(file.mtimeMs).toISOString(),
          };
        }
      }
    } catch {}
  }
  return null;
}

export async function probeCodexQuota(codexExe, connector) {
  if (!connector?.installed) {
    return { provider: "codex", status: "not-installed", error: "Chưa cài đặt Codex CLI.", windows: [], groups: [] };
  }
  if (connector.authenticated === false) {
    return { provider: "codex", status: "unauthenticated", error: "Chưa đăng nhập Codex CLI.", windows: [], groups: [] };
  }
  const live = await new Promise((resolvePromise) => {
    let settled = false;
    let child;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch {}
      resolvePromise(value);
    };
    const timer = setTimeout(() => finish(null), 5500);
    timer.unref?.();
    try {
      child = spawn(codexExe, ["app-server"], {
        cwd: homedir(),
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      return finish(null);
    }
    let buf = "";
    let rateLimitsMsg = null;
    let accountMsg = null;
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "account/read", params: { refreshToken: false } })}\n`);
          } else if (msg.id === 2) {
            rateLimitsMsg = msg.result || null;
          } else if (msg.id === 3) {
            accountMsg = msg.result || null;
          }
          if (rateLimitsMsg && accountMsg) {
            const rl = rateLimitsMsg.rateLimits || rateLimitsMsg.rateLimitsByLimitId?.codex || {};
            const windows = [];
            if (rl.primary && typeof rl.primary.usedPercent === "number") {
              const usedPercent = clampPercent(rl.primary.usedPercent);
              windows.push({
                id: "codex-5h",
                label: "5h",
                windowMinutes: Number(rl.primary.windowDurationMins || 300),
                usedPercent,
                remainingPercent: Math.max(0, 100 - usedPercent),
                resetsAt: toIsoTime(rl.primary.resetsAt),
              });
            }
            if (rl.secondary && typeof rl.secondary.usedPercent === "number") {
              const usedPercent = clampPercent(rl.secondary.usedPercent);
              windows.push({
                id: "codex-7d",
                label: "7d",
                windowMinutes: Number(rl.secondary.windowDurationMins || 10080),
                usedPercent,
                remainingPercent: Math.max(0, 100 - usedPercent),
                resetsAt: toIsoTime(rl.secondary.resetsAt),
              });
            }
            finish({
              provider: "codex",
              status: windows.length ? "ok" : "unavailable",
              source: "live",
              planType: formatPlanLabel(rl.planType || accountMsg?.account?.planType),
              email: accountMsg?.account?.email || null,
              windows,
              groups: [],
              credits: rl.credits?.hasCredits ? {
                balance: String(rl.credits.balance || "0"),
                unlimited: Boolean(rl.credits.unlimited),
              } : null,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {}
      }
    });
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "opensybau", version: "0.3.1" } },
      })}\n`);
    } catch {
      finish(null);
    }
  });

  if (live && live.windows?.length) return live;
  const cached = readLatestCodexSessionQuota();
  if (cached) return cached;
  return {
    provider: "codex",
    status: "unavailable",
    error: "Chưa có dữ liệu hạn mức từ Codex CLI.",
    windows: [],
    groups: [],
  };
}

function callAntigravityLsRpc(protocol, port, csrfToken, method) {
  return new Promise((resolvePromise) => {
    const body = JSON.stringify({
      metadata: {
        ideName: "antigravity",
        extensionName: "antigravity",
        locale: "en",
      },
    });
    const mod = protocol === "https" ? https : http;
    const req = mod.request({
      hostname: "127.0.0.1",
      port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: "POST",
      rejectUnauthorized: false,
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrfToken,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 2800,
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolvePromise(null);
        try { resolvePromise(JSON.parse(raw)); } catch { resolvePromise(null); }
      });
    });
    req.on("error", () => resolvePromise(null));
    req.on("timeout", () => { req.destroy(); resolvePromise(null); });
    req.write(body);
    req.end();
  });
}

function discoverRunningAntigravityLs() {
  if (process.platform === "win32") {
    try {
      const ps = spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^language_server' } | Select-Object -First 1 ProcessId, CommandLine; if ($p) { $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort); [pscustomobject]@{ pid = $p.ProcessId; cmd = $p.CommandLine; ports = $ports } | ConvertTo-Json -Compress }",
      ], { encoding: "utf8", windowsHide: true, timeout: 4000 });
      if (ps.status === 0 && ps.stdout?.trim()) {
        const info = JSON.parse(ps.stdout.trim());
        const csrfMatch = String(info.cmd || "").match(/--csrf_token\s+([^\s"]+)/i);
        const ports = Array.isArray(info.ports) ? info.ports.map(Number).filter(Boolean) : [];
        if (csrfMatch?.[1] && ports.length) {
          return { csrfToken: csrfMatch[1], ports };
        }
      }
    } catch {}
    return null;
  }
  try {
    const ps = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8", timeout: 3000 });
    const line = String(ps.stdout || "").split(/\r?\n/).find((item) => /language_server/i.test(item) && /--csrf_token/i.test(item));
    if (!line) return null;
    const pidMatch = line.trim().match(/^(\d+)\s+/);
    const csrfMatch = line.match(/--csrf_token\s+([^\s"]+)/i);
    if (!pidMatch || !csrfMatch) return null;
    const ss = spawnSync("ss", ["-tlnp"], { encoding: "utf8", timeout: 3000 });
    const ports = [];
    for (const sLine of String(ss.stdout || "").split(/\r?\n/)) {
      if (!sLine.includes(`pid=${pidMatch[1]},`)) continue;
      const portMatch = sLine.match(/127\.0\.0\.1:(\d+)/);
      if (portMatch) ports.push(Number(portMatch[1]));
    }
    return ports.length ? { csrfToken: csrfMatch[1], ports } : null;
  } catch {
    return null;
  }
}

function findStandaloneLanguageServerBinary(home = homedir()) {
  const candidates = process.platform === "win32"
    ? [
        resolve(process.env.LOCALAPPDATA || resolve(home, "AppData/Local"), "Programs/antigravity/resources/bin/language_server.exe"),
        resolve(home, "AppData/Local/Programs/antigravity/resources/bin/language_server.exe"),
      ]
    : [
        "/usr/share/antigravity/resources/bin/language_server",
        "/opt/Antigravity/resources/bin/language_server",
        resolve(home, ".local/share/antigravity/resources/bin/language_server"),
      ];
  return candidates.find((p) => existsSync(p)) || "";
}

async function queryStandaloneAntigravityLs() {
  const lsBinary = findStandaloneLanguageServerBinary();
  if (!lsBinary) return null;
  const csrfToken = `opensybau-${randomUUID()}`;
  return new Promise((resolvePromise) => {
    let settled = false;
    let child;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch {}
      resolvePromise(val);
    };
    const timer = setTimeout(() => finish(null), 6500);
    timer.unref?.();
    try {
      child = spawn(lsBinary, [
        "--standalone",
        "--override_ide_name", "antigravity",
        "--subclient_type", "hub",
        "--https_server_port", "0",
        "--csrf_token", csrfToken,
        "--app_data_dir", "antigravity",
        "--api_server_url", "https://generativelanguage.googleapis.com",
        "--cloud_code_endpoint", "https://daily-cloudcode-pa.googleapis.com",
      ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    } catch {
      return finish(null);
    }
    let stderrBuf = "";
    let querying = false;
    child.on("error", () => finish(null));
    child.on("close", () => finish(null));
    child.stderr.on("data", async (chunk) => {
      stderrBuf += chunk.toString();
      if (querying) return;
      const httpPortMatch = stderrBuf.match(/listening on random port at (\d+) for HTTP\b/i);
      if (!httpPortMatch) return;
      querying = true;
      const httpPort = Number(httpPortMatch[1]);
      // Give AuthProvider ~900ms to finish loading local OAuth session
      await new Promise((r) => setTimeout(r, 950));
      const [quotaSummary, userStatus] = await Promise.all([
        callAntigravityLsRpc("http", httpPort, csrfToken, "RetrieveUserQuotaSummary"),
        callAntigravityLsRpc("http", httpPort, csrfToken, "GetUserStatus"),
      ]);
      finish({ quotaSummary, userStatus });
    });
  });
}

function formatAntigravityQuotaPayload(quotaSummary, userStatus) {
  const rawGroups = Array.isArray(quotaSummary?.response?.groups) ? quotaSummary.response.groups : [];
  const groups = rawGroups.map((group) => {
    const buckets = (Array.isArray(group.buckets) ? group.buckets : []).map((bucket) => {
      const remFrac = Number(bucket.remainingFraction);
      const remainingPercent = Number.isFinite(remFrac) ? clampPercent(remFrac * 100) : 0;
      const usedPercent = Math.max(0, 100 - remainingPercent);
      const is5h = String(bucket.window || bucket.bucketId || "").toLowerCase().includes("5h");
      return {
        id: String(bucket.bucketId || bucket.window || "bucket"),
        label: is5h ? "5h" : "7d",
        displayName: String(bucket.displayName || (is5h ? "5h" : "Weekly")),
        window: is5h ? "5h" : "weekly",
        usedPercent,
        remainingPercent,
        resetsAt: toIsoTime(bucket.resetTime),
      };
    }).sort((a, b) => (a.label === "5h" ? -1 : b.label === "5h" ? 1 : 0));
    return {
      name: String(group.displayName || "Models"),
      description: String(group.description || ""),
      windows: buckets,
    };
  }).filter((g) => g.windows.length > 0);

  const primaryGroup = groups[0] || null;
  const uStatus = userStatus?.userStatus || {};
  const planInfo = uStatus?.planStatus?.planInfo || {};
  const userTier = uStatus?.userTier || {};
  return {
    provider: "antigravity",
    status: groups.length ? "ok" : "unavailable",
    source: "live",
    planType: formatPlanLabel(userTier.name || userTier.id || planInfo.planName || planInfo.teamsTier),
    email: uStatus.email || null,
    windows: primaryGroup ? primaryGroup.windows : [],
    groups,
    credits: typeof uStatus?.planStatus?.availablePromptCredits === "number" ? {
      promptAvailable: uStatus.planStatus.availablePromptCredits,
      promptMonthly: planInfo.monthlyPromptCredits || null,
      flowAvailable: uStatus.planStatus.availableFlowCredits ?? null,
    } : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function probeAntigravityQuota(connector) {
  if (!connector?.installed) {
    return { provider: "antigravity", status: "not-installed", error: "Chưa cài đặt Antigravity CLI.", windows: [], groups: [] };
  }
  if (connector.authenticated === false) {
    return { provider: "antigravity", status: "unauthenticated", error: "Chưa đăng nhập Antigravity CLI.", windows: [], groups: [] };
  }
  const runningLs = discoverRunningAntigravityLs();
  if (runningLs) {
    for (const port of runningLs.ports) {
      for (const proto of ["http", "https"]) {
        const [quotaSummary, userStatus] = await Promise.all([
          callAntigravityLsRpc(proto, port, runningLs.csrfToken, "RetrieveUserQuotaSummary"),
          callAntigravityLsRpc(proto, port, runningLs.csrfToken, "GetUserStatus"),
        ]);
        if (quotaSummary?.response?.groups?.length || userStatus?.userStatus) {
          return formatAntigravityQuotaPayload(quotaSummary, userStatus);
        }
      }
    }
  }
  const standaloneResult = await queryStandaloneAntigravityLs();
  if (standaloneResult && (standaloneResult.quotaSummary?.response?.groups?.length || standaloneResult.userStatus?.userStatus)) {
    return formatAntigravityQuotaPayload(standaloneResult.quotaSummary, standaloneResult.userStatus);
  }
  return {
    provider: "antigravity",
    status: "unavailable",
    error: "Chưa đọc được hạn mức trực tiếp từ Antigravity.",
    windows: [],
    groups: [],
  };
}

function fetchAnthropicOauthUsage(accessToken) {
  return new Promise((resolvePromise) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      port: 443,
      path: "/api/oauth/usage",
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
        "User-Agent": "opensybau/0.3.1",
      },
      timeout: 4500,
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolvePromise(null);
        try { resolvePromise(JSON.parse(raw)); } catch { resolvePromise(null); }
      });
    });
    req.on("error", () => resolvePromise(null));
    req.on("timeout", () => { req.destroy(); resolvePromise(null); });
    req.end();
  });
}

export async function probeClaudeQuota(claudeExe, claudeCommand, connector, run, home = homedir()) {
  if (!connector?.installed && !process.env.ANTHROPIC_API_KEY) {
    return { provider: "claude", status: "not-installed", error: "Chưa cài đặt Claude Code CLI.", windows: [], groups: [] };
  }
  const credFiles = [
    resolve(home, ".claude", ".credentials.json"),
    resolve(home, ".claude", "credentials.json"),
  ];
  let oauth = null;
  for (const file of credFiles) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed?.claudeAiOauth?.accessToken) {
        oauth = parsed.claudeAiOauth;
        break;
      }
    } catch {}
  }

  let authInfo = null;
  if (claudeExe && connector?.installed && typeof run === "function") {
    try {
      const res = await run(claudeExe, [...(claudeCommand?.prefixArgs || []), "auth", "status"], { timeout: 4000, maxBuffer: 50_000 });
      if (res.code === 0 && res.stdout?.trim().startsWith("{")) {
        authInfo = JSON.parse(res.stdout.trim());
      }
    } catch {}
  }

  if (oauth?.accessToken) {
    const usageData = await fetchAnthropicOauthUsage(oauth.accessToken);
    if (usageData && (usageData.five_hour || usageData.seven_day)) {
      const windows = [];
      if (usageData.five_hour && typeof usageData.five_hour.utilization === "number") {
        const usedPercent = clampPercent(usageData.five_hour.utilization);
        windows.push({
          id: "claude-5h",
          label: "5h",
          windowMinutes: 300,
          usedPercent,
          remainingPercent: Math.max(0, 100 - usedPercent),
          resetsAt: toIsoTime(usageData.five_hour.resets_at),
        });
      }
      if (usageData.seven_day && typeof usageData.seven_day.utilization === "number") {
        const usedPercent = clampPercent(usageData.seven_day.utilization);
        windows.push({
          id: "claude-7d",
          label: "7d",
          windowMinutes: 10080,
          usedPercent,
          remainingPercent: Math.max(0, 100 - usedPercent),
          resetsAt: toIsoTime(usageData.seven_day.resets_at),
        });
      }
      if (usageData.seven_day_sonnet && typeof usageData.seven_day_sonnet.utilization === "number") {
        const usedPercent = clampPercent(usageData.seven_day_sonnet.utilization);
        windows.push({
          id: "claude-sonnet-7d",
          label: "Sonnet 7d",
          windowMinutes: 10080,
          usedPercent,
          remainingPercent: Math.max(0, 100 - usedPercent),
          resetsAt: toIsoTime(usageData.seven_day_sonnet.resets_at),
        });
      }
      if (usageData.seven_day_opus && typeof usageData.seven_day_opus.utilization === "number") {
        const usedPercent = clampPercent(usageData.seven_day_opus.utilization);
        windows.push({
          id: "claude-opus-7d",
          label: "Opus 7d",
          windowMinutes: 10080,
          usedPercent,
          remainingPercent: Math.max(0, 100 - usedPercent),
          resetsAt: toIsoTime(usageData.seven_day_opus.resets_at),
        });
      }
      return {
        provider: "claude",
        status: windows.length ? "ok" : "unavailable",
        source: "live",
        planType: formatPlanLabel(oauth.subscriptionType || authInfo?.subscriptionType || "Pro"),
        email: authInfo?.email || null,
        windows,
        groups: [],
        updatedAt: new Date().toISOString(),
      };
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "claude",
      status: "api-key",
      planType: "API Key",
      email: authInfo?.email || null,
      error: "Đang dùng khóa ANTHROPIC_API_KEY (tính theo token sử dụng).",
      windows: [],
      groups: [],
    };
  }

  if (connector?.authenticated === false) {
    return {
      provider: "claude",
      status: "unauthenticated",
      error: "Chưa đăng nhập Claude Code CLI.",
      windows: [],
      groups: [],
    };
  }

  return {
    provider: "claude",
    status: "unavailable",
    planType: formatPlanLabel(oauth?.subscriptionType || authInfo?.subscriptionType),
    email: authInfo?.email || null,
    error: "Chưa có dữ liệu hạn mức trực tiếp từ Claude Code.",
    windows: [],
    groups: [],
  };
}

export function createProviderQuotaService({ getCliExecutables, loadModels, run }) {
  let quotaCache = null;
  let quotaCacheUntil = 0;
  let quotaPromise = null;

  async function loadQuotas(force = false) {
    const now = Date.now();
    if (!force && quotaCache && now < quotaCacheUntil) return quotaCache;
    if (quotaPromise) {
      if (!force) return quotaPromise;
      await quotaPromise.catch(() => {});
    }
    quotaPromise = (async () => {
      const connectors = await loadModels(false).catch(() => ({}));
      const { codexExe, claudeExe, claudeCommand } = getCliExecutables();
      const [codex, antigravity, claude] = await Promise.all([
        probeCodexQuota(codexExe, connectors.codex),
        probeAntigravityQuota(connectors.antigravity),
        probeClaudeQuota(claudeExe, claudeCommand, connectors.claude, run),
      ]);
      quotaCache = {
        updatedAt: new Date().toISOString(),
        providers: {
          codex,
          antigravity,
          claude,
        },
      };
      quotaCacheUntil = Date.now() + QUOTA_CACHE_TTL_MS;
      return quotaCache;
    })();
    try {
      return await quotaPromise;
    } finally {
      quotaPromise = null;
    }
  }

  return {
    loadQuotas,
    invalidateQuotaCache: () => {
      quotaCache = null;
      quotaCacheUntil = 0;
    },
  };
}
