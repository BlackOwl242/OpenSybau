import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
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

export function isBlockedEndpointHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || host === "0.0.0.0" || host === "::" || host === "metadata.google.internal" || host === "instance-data") return true;
  if (/^(127|0)\./.test(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^(fc|fd|fe80)/i.test(host)) return true;
  if (/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(host)) return true;
  if (host.startsWith("::ffff:") || host.startsWith("0:0:0:0:0:ffff:") || host.includes("a9fe:a9fe")) return true;
  return false;
}

function isLocalLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function assertSafeRemoteEndpoint(targetUrl) {
  const parsed = new URL(String(targetUrl));
  const cleanHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (isLocalLoopbackHostname(cleanHost)) return;
  if (isBlockedEndpointHost(cleanHost)) throw new Error("API endpoint host is blocked for security reasons.");
  if (isIP(cleanHost)) return;
  const records = await lookup(cleanHost, { all: true }).catch(() => []);
  if (!records.length) return;
  for (const rec of records) {
    if (isLocalLoopbackHostname(rec.address) || isBlockedEndpointHost(rec.address)) {
      throw new Error("API endpoint DNS resolves to a private or blocked address.");
    }
  }
}

function endpoint(value, protocol) {
  const url = new URL(String(value || ""));
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  const local = isLocalLoopbackHostname(host);
  if (!local && isBlockedEndpointHost(host)) throw new Error("API endpoint host is blocked for security reasons.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("API endpoint must use HTTPS; HTTP is allowed only for localhost.");
  if (url.username || url.password || url.search || url.hash) throw new Error("API endpoint cannot contain credentials, query parameters, or fragments.");
  const basePath = url.pathname.replace(/\/$/, "");
  if (protocol === "anthropic" && !basePath.endsWith("/v1")) url.pathname = `${basePath}/v1`;
  if (protocol === "gemini" && !/(?:^|\/)v\d+(?:beta\d*|alpha\d*)?$/i.test(basePath)) url.pathname = `${basePath}/v1beta`;
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

export const API_TOOL_DEFINITIONS = [
  {
    name: "list_files",
    description: "List workspace relative file paths, optionally filtered by directory prefix.",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Optional directory prefix relative to workspace root." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read line-numbered contents of a workspace text file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to read." },
        startLine: { type: "integer", description: "1-based start line (default 1)." },
        endLine: { type: "integer", description: "1-based end line (default startLine + 249)." },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Case-insensitive text search across workspace source and config files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search string (minimum 2 characters)." },
        maxResults: { type: "integer", description: "Maximum number of matching lines (1-30)." },
      },
      required: ["query"],
    },
  },
  {
    name: "recall_sessions",
    description: "Search past task runs, decisions, and saved memories in this workspace via FTS5.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords describing what to recall from previous runs." },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_save",
    description: "Save a durable engineering lesson or constraint discovered during this task.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short descriptive title." },
        content: { type: "string", description: "Concise actionable fact or pitfall." },
        kind: { type: "string", description: "One of: lesson, pitfall, pattern, preference." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "propose_skill_patch",
    description: "Propose a reusable workflow skill extracted from solving this task.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill slug name." },
        description: { type: "string", description: "When to trigger the skill." },
        instructions: { type: "string", description: "Step-by-step instructions." },
      },
      required: ["name", "instructions"],
    },
  },
  {
    name: "delegate_subagent",
    description: "Delegate a scoped sub-question or verification check to a tracked subagent.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", description: "Short role label (e.g. Security Auditor, Test Writer)." },
        prompt: { type: "string", description: "Focused read-only investigation or analysis instruction." },
      },
      required: ["role", "prompt"],
    },
  },
];

function hasVersionSegment(pathname = "") {
  return /(?:^|\/)v\d+(?:beta\d*|alpha\d*)?(?:$|\/)/i.test(String(pathname || ""));
}

