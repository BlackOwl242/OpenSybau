import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const effortStandard = ["standard"];
const apiCapabilities = { chat: true, plan: true, build: true, review: true };

const executableCache = new Map();
const EXECUTABLE_CACHE_TTL_MS = 60_000;

export function clearExecutableCache() {
  executableCache.clear();
}

function findExecutable(name) {
  const now = Date.now();
  const cached = executableCache.get(name);
  if (cached && now < cached.until) return cached.value;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [name], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  const value = (result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find((item) => item && !/\.(?:cmd|bat)$/i.test(item)) || "";
  executableCache.set(name, { value, until: now + EXECUTABLE_CACHE_TTL_MS });
  return value;
}

export function findClaudeCode({ env = process.env, platform = process.platform, home = homedir(), fileExists = existsSync } = {}) {
  if (env.CLAUDE_CLI_PATH) {
    const configured = env.CLAUDE_CLI_PATH;
    return configured.toLowerCase().endsWith(".js") ? { executable: process.execPath, prefixArgs: [resolve(configured)] } : { executable: configured, prefixArgs: [] };
  }
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const appData = env.APPDATA || resolve(profile, "AppData/Roaming");
    const localAppData = env.LOCALAPPDATA || resolve(profile, "AppData/Local");
    const candidates = [
      resolve(profile, ".local/bin/claude.exe"),
      resolve(profile, ".claude/local/claude.exe"),
      resolve(profile, ".claude/bin/claude.exe"),
      resolve(localAppData, "Programs/claude/claude.exe"),
      resolve(localAppData, "Claude/claude.exe"),
      resolve(appData, "npm/node_modules/@anthropic-ai/claude-code/cli.js"),
      resolve(localAppData, "npm/node_modules/@anthropic-ai/claude-code/cli.js"),
    ];
    const installed = candidates.find(fileExists);
    if (installed) return installed.toLowerCase().endsWith(".js")
      ? { executable: process.execPath, prefixArgs: [installed] }
      : { executable: installed, prefixArgs: [] };
  }
  if (platform === "linux") {
    const local = resolve(home, ".local/bin/claude");
    if (fileExists(local)) return { executable: local, prefixArgs: [] };
  }
  const native = findExecutable(platform === "win32" ? "claude.exe" : "claude");
  if (native) return { executable: native, prefixArgs: [] };
  return { executable: "", prefixArgs: [] };
}

export function providerLabel(id) {
  return ({ codex: "Codex", antigravity: "Antigravity", claude: "Claude Code", "claude-api": "Claude API", openai: "OpenAI API", gemini: "Google Gemini API" })[id] || id;
}

function isBlockedEndpointHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "0.0.0.0" || host === "::" || host === "metadata.google.internal" || host === "instance-data") return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

function endpoint(value, protocol) {
  const url = new URL(String(value || ""));
  const host = url.hostname.toLowerCase();
  if (isBlockedEndpointHost(host)) throw new Error("API endpoint host is blocked for security reasons.");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("API endpoint must use HTTPS; HTTP is allowed only for localhost.");
  if (url.username || url.password || url.search || url.hash) throw new Error("API endpoint cannot contain credentials, query parameters, or fragments.");
  const basePath = url.pathname.replace(/\/$/, "");
  if (protocol === "anthropic" && !basePath.endsWith("/v1")) url.pathname = `${basePath}/v1`;
  if (protocol === "gemini" && !basePath.endsWith("/v1beta")) url.pathname = `${basePath}/v1beta`;
  return url.toString().replace(/\/$/, "");
}

function modelList(value) {
  let rows = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { rows = JSON.parse(value); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => typeof item === "string" ? { id: item.trim(), name: item.trim() } : { id: String(item?.id || "").trim(), name: String(item?.name || item?.id || "").trim() })
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item.id)).slice(0, 50);
}

