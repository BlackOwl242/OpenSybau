import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { within } from "../src/server/fs-security.mjs";
import { resolveCompanionPreviewUrl } from "../src/shared/remote-host.js";

const baseDir = resolve(".runtime");
await fs.mkdir(baseDir, { recursive: true });
const testDir = await fs.mkdtemp(join(baseDir, "workbench-e2e-"));
const workspace = join(testDir, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(join(workspace, "index.js"), "export const answer = 42;\n");

// Initialize a clean local Git repository inside temp workspace so Git worktree & schedule features work
execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.email", "test@opensybau.local"], { cwd: workspace, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.name", "OpenSybau Test"], { cwd: workspace, stdio: "ignore", windowsHide: true });
execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore", windowsHide: true });
execFileSync("git", ["commit", "-m", "init"], { cwd: workspace, stdio: "ignore", windowsHide: true });

process.env.WORKBENCH_DATA_DIR = join(testDir, "data");
process.env.WORKBENCH_HOST = "127.0.0.1";
process.env.WORKBENCH_PORT = "0";
process.env.WORKBENCH_MODE = "production";
process.env.WORKBENCH_ALLOW_NETWORK = "false";

const { startWorkbench, stopWorkbench } = await import("../server.mjs");
let chrome;
let ws;