function apiUrl(provider, { stream = false } = {}) {
  if (provider.protocol === "anthropic") return `${provider.endpoint}/messages`;
  if (provider.protocol === "openai") return `${hasVersionSegment(new URL(provider.endpoint).pathname) ? provider.endpoint : `${provider.endpoint}/v1`}/responses`;
  if (provider.protocol === "gemini") {
    const modelName = encodeURIComponent(String(provider.model || "").replace(/^models\//, ""));
    return stream
      ? `${provider.endpoint}/models/${modelName}:streamGenerateContent?alt=sse`
      : `${provider.endpoint}/models/${modelName}:generateContent`;
  }
  if (provider.endpoint.endsWith("/chat/completions")) return provider.endpoint;
  return `${provider.endpoint}${hasVersionSegment(new URL(provider.endpoint).pathname) ? "" : "/v1"}/chat/completions`;
}

export function normalizeApiUsage(rawUsage, protocol = "") {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  if (protocol === "gemini" || rawUsage.promptTokenCount !== undefined || rawUsage.candidatesTokenCount !== undefined) {
    const input = Number(rawUsage.promptTokenCount || 0);
    const output = Number(rawUsage.candidatesTokenCount || 0);
    const cached = Number(rawUsage.cachedContentTokenCount || 0);
    const total = Number(rawUsage.totalTokenCount || (input + output));
    return {
      input_tokens: input,
      output_tokens: output,
      ...(cached > 0 ? { cached_input_tokens: cached } : {}),
      total_tokens: total,
    };
  }
  const input = Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? 0);
  const output = Number(rawUsage.output_tokens ?? rawUsage.completion_tokens ?? 0);
  const cached = Number(
    rawUsage.cached_input_tokens
    ?? rawUsage.cache_read_input_tokens
    ?? rawUsage.input_tokens_details?.cached_tokens
    ?? rawUsage.prompt_tokens_details?.cached_tokens
    ?? 0,
  );
  const total = Number(rawUsage.total_tokens ?? (input + output));
  return {
    ...rawUsage,
    input_tokens: input,
    output_tokens: output,
    ...(cached > 0 ? { cached_input_tokens: cached } : {}),
    total_tokens: total,
  };
}

function sleepAbortable(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Aborted"));
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    }, ms);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      rejectPromise(signal?.reason || new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryDelayMs(headers, attempt) {
  const retryAfter = String(headers?.get?.("retry-after") || "").trim();
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(15_000, Math.max(250, Math.round(secs * 1000)));
    const targetTs = Date.parse(retryAfter);
    if (Number.isFinite(targetTs)) return Math.min(15_000, Math.max(250, targetTs - Date.now()));
  }
  return Math.min(12_000, 1000 * (2 ** attempt) + Math.floor(Math.random() * 250));
}

function safeJsonParse(raw, fallback = {}) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(String(raw || "{}")); } catch { return fallback; }
}

