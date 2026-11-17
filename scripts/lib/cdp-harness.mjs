import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Could not find Chrome or Chromium executable for headless CDP verification.");
}

export async function launchHeadlessChrome() {
  const exe = findChromeExecutable();
  const profileDir = await mkdtemp(join(tmpdir(), "opensybau-cdp-"));
  const browser = spawn(exe, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  const wsEndpoint = await new Promise((resolve, reject) => {
    let logs = "";
    const timer = setTimeout(() => reject(new Error(`Chrome CDP startup timeout: ${logs}`)), 15_000);
    const onChunk = (chunk) => {
      logs += String(chunk);
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    browser.stderr.on("data", onChunk);
    browser.once("error", (err) => { clearTimeout(timer); reject(err); });
    browser.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code}): ${logs}`)); });
  });

  const versionUrl = wsEndpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "/json/list");
  const pages = await (await fetch(versionUrl)).json();
  let pageTarget = pages.find((t) => t.type === "page") || null;
  if (!pageTarget) {
    const newUrl = wsEndpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "/json/new?about:blank");
    pageTarget = await (await fetch(newUrl, { method: "PUT" })).json();
  }

  return {
    browser,
    profileDir,
    wsEndpoint,
    firstPageWsUrl: pageTarget.webSocketDebuggerUrl,
    async openNewPage() {
      const base = wsEndpoint.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "/json/new?about:blank");
      const target = await (await fetch(base, { method: "PUT" })).json();
      return connectCdpPage(target.webSocketDebuggerUrl);
    },
    async close() {
      try { browser.kill("SIGKILL"); } catch {}
      await new Promise((r) => setTimeout(r, 250));
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function connectCdpPage(wsUrl, { failFastOnConsoleError = true } = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  const consoleErrors = [];
  const server5xxResponses = [];
  const listeners = new Map();

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`CDP error (${entry.method}): ${msg.error.message}`));
      else entry.resolve(msg.result || {});
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "Uncaught exception";
      runtimeErrors.push(desc);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      const text = (msg.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
      consoleErrors.push(text);
    } else if (msg.method === "Network.responseReceived" && Number(msg.params?.response?.status) >= 500) {
      server5xxResponses.push(`${msg.params.response.status} ${msg.params.response.url}`);
    }
    const handlers = listeners.get(msg.method);
    if (handlers) {
      for (const fn of handlers) fn(msg.params);
    }
  });

  function send(method, params = {}, timeoutMs = 15_000) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { method, resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");

  async function evaluate(expression, returnByValue = true) {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || "JS evaluate exception");
    }
    return res.result?.value;
  }

  async function navigate(url) {
    await send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 350));
  }

  async function setViewport(width, height, isMobile = false) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: isMobile,
    });
  }

  function assertHealthy(contextLabel = "page") {
    if (runtimeErrors.length) {
      throw new Error(`[${contextLabel}] Runtime.exceptionThrown detected: ${runtimeErrors.join(" | ")}`);
    }
    if (failFastOnConsoleError && consoleErrors.length) {
      throw new Error(`[${contextLabel}] console.error detected: ${consoleErrors.join(" | ")}`);
    }
    if (server5xxResponses.length) {
      throw new Error(`[${contextLabel}] HTTP >= 500 responses detected: ${server5xxResponses.join(" | ")}`);
    }
  }

  async function waitFor(fnExpr, timeoutMs = 8000, stepMs = 80) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await evaluate(fnExpr).catch(() => false);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    throw new Error(`CDP waitFor timeout after ${timeoutMs}ms: ${fnExpr.slice(0, 120)}`);
  }

  const VIRTUAL_KEYS = { Tab: 9, Enter: 13, Escape: 27, Space: 32, " ": 32, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

  async function dispatchKey(key, code = key, modifiers = 0) {
    const vk = VIRTUAL_KEYS[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    if (key === "Enter") await send("Input.dispatchKeyEvent", { type: "char", text: "\r", modifiers });
    else if (key.length === 1) await send("Input.dispatchKeyEvent", { type: "char", text: key, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  }

  function close() {
    try { ws.close(); } catch {}
  }

  return {
    send,
    evaluate,
    navigate,
    setViewport,
    assertHealthy,
    waitFor,
    dispatchKey,
    runtimeErrors,
    consoleErrors,
    server5xxResponses,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    close,
  };
}
