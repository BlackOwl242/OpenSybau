import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const effortStandard = ["standard"];
const apiCapabilities = { chat: true, plan: true, build: true, review: true };

function findExecutable(name) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [name], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  return (result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find((item) => item && !/\.(?:cmd|bat)$/i.test(item)) || "";
}

export function findClaudeCode() {
  if (process.env.CLAUDE_CLI_PATH) {
    const configured = process.env.CLAUDE_CLI_PATH;
    return configured.toLowerCase().endsWith(".js") ? { executable: process.execPath, prefixArgs: [resolve(configured)] } : { executable: configured, prefixArgs: [] };
  }
  const native = findExecutable(process.platform === "win32" ? "claude.exe" : "claude");
  if (native) return { executable: native, prefixArgs: [] };
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || resolve(process.env.USERPROFILE || process.cwd(), "AppData/Roaming");
    const localAppData = process.env.LOCALAPPDATA || resolve(process.env.USERPROFILE || process.cwd(), "AppData/Local");
    const candidates = [
      resolve(appData, "npm/node_modules/@anthropic-ai/claude-code/cli.js"),
      resolve(localAppData, "npm/node_modules/@anthropic-ai/claude-code/cli.js"),
    ];
    const entry = candidates.find(existsSync);
    if (entry) return { executable: process.execPath, prefixArgs: [entry] };
  }
  return { executable: "", prefixArgs: [] };
}

export function providerLabel(id) {
  return ({ codex: "Codex", antigravity: "Antigravity", claude: "Claude Code", "claude-api": "Claude API" })[id] || id;
}

function endpoint(value, protocol) {
  const url = new URL(String(value || ""));
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("API endpoint must use HTTPS; HTTP is allowed only for localhost.");
  if (url.username || url.password || url.search || url.hash) throw new Error("API endpoint cannot contain credentials, query parameters, or fragments.");
  if (protocol === "anthropic" && !url.pathname.replace(/\/$/, "").endsWith("/v1")) url.pathname = `${url.pathname.replace(/\/$/, "")}/v1`;
  return url.toString().replace(/\/$/, "");
}

function modelList(value) {
  let rows = Array.isArray(value) ? value : String(value || "").split(",");
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { rows = JSON.parse(value); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => typeof item === "string" ? { id: item.trim(), name: item.trim() } : { id: String(item?.id || "").trim(), name: String(item?.name || item?.id || "").trim() })
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item.id)).slice(0, 50);
}

function makeApiDefinition({ id, name, protocol, baseUrl, apiKeyEnv, models, env }) {
  const normalizedModels = modelList(models);
  const apiKey = apiKeyEnv ? String(env[apiKeyEnv] || "") : "";
  let normalizedEndpoint = "";
  let error = "";
  try { normalizedEndpoint = endpoint(baseUrl, protocol); } catch (cause) { error = cause.message; }
  const missing = [!normalizedEndpoint && "endpoint", !normalizedModels.length && "model", apiKeyEnv && !apiKey && `secret ${apiKeyEnv}`].filter(Boolean);
  const configured = !error && Boolean(normalizedEndpoint && normalizedModels.length && (!apiKeyEnv || apiKey));
  return {
    runtime: { id, name, protocol, endpoint: normalizedEndpoint, apiKey, apiKeyEnv, models: normalizedModels },
    connector: {
      name, kind: "api", available: configured, authenticated: apiKeyEnv ? Boolean(apiKey) : null,
      configured, capabilities: { ...apiCapabilities }, models: normalizedModels.map((model) => ({ ...model, efforts: effortStandard })),
      error: error || (missing.length ? `Cần cấu hình ${missing.join(", ")} trong .env rồi khởi động lại OpenSybau.` : null),
      setup: { endpointEnv: null, modelEnv: null, keyEnv: apiKeyEnv || null },
    },
  };
}

export function configuredApiProviders(env = process.env) {
  const providers = [];
  providers.push(makeApiDefinition({
    id: "claude-api", name: "Claude API", protocol: "anthropic",
    baseUrl: env.WORKBENCH_CLAUDE_BASE_URL || "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: env.WORKBENCH_CLAUDE_MODELS || env.WORKBENCH_CLAUDE_MODEL || "",
    env,
  }));

  const raw = String(env.WORKBENCH_API_PROVIDERS || "").trim();
  if (raw) {
    let definitions;
    try { definitions = JSON.parse(raw); } catch { throw new Error("WORKBENCH_API_PROVIDERS must be a JSON array."); }
    if (!Array.isArray(definitions) || definitions.length > 12) throw new Error("WORKBENCH_API_PROVIDERS supports up to 12 provider definitions.");
    const used = new Set(["codex", "antigravity", "claude", "claude-api"]);
    for (const item of definitions) {
      const id = String(item?.id || "").trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) || used.has(id)) throw new Error(`Invalid or reserved external provider id: ${id || "(empty)"}.`);
      used.add(id);
      const protocol = item.protocol === "anthropic" ? "anthropic" : item.protocol === "openai-compatible" ? "openai-compatible" : "";
      if (!protocol) throw new Error(`Provider ${id} must use protocol anthropic or openai-compatible.`);
      const apiKeyEnv = item.apiKeyEnv ? String(item.apiKeyEnv) : "";
      if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyEnv)) throw new Error(`Provider ${id} has an invalid apiKeyEnv name.`);
      providers.push(makeApiDefinition({
        id, name: String(item.name || id).slice(0, 80), protocol, baseUrl: item.baseUrl,
        apiKeyEnv, models: item.models, env,
      }));
    }
  }
  return providers;
}

function apiUrl(provider) {
  if (provider.protocol === "anthropic") return `${provider.endpoint}/messages`;
  if (provider.endpoint.endsWith("/chat/completions")) return provider.endpoint;
  return `${provider.endpoint}${provider.endpoint.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
}

export async function completeWithApi(provider, model, prompt, signal) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  let body;
  if (provider.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
    body = { model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] };
  } else {
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, messages: [{ role: "user", content: prompt }], stream: false };
  }
  const response = await fetch(apiUrl(provider), { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" });
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 2_000_000) throw new Error(`${provider.name} response exceeds the 2 MB limit.`);
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body || []) {
    totalBytes += chunk.byteLength;
    if (totalBytes > 2_000_000) throw new Error(`${provider.name} response exceeds the 2 MB limit.`);
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    let providerMessage = String(data?.error?.message || data?.error?.type || data?.message || "provider rejected the request");
    if (provider.apiKey) providerMessage = providerMessage.split(provider.apiKey).join("[redacted API key]");
    throw new Error(`${provider.name} returned HTTP ${response.status}: ${providerMessage.slice(0, 500)}`);
  }
  const responseContent = data?.choices?.[0]?.message?.content;
  const content = provider.protocol === "anthropic"
    ? (Array.isArray(data?.content) ? data.content : []).filter((item) => item.type === "text").map((item) => item.text || "").join("\n").trim()
    : (typeof responseContent === "string" ? responseContent : Array.isArray(responseContent) ? responseContent.map((item) => item.text || "").join("\n") : "").trim();
  if (!content) throw new Error(`${provider.name} returned no text content.`);
  return { content, usage: data?.usage || null };
}