function buildProtocolPayload(provider, model, requestInput, useStream) {
  const isObj = requestInput && typeof requestInput === "object" && !Array.isArray(requestInput);
  const stablePrefix = isObj ? String(requestInput.stablePrefix || "") : "";
  const dynamicSystem = isObj ? String(requestInput.dynamicSystem || requestInput.systemPrompt || "") : "";
  const rawMessages = isObj && Array.isArray(requestInput.messages) && requestInput.messages.length
    ? requestInput.messages
    : [{ role: "user", content: String(isObj ? (requestInput.prompt || "") : requestInput || "") }];
  const tools = isObj && Array.isArray(requestInput.tools) && requestInput.tools.length ? requestInput.tools : null;
  const fullSystemText = [stablePrefix, dynamicSystem].filter(Boolean).join("\n\n");

  if (provider.protocol === "anthropic") {
    const systemBlocks = [];
    if (stablePrefix) {
      systemBlocks.push(stablePrefix.length >= 256
        ? { type: "text", text: stablePrefix, cache_control: { type: "ephemeral" } }
        : { type: "text", text: stablePrefix });
    }
    if (dynamicSystem) systemBlocks.push({ type: "text", text: dynamicSystem });
    if (!systemBlocks.length && rawMessages.length === 1 && String(rawMessages[0].content || "").length >= 2048) {
      const promptStr = String(rawMessages[0].content || "");
      return {
        model,
        max_tokens: 8192,
        stream: useStream,
        messages: [{ role: "user", content: [{ type: "text", text: promptStr, cache_control: { type: "ephemeral" } }] }],
        ...(tools ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      };
    }

    const anthropicMessages = [];
    for (const msg of rawMessages) {
      if (msg.role === "assistant") {
        const blocks = [];
        if (msg.content) blocks.push({ type: "text", text: String(msg.content) });
        for (const tc of msg.toolCalls || []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || {} });
        }
        anthropicMessages.push({ role: "assistant", content: blocks.length ? blocks : "" });
      } else if (msg.role === "tool") {
        const block = { type: "tool_result", tool_use_id: msg.toolCallId, content: String(msg.output || msg.content || "") };
        const prev = anthropicMessages.at(-1);
        if (prev?.role === "user" && Array.isArray(prev.content) && prev.content[0]?.type === "tool_result") {
          prev.content.push(block);
        } else {
          anthropicMessages.push({ role: "user", content: [block] });
        }
      } else {
        anthropicMessages.push({ role: "user", content: String(msg.content || "") });
      }
    }
    return {
      model,
      max_tokens: 8192,
      ...(systemBlocks.length ? { system: systemBlocks } : {}),
      messages: anthropicMessages,
      ...(tools ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      ...(useStream ? { stream: true } : {}),
    };
  }

  if (provider.protocol === "gemini") {
    const contents = rawMessages.map((msg) => {
      if (msg.role === "assistant") {
        const parts = [];
        if (msg.content) parts.push({ text: String(msg.content) });
        for (const tc of msg.toolCalls || []) {
          parts.push({ functionCall: { name: tc.name, args: tc.args || {} } });
        }
        return { role: "model", parts: parts.length ? parts : [{ text: "" }] };
      }
      if (msg.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: msg.name || "tool", response: { output: String(msg.output || msg.content || "") } } }],
        };
      }
      return { role: "user", parts: [{ text: String(msg.content || "") }] };
    });
    return {
      ...(fullSystemText ? { systemInstruction: { parts: [{ text: fullSystemText }] } } : {}),
      contents,
      ...(tools ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
    };
  }

  if (provider.protocol === "openai") {
    const inputItems = [];
    for (const msg of rawMessages) {
      if (msg.role === "tool") {
        inputItems.push({ type: "function_call_output", call_id: msg.toolCallId, output: String(msg.output || msg.content || "") });
      } else if (msg.role === "assistant") {
        if (msg.content) inputItems.push({ role: "assistant", content: String(msg.content) });
        for (const tc of msg.toolCalls || []) {
          inputItems.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args || {}) });
        }
      } else {
        inputItems.push({ role: "user", content: String(msg.content || "") });
      }
    }
    return {
      model,
      ...(fullSystemText ? { instructions: fullSystemText } : {}),
      input: !isObj ? String(requestInput || "") : inputItems,
      ...(tools ? { tools: tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters })) } : {}),
      ...(useStream ? { stream: true } : {}),
    };
  }

  const chatMessages = [];
  if (fullSystemText) chatMessages.push({ role: "system", content: fullSystemText });
  for (const msg of rawMessages) {
    if (msg.role === "assistant") {
      chatMessages.push({
        role: "assistant",
        content: msg.content || null,
        ...(msg.toolCalls?.length ? {
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) },
          })),
        } : {}),
      });
    } else if (msg.role === "tool") {
      chatMessages.push({ role: "tool", tool_call_id: msg.toolCallId, content: String(msg.output || msg.content || "") });
    } else {
      chatMessages.push({ role: "user", content: String(msg.content || "") });
    }
  }
  return {
    model,
    messages: chatMessages,
    ...(tools ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    stream: useStream,
  };
}

function extractParsedResponse(provider, data) {
  const toolCalls = [];
  let content = "";
  if (provider.protocol === "anthropic") {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const texts = [];
    for (const block of blocks) {
      if (block?.type === "text") texts.push(block.text || "");
      else if (block?.type === "tool_use" && block.name) {
        toolCalls.push({ id: block.id || `tc_${toolCalls.length + 1}`, name: block.name, args: block.input && typeof block.input === "object" ? block.input : {} });
      }
    }
    content = texts.join("\n").trim();
  } else if (provider.protocol === "gemini") {
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    const texts = [];
    for (const part of parts) {
      if (part?.text) texts.push(part.text);
      else if (part?.functionCall?.name) {
        toolCalls.push({
          id: `gem_${toolCalls.length + 1}`,
          name: part.functionCall.name,
          args: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {},
        });
      }
    }
    content = texts.join("\n").trim();
  } else if (provider.protocol === "openai") {
    if (typeof data?.output_text === "string" && data.output_text) content = data.output_text.trim();
    const outItems = Array.isArray(data?.output) ? data.output : [];
    const texts = [];
    for (const item of outItems) {
      if (item?.type === "function_call" && item.name) {
        toolCalls.push({ id: item.call_id || item.id || `oai_${toolCalls.length + 1}`, name: item.name, args: safeJsonParse(item.arguments, {}) });
      } else if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" || c?.type === "text") texts.push(c.text || "");
        }
      }
    }
    if (!content) content = texts.join("\n").trim();
  } else {
    const msg = data?.choices?.[0]?.message;
    const rc = msg?.content;
    content = (typeof rc === "string" ? rc : Array.isArray(rc) ? rc.map((item) => item.text || "").join("\n") : "").trim();
    for (const tc of Array.isArray(msg?.tool_calls) ? msg.tool_calls : []) {
      const fnName = tc?.function?.name || tc?.name;
      if (fnName) {
        toolCalls.push({ id: tc.id || `compat_${toolCalls.length + 1}`, name: fnName, args: safeJsonParse(tc?.function?.arguments ?? tc?.arguments, {}) });
      }
    }
  }
  const usage = normalizeApiUsage(data?.usage || data?.usageMetadata || null, provider.protocol);
  return { content, toolCalls, usage };
}