function makeApiDefinition({ id, name, protocol, baseUrl, apiKeyEnv, apiKeyValue, apiKeyRequired, models, env }) {
  const normalizedModels = modelList(models);
  const apiKey = apiKeyValue !== undefined ? String(apiKeyValue || "") : apiKeyEnv ? String(env[apiKeyEnv] || "") : "";
  let normalizedEndpoint = "";
  let error = "";
  try { normalizedEndpoint = endpoint(baseUrl, protocol); } catch (cause) { error = cause.message; }
  const remote = normalizedEndpoint ? !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(normalizedEndpoint).hostname.toLowerCase()) : false;
  const keyRequired = apiKeyRequired ?? Boolean(apiKeyEnv);
  const missing = [!normalizedEndpoint && "endpoint", !normalizedModels.length && "model", keyRequired && !apiKey && (apiKeyEnv ? `secret ${apiKeyEnv}` : "API key")].filter(Boolean);
  const configured = !error && Boolean(normalizedEndpoint && normalizedModels.length && (!keyRequired || apiKey));
  return {
    runtime: { id, name, protocol, endpoint: normalizedEndpoint, apiKey, apiKeyEnv, apiKeyRequired: keyRequired, models: normalizedModels },
    connector: {
      name, kind: "api", available: configured, authenticated: apiKeyEnv ? Boolean(apiKey) : null,
      configured, keyConfigured: Boolean(apiKey), remote, capabilities: { ...apiCapabilities }, models: normalizedModels.map((model) => ({ ...model, efforts: effortStandard })),
      error: error || (missing.length ? apiKeyEnv ? `Cần cấu hình ${missing.join(", ")} trong .env rồi khởi động lại OpenSybau.` : `Cần cấu hình ${missing.join(", ")} trong phần Provider và API.` : null),
      setup: { endpointEnv: null, modelEnv: null, keyEnv: apiKeyEnv || null },
    },
  };
}

export function normalizeUserApiProvider(input = {}) {
  const id = String(input.id || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) || ["codex", "antigravity", "claude"].includes(id)) {
    throw new Error("ID provider phải gồm 2–40 ký tự chữ thường, số hoặc dấu gạch ngang; không dùng ID có sẵn.");
  }
  const name = String(input.name || "").trim();
  if (!name || name.length > 80) throw new Error("Tên provider phải có từ 1 đến 80 ký tự.");
  const protocol = ["openai", "gemini", "anthropic", "openai-compatible"].includes(input.protocol) ? input.protocol : "";
  if (!protocol) throw new Error("Chọn OpenAI Responses, Google Gemini, Anthropic hoặc OpenAI-compatible.");
  const baseUrl = endpoint(String(input.baseUrl || "").trim(), protocol);
  const localEndpoint = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(baseUrl).hostname.toLowerCase());
  const apiKeyRequired = typeof input.apiKeyRequired === "boolean" ? input.apiKeyRequired : !localEndpoint;
  const rawModels = input.models;
  const models = modelList(rawModels);
  const rawCount = Array.isArray(rawModels) ? rawModels.length : String(rawModels || "").split(/[\n,]/).filter((item) => item.trim()).length;
  if ((!models.length && !input.allowIncomplete) || models.length !== rawCount) throw new Error("Khai báo ít nhất một model ID hợp lệ; mỗi dòng một model.");
  const apiKey = String(input.apiKey || "");
  if (apiKey.length > 2048 || /[\r\n\0]/.test(apiKey)) throw new Error("API key không hợp lệ.");
  return { id, name, protocol, baseUrl, models, apiKey, apiKeyRequired };
}

export function configuredApiProviders(env = process.env, managedProviders = []) {
  const providers = [];
  const managedIds = new Set(managedProviders.map((item) => String(item?.id || "").trim().toLowerCase()));
  const claudeBaseUrl = env.WORKBENCH_CLAUDE_BASE_URL || "https://api.anthropic.com/v1";
  const claudeModels = env.WORKBENCH_CLAUDE_MODELS || env.WORKBENCH_CLAUDE_MODEL || "";
  const hasClaudeEnvironmentConfig = Boolean(env.ANTHROPIC_API_KEY || env.WORKBENCH_CLAUDE_BASE_URL || claudeModels);
  if (hasClaudeEnvironmentConfig && !managedIds.has("claude-api")) {
    providers.push(makeApiDefinition({
      id: "claude-api", name: "Claude API", protocol: "anthropic",
      baseUrl: claudeBaseUrl,
      apiKeyEnv: "ANTHROPIC_API_KEY",
      models: claudeModels,
      env,
    }));
  }

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
      const protocol = ["openai", "gemini", "anthropic", "openai-compatible"].includes(item.protocol) ? item.protocol : "";
      if (!protocol) throw new Error(`Provider ${id} must use protocol openai, gemini, anthropic or openai-compatible.`);
      const apiKeyEnv = item.apiKeyEnv ? String(item.apiKeyEnv) : "";
      if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyEnv)) throw new Error(`Provider ${id} has an invalid apiKeyEnv name.`);
      if (managedIds.has(id)) continue;
      providers.push(makeApiDefinition({
        id, name: String(item.name || id).slice(0, 80), protocol, baseUrl: item.baseUrl,
        apiKeyEnv, models: item.models, env,
      }));
    }
  }
  for (const item of managedProviders) {
    const id = String(item?.id || "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) || providers.some((provider) => provider.runtime.id === id)) throw new Error(`Invalid or duplicate saved provider id: ${id || "(empty)"}.`);
    const normalized = normalizeUserApiProvider({ ...item, apiKey: item.apiKey || "", allowIncomplete: true });
    providers.push(makeApiDefinition({
      id: normalized.id, name: normalized.name, protocol: normalized.protocol, baseUrl: normalized.baseUrl,
      apiKeyEnv: "", apiKeyValue: normalized.apiKey, apiKeyRequired: normalized.apiKeyRequired,
      models: normalized.models, env: {},
    }));
  }
  return providers;
}