try {
  const server = await startWorkbench();
  const url = `http://127.0.0.1:${server.port}`;

  const regRes = await fetch(`${url}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify({ path: workspace }),
  });
  assert.equal(regRes.status, 201, "Workspace registration failed");

  chrome = spawn(
    process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(testDir, "chrome")}`,
      "about:blank",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
  );

  const debugWsUrl = await new Promise((ok, fail) => {
    let log = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not start within 15s")), 15000);
    chrome.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        ok(match[1]);
      }
    });
    chrome.once("error", fail);
  });

  const tabs = await (await fetch(`http://${new URL(debugWsUrl).host}/json`)).json();
  ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", fail, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    const p = pending.get(data.id);
    if (p) {
      pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
    }
  });

  const cdp = (method, params = {}) =>
    new Promise((resolveCdp, rejectCdp) => {
      const id = ++seq;
      pending.set(id, { resolve: resolveCdp, reject: rejectCdp });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evalJs = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description || expression}`);
    }
    return r.result.value;
  };

  const waitFor = async (expression, label = expression) => {
    for (let i = 0; i < 240; i++) {
      if (await evalJs(expression)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  };

  const click = async (selector) => {
    const box = await evalJs(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.getClientRects().length > 0)
        || document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: Boolean(hit === el || el.contains(hit)), outer: hit?.outerHTML?.slice(0, 140) || "" };
    })()`);
    assert.ok(box?.hit, `Click target not hit for ${selector}: ${JSON.stringify(box)}`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  };

  await cdp("Page.enable");

  // =========================================================================
  // 1. Desktop Host Verification (1440x900)
  // =========================================================================
  const desktopDocScript = await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.opensybauDesktop = { isDesktop: true };
      localStorage.setItem('opensybau.setup-v3', 'done');
      localStorage.setItem('opensybau.desktop-setup-v2', 'done');
      localStorage.setItem('opensybau.theme.v2', 'daylight');
    `,
  });
  await cdp("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    platform: "Win32",
  });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url });
  await waitFor(
    "!!document.querySelector('[data-home-prompt]') && (!document.querySelector('.wb-boot-splash') || Number(getComputedStyle(document.querySelector('.wb-boot-splash')).opacity) < 0.01)",
    "Desktop home boot"
  );

  const desktopAudit = await evalJs(`(() => {
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const rgb = (bodyBg.match(/\\d+/g) || []).map(Number);
    const clipIds = [...document.querySelectorAll('clipPath[id]')].map((n) => n.id);
    const toastZ = Number(getComputedStyle(document.querySelector('#toast')).zIndex || 0);
    return {
      scheme: document.documentElement.dataset.wbScheme || document.documentElement.dataset.colorScheme,
      rgb,
      overflowX: htmlStyle.overflowX,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      uniqueClipIds: new Set(clipIds).size === clipIds.length,
      clipCount: clipIds.length,
      toastZ,
      isMobileCompanion: document.documentElement.classList.contains('mobile-companion'),
    };
  })()`);
  assert.equal(desktopAudit.scheme, "light", "Pre-paint daylight theme should set light scheme");
  assert.ok(desktopAudit.rgb[0] > 220 && desktopAudit.rgb[1] > 220, `Light theme background should be bright, got ${desktopAudit.rgb}`);
  assert.equal(desktopAudit.overflowX, "clip", "html overflow-x must be clip");
  assert.ok(desktopAudit.scrollWidth <= desktopAudit.innerWidth + 1, `Horizontal overflow: ${desktopAudit.scrollWidth} > ${desktopAudit.innerWidth}`);
  assert.equal(desktopAudit.uniqueClipIds, true, "Duplicate BrandLogo <clipPath id> detected");
  assert.ok(desktopAudit.clipCount >= 2, "BrandLogo SVG should render in chrome and nav rail");
  assert.ok(desktopAudit.toastZ >= 800, `#toast z-index (${desktopAudit.toastZ}) must sit above #overlay modal (700)`);
  assert.equal(desktopAudit.isMobileCompanion, false);
  console.log("  [PASS] E2E-01 · Pre-paint Daylight theme, BrandLogo unique clipPaths, z-index scale & overflow-x: clip");

  // 2. Zero-Jump Skill Picker & Composer Draft Preservation
  await evalJs(`(() => {
    const ta = document.querySelector('[data-home-prompt]');
    ta.value = 'Kiểm tra giữ nháp không nhảy trang';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(".home-composer .composer-add > summary");
  await waitFor("!!document.querySelector('.home-composer .composer-add[open]')", "composer + menu open");
  await click('[data-action="open-skill-picker"]');
  await waitFor("!!document.querySelector('[data-skill-picker-root]')", "Skill picker modal open");
  assert.equal(await evalJs("document.querySelector('[data-home-prompt]')?.value"), "Kiểm tra giữ nháp không nhảy trang");
  assert.equal(await evalJs("window.__opensybauHandleBack()"), true);
  await waitFor("!document.querySelector('.modal[role=dialog]')", "Skill picker closed via HandleBack");
  assert.equal(await evalJs("document.querySelector('[data-home-prompt]')?.value"), "Kiểm tra giữ nháp không nhảy trang");
  console.log("  [PASS] E2E-02 · In-place Skill Picker modal preserves composer draft & closes via __opensybauHandleBack");

  // 3. Tier-1 USER.md Memory Creation & PATCH /api/memory/:id Pinning
  await click('[data-page="memory"]');
  await waitFor("!!document.querySelector('[data-action=\"new-memory\"]')", "Memory page loaded");
  await click('[data-action="new-memory"]');
  await waitFor("!!document.querySelector('form[data-form=\"memory\"]')", "New memory modal open");
  await evalJs(`(() => {
    const form = document.querySelector('form[data-form="memory"]');
    form.querySelector('[name="title"]').value = 'Quy tắc chuẩn kiến trúc E2E';
    const kindInput = form.querySelector('[name="kind"]');
    if (kindInput) kindInput.value = 'user-profile';
    form.querySelector('[name="content"]').value = 'Luôn sử dụng argument array khi gọi CLI.';
    const pinBox = form.querySelector('[name="pinned"]');
    if (pinBox) pinBox.checked = true;
    form.requestSubmit();
  })()`);
  await waitFor("!document.querySelector('.modal[role=dialog]') && !!document.querySelector('[data-action=\"toggle-pin-memory\"]')", "Memory saved in-place");
  const memPinResBefore = await (await fetch(`${url}/api/state`)).json();
  const createdMem = memPinResBefore.memories?.find((m) => m.title === "Quy tắc chuẩn kiến trúc E2E");
  assert.ok(createdMem, "Memory record should exist in state");
  assert.equal(createdMem.kind, "user-profile");
  assert.equal(Boolean(createdMem.pinned), true);
  await click(`[data-action="toggle-pin-memory"][data-id="${createdMem.id}"]`);
  await waitFor(
    `(async () => { const s = await (await fetch('/api/state')).json(); const m = s.memories.find(x => x.id === ${JSON.stringify(createdMem.id)}); return m && m.pinned === false; })()`,
    "PATCH /api/memory/:id unpinned"
  );
  console.log("  [PASS] E2E-03 · Tier-1 USER.md memory creation & PATCH /api/memory/:id pin toggle");

  // 4. Ctrl+K Global FTS5 Search & Command Palette
  await click('[data-action="open-command-palette"]');
  await waitFor("!!document.querySelector('[data-command-palette-input]')", "Command palette open");
  await evalJs(`(() => {
    const input = document.querySelector('[data-command-palette-input]');
    input.value = 'argument array';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(
    "document.querySelector('.cmd-palette-results')?.textContent?.includes('Quy tắc chuẩn kiến trúc E2E')",
    "FTS5 live search hit in Command Palette"
  );
  assert.equal(await evalJs("window.__opensybauHandleBack()"), true);
  await waitFor("!document.querySelector('[data-command-palette-input]')", "Command palette closed via HandleBack");
  console.log("  [PASS] E2E-04 · Ctrl+K Global FTS5 Search (/api/search) & Command Palette live results");

  // 5. Scheduled Worktree Automations CRUD (/api/schedules)
  await click('[data-page="tasks"]');
  await waitFor("!!document.querySelector('[data-action=\"open-schedules-modal\"]')", "Tasks page schedules trigger");
  await click('[data-action="open-schedules-modal"]');
  await waitFor("!!document.querySelector('form[data-form=\"schedule-save\"]')", "Schedules modal open");
  await evalJs(`(() => {
    const form = document.querySelector('form[data-form="schedule-save"]');
    form.querySelector('[name="name"]').value = 'Kiểm tra định kỳ buổi sáng';
    form.querySelector('[name="prompt"]').value = 'Chạy kiểm tra trạng thái dự án và báo cáo ngắn gọn.';
    form.requestSubmit();
  })()`);
  await waitFor("!!document.querySelector('.schedule-item-row [data-action=\"toggle-schedule\"]')", "Schedule row rendered on Tasks page");
  await click('.schedule-item-row [data-action="toggle-schedule"]');
  await waitFor("!!document.querySelector('.schedule-item-row.is-paused')", "Schedule toggled to paused");
  console.log("  [PASS] E2E-05 · Scheduled Git Worktree Automations modal & live toggle (/api/schedules)");

  // 6. Settings LAN Pairing Password Masking & Input Preservation (L6)
  await click('[data-page="settings"]');
  await waitFor("!!document.querySelector('[data-section=\"devices\"]')", "Settings page loaded");
  await click('[data-section="devices"]');
  await waitFor("!!document.querySelector('#remote-access-pass-input')", "Devices pairing section visible");
  assert.equal(await evalJs("document.querySelector('#remote-access-pass-input')?.type"), "password");
  await evalJs(`(() => {
    const allowInput = document.querySelector('#remote-host-allowlist-input');
    if (allowInput) {
      allowInput.value = '192.168.1.99:4173';
      allowInput.dispatchEvent(new Event('input', { bubbles: true }));
      allowInput.blur();
    }
  })()`);
  await click('[data-action="toggle-pass-visibility"]');
  await waitFor("document.querySelector('#remote-access-pass-input')?.type === 'text'", "Password eye toggle reveals text");
  assert.equal(await evalJs("document.querySelector('#remote-host-allowlist-input')?.value"), "192.168.1.99:4173", "Unfocused allowlist input preserved across re-render");
  console.log("  [PASS] E2E-06 · LAN pairing password masking, eye toggle & unfocused input preservation across re-renders");

  // =========================================================================
  // 7. Mobile Companion Separation, Default Theme/Worktree, Escape & Landscape
  // =========================================================================
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: desktopDocScript.identifier });
  await cdp("Page.navigate", { url: "about:blank" });
  await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.removeItem('opensybau.theme.v2');
      localStorage.removeItem('opensybau.theme');
      localStorage.setItem('opensybau.setup-v3', 'done');
      localStorage.setItem('opensybau.desktop-setup-v2', 'done');
    `,
  });
  await cdp("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    platform: "Android",
  });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp("Page.navigate", { url: `${url}/#/chat` });
  await waitFor(
    "document.documentElement.classList.contains('mobile-companion') && !!document.querySelector('.mp-orca-header') && !!document.querySelector('.mp-home-companion')",
    "Mobile Companion Home boot"
  );

  const mobileAudit = await evalJs(`(() => {
    const winChrome = document.querySelector('.wb-window-chrome');
    const orcaHeader = document.querySelector('.mp-orca-header');
    return {
      theme: document.documentElement.dataset.wbTheme || document.documentElement.dataset.theme,
      winChromeDisplay: winChrome ? getComputedStyle(winChrome).display : 'none',
      orcaHeaderVisible: Boolean(orcaHeader && orcaHeader.getClientRects().length > 0),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  })()`);
  assert.equal(mobileAudit.theme, "obsidian", "Fresh mobile profile must default to obsidian, not pure-black carbon-oled");
  assert.equal(mobileAudit.winChromeDisplay, "none", "Desktop WindowChrome must be hidden on Mobile Companion");
  assert.equal(mobileAudit.orcaHeaderVisible, true, "Single consolidated MobileOrcaHeader must be visible");
  assert.ok(mobileAudit.scrollWidth <= mobileAudit.innerWidth + 1, `Mobile scrollWidth overflow: ${mobileAudit.scrollWidth}`);

  // Mobile Worktrees trap escape check
  if (await evalJs("!!document.querySelector('[data-action=\"mp-open-worktrees\"]')")) {
    await click('[data-action="mp-open-worktrees"]');
    await waitFor("!document.querySelector('.mp-home-companion') || !!document.querySelector('.mp-worktree-screen, [data-mp-wl-search]')", "Mobile worktrees opened");
    await click('.wb-mobile-nav [data-page="chat"]');
    await waitFor("!!document.querySelector('.mp-home-companion')", "MobileNav Chat tab escaped Worktrees back to Home");
  }

  // Landscape Mobile (844x390) persistence check
  await cdp("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await evalJs("window.dispatchEvent(new Event('resize'))");
  const landscapeMobile = await evalJs(`(() => ({
    hasMobileClass: document.documentElement.classList.contains('mobile-companion'),
    orcaHeaderVisible: Boolean(document.querySelector('.mp-orca-header')?.getClientRects().length),
  }))()`);
  assert.equal(landscapeMobile.hasMobileClass, true, "Landscape Android must retain html.mobile-companion");
  assert.equal(landscapeMobile.orcaHeaderVisible, true, "Landscape Android must keep MobileOrcaHeader visible (>740px)");

  // Mobile Companion hides PC-local folder buttons
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await click('.wb-mobile-nav [data-page="workspaces"]');
  await waitFor("!!document.querySelector('.wb-mobile-nav [data-page=\"workspaces\"][aria-current=\"page\"]')", "Mobile workspaces page");
  const pcLocalButtonsOnMobile = await evalJs(
    "document.querySelectorAll('[data-action=\"open-folder\"], [data-action=\"open-project-folder\"], [data-action=\"provider-cli-login\"]').length"
  );
  assert.equal(pcLocalButtonsOnMobile, 0, "PC-only local OS window buttons must not appear on Mobile Companion");

  // Unit check for resolveCompanionPreviewUrl helper
  assert.equal(typeof resolveCompanionPreviewUrl, "function");
  console.log("  [PASS] E2E-07 · Mobile Companion separation, Obsidian default, Worktrees escape, 844x390 Landscape & hidden PC-only actions");

  console.log("=== ALL 7/7 WORKBENCH COMPREHENSIVE E2E SCENARIOS PASSED ===");
} finally {
  try { ws?.close(); } catch {}
  try { chrome?.stderr?.destroy(); } catch {}
  if (chrome?.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      try { chrome.kill("SIGKILL"); } catch {}
    }
  }
  await stopWorkbench();
  assert.ok(within(baseDir, testDir) && testDir !== baseDir);
  await fs.rm(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