async function consumeSseResponse(provider, response, onDelta) {
  let content = "";
  let usage = null;
  const toolCallsByIndex = new Map();
  let anthropicCurrentBlock = null;
  let sseBuffer = "";
  let totalBytes = 0;

  const processEventData = (rawData) => {
    const line = String(rawData || "").trim();
    if (!line || line === "[DONE]") return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }

    if (provider.protocol === "anthropic") {
      if (ev.type === "message_start" && ev.message?.usage) {
        usage = normalizeApiUsage(ev.message.usage, "anthropic");
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        anthropicCurrentBlock = { index: ev.index ?? 0, id: ev.content_block.id || `tc_${ev.index ?? 0}`, name: ev.content_block.name, rawArgs: "" };
        toolCallsByIndex.set(anthropicCurrentBlock.index, anthropicCurrentBlock);
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          content += ev.delta.text;
          onDelta?.(ev.delta.text);
        } else if (ev.delta?.type === "input_json_delta" && ev.delta.partial_json && anthropicCurrentBlock) {
          anthropicCurrentBlock.rawArgs += ev.delta.partial_json;
        }
      } else if (ev.type === "message_delta" && ev.usage) {
        const merged = { ...(usage || {}), ...ev.usage };
        usage = normalizeApiUsage(merged, "anthropic");
      }
      return;
    }

    if (provider.protocol === "gemini") {
      const parts = Array.isArray(ev?.candidates?.[0]?.content?.parts) ? ev.candidates[0].content.parts : [];
      for (const p of parts) {
        if (p?.text) {
          content += p.text;
          onDelta?.(p.text);
        } else if (p?.functionCall?.name) {
          const idx = toolCallsByIndex.size;
          toolCallsByIndex.set(idx, { id: `gem_${idx + 1}`, name: p.functionCall.name, args: p.functionCall.args || {} });
        }
      }
      if (ev?.usageMetadata) usage = normalizeApiUsage(ev.usageMetadata, "gemini");
      return;
    }

    if (provider.protocol === "openai") {
      if (ev.type === "response.output_text.delta" && ev.delta) {
        content += ev.delta;
        onDelta?.(ev.delta);
      } else if (ev.type === "response.output_item.added" && ev.item?.type === "function_call") {
        const idx = ev.output_index ?? toolCallsByIndex.size;
        toolCallsByIndex.set(idx, { id: ev.item.call_id || ev.item.id || `oai_${idx + 1}`, name: ev.item.name || "", rawArgs: ev.item.arguments || "" });
      } else if (ev.type === "response.function_call_arguments.delta") {
        const tc = toolCallsByIndex.get(ev.output_index ?? 0);
        if (tc && ev.delta) tc.rawArgs += ev.delta;
      } else if (ev.type === "response.completed" && ev.response) {
        const parsed = extractParsedResponse(provider, ev.response);
        if (!content && parsed.content) content = parsed.content;
        if (!toolCallsByIndex.size && parsed.toolCalls.length) {
          parsed.toolCalls.forEach((tc, idx) => toolCallsByIndex.set(idx, { id: tc.id, name: tc.name, args: tc.args }));
        }
        if (parsed.usage) usage = parsed.usage;
      }
      return;
    }

    // OpenAI-compatible Chat Completions SSE
    const delta = ev?.choices?.[0]?.delta;
    if (typeof delta?.content === "string" && delta.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index ?? 0;
        const entry = toolCallsByIndex.get(idx) || { id: tcDelta.id || `compat_${idx + 1}`, name: "", rawArgs: "" };
        if (tcDelta.id) entry.id = tcDelta.id;
        if (tcDelta.function?.name) entry.name += tcDelta.function.name;
        if (tcDelta.function?.arguments) entry.rawArgs += tcDelta.function.arguments;
        toolCallsByIndex.set(idx, entry);
      }
    }
    if (ev?.usage) usage = normalizeApiUsage(ev.usage, "openai-compatible");
  };

  for await (const chunk of response.body || []) {
    totalBytes += chunk.byteLength;
    if (totalBytes > 4_000_000) throw new Error(`${provider.name} response exceeds the 4 MB limit.`);
    sseBuffer += Buffer.from(chunk).toString("utf8");
    const lines = sseBuffer.split(/\r?\n/);
    sseBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data:")) processEventData(line.slice(5));
    }
  }
  if (sseBuffer.startsWith("data:")) processEventData(sseBuffer.slice(5));

  const toolCalls = [...toolCallsByIndex.values()]
    .filter((tc) => tc.name)
    .map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args || safeJsonParse(tc.rawArgs, {}),
    }));
  return { content: content.trim(), toolCalls, usage };
}