function apiUrl(provider) {
  if (provider.protocol === "anthropic") return `${provider.endpoint}/messages`;
  if (provider.protocol === "openai") return `${provider.endpoint.endsWith("/v1") ? provider.endpoint : `${provider.endpoint}/v1`}/responses`;
  if (provider.protocol === "gemini") return `${provider.endpoint}/models/${encodeURIComponent(String(provider.model || "").replace(/^models\//, ""))}:generateContent`;
  if (provider.endpoint.endsWith("/chat/completions")) return provider.endpoint;
  return `${provider.endpoint}${provider.endpoint.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
}

export async function completeWithApi(provider, model, prompt, signal) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  let body;
  if (provider.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
    const contentPayload = prompt.length >= 2048
      ? [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }]
      : prompt;
    body = { model, max_tokens: 8192, messages: [{ role: "user", content: contentPayload }] };
  } else if (provider.protocol === "gemini") {
    headers["x-goog-api-key"] = provider.apiKey;
    body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  } else if (provider.protocol === "openai") {
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, input: prompt };
  } else {
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    body = { model, messages: [{ role: "user", content: prompt }], stream: false };
  }
  const response = await fetch(apiUrl({ ...provider, model }), { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" });
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
    : provider.protocol === "gemini"
      ? (Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : []).map((item) => item.text || "").join("\n").trim()
      : provider.protocol === "openai"
        ? (typeof data?.output_text === "string" ? data.output_text : (Array.isArray(data?.output) ? data.output.flatMap((item) => item.content || []).filter((item) => item.type === "output_text" || item.type === "text").map((item) => item.text || "").join("\n") : "")).trim()
        : (typeof responseContent === "string" ? responseContent : Array.isArray(responseContent) ? responseContent.map((item) => item.text || "").join("\n") : "").trim();
  if (!content) throw new Error(`${provider.name} returned no text content.`);
  return { content, usage: data?.usage || data?.usageMetadata || null };
}

export async function listProviderModels(provider) {
  const url = new URL(provider.endpoint);
  const basePath = url.pathname.replace(/\/+$/, "");
  const versionedPath = ["openai", "openai-compatible"].includes(provider.protocol) && !basePath.endsWith("/v1") ? `${basePath}/v1` : basePath;
  url.pathname = `${versionedPath}/models`;
  const headers = { Accept: "application/json" };
  if (provider.apiKey) {
    if (provider.protocol === "anthropic") headers["x-api-key"] = provider.apiKey;
    else if (provider.protocol === "gemini") headers["x-goog-api-key"] = provider.apiKey;
    else headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: "error" });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 1_000_000) throw new Error("Danh sách model từ endpoint vượt quá 1 MB.");
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body || []) {
      totalBytes += chunk.byteLength;
      if (totalBytes > 1_000_000) throw new Error("Danh sách model từ endpoint vượt quá 1 MB.");
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!response.ok) {
      let message = String(data?.error?.message || data?.message || "endpoint từ chối yêu cầu");
      if (provider.apiKey) message = message.split(provider.apiKey).join("[redacted API key]");
      throw new Error(`${provider.name} trả HTTP ${response.status}: ${message.slice(0, 300)}`);
    }
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    const supportedRows = provider.protocol === "gemini" ? rows.filter((item) => (item?.supportedGenerationMethods || []).includes("generateContent")) : rows;
    const models = supportedRows.map((item) => {
      const modelId = String(item?.id || item?.name || "").trim().replace(/^models\//, "");
      return { id: modelId, name: String(item?.displayName || item?.display_name || modelId).trim() };
    })
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item.id)).slice(0, 50);
    if (!models.length) throw new Error("Endpoint không trả danh sách model hợp lệ. Bạn có thể nhập model ID thủ công.");
    return models;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${provider.name} không phản hồi trong 12 giây.`);
    throw error;
  } finally { clearTimeout(timeout); }
}
