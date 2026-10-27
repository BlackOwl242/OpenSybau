const REMOTE_HOSTS_STORAGE_KEY = "opensybau.remote-hosts.v1";
const ACTIVE_HOST_STORAGE_KEY = "opensybau.active-host.v1";

function safeStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeStorageSet(key, value) {
  try {
    if (!value) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {}
}

export function isAndroidApkRuntime() {
  if (typeof globalThis.window === "undefined") return false;
  if (globalThis.window.opensybauAndroid || globalThis.window.Capacitor) return true;
  const ua = String(globalThis.navigator?.userAgent || "");
  if (ua.includes("OpenSybauAndroid") || ua.includes("; wv)")) return true;
  const host = String(globalThis.window.location?.hostname || "").toLowerCase();
  if (host === "appassets.androidplatform.net" || globalThis.window.location?.protocol === "capacitor:" || globalThis.window.location?.protocol === "file:") {
    return true;
  }
  return false;
}

export function isMobileCompanionMode() {
  if (isAndroidApkRuntime()) return true;
  if (typeof globalThis.window === "undefined") return false;
  if (globalThis.window.opensybauDesktop?.isDesktop) return false;
  if (getActiveRemoteHost()?.url) return true;
  return Boolean(globalThis.window.matchMedia?.("(max-width: 820px)")?.matches);
}

export async function remoteFetch(url, options = {}) {
  const targetUrl = String(url || "");
  const bridge = typeof globalThis.window !== "undefined" ? globalThis.window.opensybauAndroid : null;
  if (bridge && typeof bridge.httpRequest === "function" && /^https?:\/\//i.test(targetUrl)) {
    const method = String(options.method || "GET").toUpperCase();
    const headersObj = { ...(options.headers || {}) };
    const bodyStr = typeof options.body === "string" ? options.body : (options.body ? JSON.stringify(options.body) : "");
    const rawResult = bridge.httpRequest(method, targetUrl, JSON.stringify(headersObj), bodyStr);
    let parsed;
    try {
      parsed = JSON.parse(rawResult || "{}");
    } catch {
      parsed = { ok: false, status: 0, error: "Invalid native bridge response" };
    }
    if (!parsed.status) {
      throw new Error(parsed.error || "Network request failed");
    }
    const responseText = String(parsed.body ?? "");
    const etag = String(parsed.etag || "");
    const contentType = String(parsed.contentType || "application/json");
    return {
      ok: Boolean(parsed.ok),
      status: Number(parsed.status),
      headers: {
        get(name) {
          const lower = String(name || "").toLowerCase();
          if (lower === "etag") return etag || null;
          if (lower === "content-type") return contentType || null;
          return null;
        },
      },
      async text() {
        return responseText;
      },
      async json() {
        return responseText ? JSON.parse(responseText) : {};
      },
    };
  }
  return globalThis.fetch(targetUrl, options);
}

export function normalizeRemoteHostUrl(rawUrl) {
  let clean = String(rawUrl || "").trim();
  if (!clean) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(\/.*)?$/.test(clean) || /^localhost(?::\d{2,5})?$/i.test(clean)) {
    clean = `http://${clean}`;
  } else if (!/^https?:\/\//i.test(clean) && /^[a-z0-9.-]+:\d{2,5}$/i.test(clean)) {
    clean = `http://${clean}`;
  }
  const parsed = new URL(clean);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL máy chủ phải bắt đầu bằng http:// hoặc https://");
  }
  if (!parsed.port && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(parsed.hostname)) {
    parsed.port = "4173";
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function encodeBasicAuth(username = "opensybau", password = "") {
  const raw = `${username || "opensybau"}:${password || ""}`;
  if (typeof globalThis.btoa === "function") {
    return `Basic ${globalThis.btoa(unescape(encodeURIComponent(raw)))}`;
  }
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export function parsePairingInput(rawInput) {
  const text = String(rawInput || "").trim();
  if (!text) throw new Error("Nhập mã ghép nối hoặc địa chỉ máy chủ OpenSybau.");

  if (text.toLowerCase().startsWith("opensybau://")) {
    const parsed = new URL(text.replace(/^opensybau:\/\//i, "http://"));
    const hostParam = parsed.searchParams.get("host") || parsed.searchParams.get("url") || "";
    const url = normalizeRemoteHostUrl(hostParam);
    const username = parsed.searchParams.get("user") || parsed.searchParams.get("username") || "opensybau";
    const password = parsed.searchParams.get("pass") || parsed.searchParams.get("password") || parsed.searchParams.get("token") || "";
    const name = parsed.searchParams.get("name") || new URL(url).host;
    return { name, url, username, password };
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    const data = JSON.parse(text);
    const url = normalizeRemoteHostUrl(data.url || data.host || "");
    return {
      name: String(data.name || new URL(url).host),
      url,
      username: String(data.user || data.username || "opensybau"),
      password: String(data.pass || data.password || ""),
    };
  }

  let candidate = text;
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  const parsed = new URL(candidate);
  const username = parsed.username ? decodeURIComponent(parsed.username) : "opensybau";
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";
  parsed.username = "";
  parsed.password = "";
  const url = normalizeRemoteHostUrl(parsed.href);
  return {
    name: parsed.host,
    url,
    username,
    password,
  };
}

export function getSavedRemoteHosts() {
  const raw = safeStorageGet(REMOTE_HOSTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((item) => item && item.url) : [];
  } catch {
    return [];
  }
}

export function saveRemoteHostProfile(profile) {
  const url = normalizeRemoteHostUrl(profile?.url || "");
  if (!url) throw new Error("Địa chỉ URL máy chủ không hợp lệ.");
  const list = getSavedRemoteHosts();
  const existingIdx = list.findIndex((item) => item.id === profile?.id || item.url.toLowerCase() === url.toLowerCase());
  const existing = existingIdx >= 0 ? list[existingIdx] : null;
  const entry = {
    id: existing?.id || profile?.id || `host-${Date.now().toString(36)}`,
    name: String(profile?.name || existing?.name || new URL(url).host).trim().slice(0, 80),
    url,
    username: String(profile?.username ?? existing?.username ?? "opensybau").trim() || "opensybau",
    password: String(profile?.password ?? existing?.password ?? ""),
    hostname: String(profile?.hostname ?? existing?.hostname ?? ""),
    platform: String(profile?.platform ?? existing?.platform ?? ""),
    latencyMs: Number.isFinite(profile?.latencyMs) ? profile.latencyMs : (existing?.latencyMs ?? null),
    lastConnectedAt: profile?.lastConnectedAt || existing?.lastConnectedAt || new Date().toISOString(),
  };
  const next = existingIdx >= 0
    ? list.map((item, idx) => (idx === existingIdx ? entry : item))
    : [entry, ...list].slice(0, 16);
  safeStorageSet(REMOTE_HOSTS_STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export function removeRemoteHostProfile(id) {
  const list = getSavedRemoteHosts().filter((item) => item.id !== id);
  safeStorageSet(REMOTE_HOSTS_STORAGE_KEY, JSON.stringify(list));
  const active = getActiveRemoteHost();
  if (active?.id === id) setActiveRemoteHost(null);
  return list;
}

let cachedActiveHost = undefined;

export function getActiveRemoteHost() {
  if (cachedActiveHost !== undefined) return cachedActiveHost;
  const raw = safeStorageGet(ACTIVE_HOST_STORAGE_KEY);
  if (!raw) {
    cachedActiveHost = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    cachedActiveHost = parsed && parsed.url ? parsed : null;
    return cachedActiveHost;
  } catch {
    cachedActiveHost = null;
    return null;
  }
}

export function setActiveRemoteHost(profileOrNull) {
  if (!profileOrNull || !profileOrNull.url) {
    cachedActiveHost = null;
    safeStorageSet(ACTIVE_HOST_STORAGE_KEY, "");
    return null;
  }
  const saved = saveRemoteHostProfile({
    ...profileOrNull,
    lastConnectedAt: new Date().toISOString(),
  });
  cachedActiveHost = saved;
  safeStorageSet(ACTIVE_HOST_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

export function resolveRemoteUrl(path) {
  const str = String(path || "");
  if (!str.startsWith("/")) return str;
  const active = getActiveRemoteHost();
  if (!active?.url) return str;
  return `${active.url.replace(/\/+$/, "")}${str}`;
}

export function buildRemoteRequestHeaders(extraHeaders = {}, hostOverride = null) {
  const target = hostOverride || getActiveRemoteHost();
  if (!target?.url) return { ...extraHeaders };
  const headers = {
    ...extraHeaders,
    "X-OpenSybau-Client": "android-apk",
  };
  if (target.password) {
    headers.Authorization = encodeBasicAuth(target.username || "opensybau", target.password);
  }
  return headers;
}

export async function probeRemoteHost({ url, username = "opensybau", password = "" } = {}, fetchImpl = remoteFetch) {
  const normalizedUrl = normalizeRemoteHostUrl(url);
  const headers = buildRemoteRequestHeaders({}, { url: normalizedUrl, username, password });
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(`${normalizedUrl}/api/connection-info`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
    if (response.status === 401) {
      return {
        ok: false,
        status: 401,
        latencyMs,
        url: normalizedUrl,
        error: "Máy tính PC yêu cầu mật khẩu kết nối. Hãy nhập đúng mật khẩu hiển thị trong mục Kết nối điện thoại trên PC.",
      };
    }
    if (response.status === 403) {
      const errData = await response.json().catch(() => ({}));
      return {
        ok: false,
        status: 403,
        latencyMs,
        url: normalizedUrl,
        error: errData.error === "Host not allowed"
          ? `Địa chỉ ${new URL(normalizedUrl).host} chưa được cho phép trên máy tính PC.`
          : (errData.error || "Máy tính PC từ chối truy cập (403)."),
      };
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        url: normalizedUrl,
        error: data.error || `Không thể kết nối máy tính PC (${response.status})`,
      };
    }
    return {
      ok: true,
      status: 200,
      latencyMs,
      url: normalizedUrl,
      info: data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: null,
      url: normalizedUrl,
      error: `Không thể kết nối tới ${normalizedUrl}. Kiểm tra máy tính PC đang mở OpenSybau và cùng mạng Wi-Fi / Tailscale (${error?.message || "Network error"}).`,
    };
  }
}

export async function scanLanForOpenSybauHosts({ port = 4173, hintUrl = "" } = {}) {
  const cleanPort = Number(port) > 0 && Number(port) <= 65535 ? Number(port) : 4173;
  const bridge = typeof globalThis.window !== "undefined" ? globalThis.window.opensybauAndroid : null;
  if (bridge && typeof bridge.scanLanHosts === "function") {
    await new Promise((resolve) => setTimeout(resolve, 25));
    try {
      const raw = bridge.scanLanHosts(cleanPort);
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {}
  }

  const subnets = new Set();
  const addSubnetFromHost = (hostValue) => {
    const m = String(hostValue || "").match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
    if (m) subnets.add(m[1]);
  };

  if (bridge && typeof bridge.getDeviceLanInfo === "function") {
    try {
      const info = JSON.parse(bridge.getDeviceLanInfo() || "{}");
      if (info.subnet) subnets.add(String(info.subnet));
    } catch {}
  }
  if (hintUrl) {
    try { addSubnetFromHost(new URL(normalizeRemoteHostUrl(hintUrl)).hostname); } catch {}
  }
  for (const saved of getSavedRemoteHosts()) {
    try { addSubnetFromHost(new URL(saved.url).hostname); } catch {}
  }
  if (typeof globalThis.window !== "undefined") {
    addSubnetFromHost(globalThis.window.location?.hostname || "");
  }
  if (!subnets.size) {
    subnets.add("192.168.1");
    subnets.add("192.168.0");
  }

  const candidateIps = [];
  for (const subnet of [...subnets].slice(0, 2)) {
    for (let i = 1; i <= 254; i++) {
      candidateIps.push(`${subnet}.${i}`);
    }
  }

  const discovered = [];
  const batchSize = 28;
  for (let offset = 0; offset < candidateIps.length; offset += batchSize) {
    const batch = candidateIps.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (ip) => {
      const targetUrl = `http://${ip}:${cleanPort}`;
      try {
        const res = await globalThis.fetch(`${targetUrl}/api/ping`, {
          method: "GET",
          headers: { "X-OpenSybau-Client": "android-apk" },
          cache: "no-store",
          signal: AbortSignal.timeout(750),
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (!data || data.app !== "OpenSybau") return null;
        const hostLabel = String(data.hostname || ip).trim();
        return {
          address: ip,
          port: Number(data.port || cleanPort),
          url: `http://${ip}:${Number(data.port || cleanPort)}`,
          hostname: hostLabel,
          name: hostLabel || `PC (${ip})`,
          platform: String(data.platform || ""),
          authRequired: Boolean(data.authRequired ?? true),
        };
      } catch {
        return null;
      }
    }));
    for (const item of results) {
      if (item) discovered.push(item);
    }
  }
  return discovered;
}