export async function completeWithApi(provider, model, promptOrRequest, signal) {
  const isObj = promptOrRequest && typeof promptOrRequest === "object" && !Array.isArray(promptOrRequest);
  const onDelta = isObj && typeof promptOrRequest.onDelta === "function" ? promptOrRequest.onDelta : null;
  const wantStream = Boolean(isObj && (promptOrRequest.stream || onDelta));
  const targetUrl = apiUrl({ ...provider, model }, { stream: wantStream });
  await assertSafeRemoteEndpoint(targetUrl);

  const headers = {
    "Content-Type": "application/json",
    Accept: wantStream ? "text/event-stream, application/json" : "application/json",
  };
  if (provider.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-beta"] = "prompt-caching-2024-07-31";
    if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
  } else if (provider.protocol === "gemini") {
    headers["x-goog-api-key"] = provider.apiKey;
  } else if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const payload = buildProtocolPayload(provider, model, promptOrRequest, wantStream);
  const bodyJson = JSON.stringify(payload);
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    try {
      response = await fetch(targetUrl, { method: "POST", headers, body: bodyJson, signal, redirect: "error" });
    } catch (networkErr) {
      if (signal?.aborted || attempt >= maxRetries) throw networkErr;
      await sleepAbortable(parseRetryDelayMs(null, attempt), signal);
      continue;
    }

    if ([429, 502, 503, 529].includes(response.status) && attempt < maxRetries) {
      await response.body?.cancel?.().catch(() => {});
      await sleepAbortable(parseRetryDelayMs(response.headers, attempt), signal);
      continue;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (response.ok && wantStream && contentType.includes("text/event-stream")) {
      const streamed = await consumeSseResponse(provider, response, onDelta);
      if (!streamed.content && !streamed.toolCalls.length) {
        throw new Error(`${provider.name} returned an empty stream response.`);
      }
      return streamed;
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 4_000_000) throw new Error(`${provider.name} response exceeds the 4 MB limit.`);
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body || []) {
      totalBytes += chunk.byteLength;
      if (totalBytes > 4_000_000) throw new Error(`${provider.name} response exceeds the 4 MB limit.`);
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const data = safeJsonParse(raw, null);
    if (!response.ok) {
      let providerMessage = String(data?.error?.message || data?.error?.type || data?.message || raw.slice(0, 240) || "provider rejected the request");
      if (provider.apiKey) providerMessage = providerMessage.split(provider.apiKey).join("[redacted API key]");
      const err = new Error(`${provider.name} returned HTTP ${response.status}: ${providerMessage.slice(0, 500)}`);
      err.statusCode = response.status;
      err.errorCode = String(data?.error?.code || data?.error?.type || "");
      throw err;
    }
    const parsed = extractParsedResponse(provider, data || {});
    if (!parsed.content && !parsed.toolCalls.length) {
      throw new Error(`${provider.name} returned no text content.`);
    }
    return parsed;
  }
}

export async function listProviderModels(provider) {
  const url = new URL(provider.endpoint);
  await assertSafeRemoteEndpoint(url.toString());
  const basePath = url.pathname.replace(/\/+$/, "");
  const versionedPath = ["openai", "openai-compatible"].includes(provider.protocol) && !hasVersionSegment(basePath) ? `${basePath}/v1` : basePath;
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
