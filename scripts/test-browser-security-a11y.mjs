import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { connectCdpPage, launchHeadlessChrome } from "./lib/cdp-harness.mjs";

const parent = resolve(".runtime");
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(join(parent, "browser-qa-"));
const dataDir = join(root, "data");
const repoDir = join(root, "repo");
const vaultDir = join(root, "vault");
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(repoDir, { recursive: true });
await fs.mkdir(vaultDir, { recursive: true });

await fs.writeFile(join(repoDir, "app.js"), "export const hello = 'opensybau';\n");
await fs.writeFile(join(repoDir, "index.html"), "<!doctype html><html><body><h1>Design File</h1></body></html>\n");
execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.email", "test@opensybau.local"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.name", "OpenSybau Test"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore", windowsHide: true });

await fs.writeFile(join(vaultDir, "AlphaNote.md"), "# Alpha Note\nLinked to [[BetaNote]].\n");
await fs.writeFile(join(vaultDir, "BetaNote.md"), "# Beta Note\nReferences [[AlphaNote]].\n");

// Loopback mock dev server for live design viewport switcher check
const designServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body><div id='design-root'>LivePreviewTarget</div></body></html>");
});
await new Promise((ok) => designServer.listen(0, "127.0.0.1", ok));
const designPort = designServer.address().port;

process.env.WORKBENCH_DATA_DIR = dataDir;
process.env.WORKBENCH_HOST = "127.0.0.1";
process.env.WORKBENCH_PORT = "0";
process.env.WORKBENCH_MODE = "production";
process.env.WORKBENCH_ALLOW_NETWORK = "false";
process.env.OPENSYBAU_DESKTOP = "0";

const { startWorkbench, stopWorkbench } = await import("../server.mjs");

let chrome = null;
let page1 = null;
let page2 = null;

async function clickEl(page, selector) {
  const pt = await page.evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.getClientRects().length > 0)
      || document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 && r.height > 0 };
  })()`);
  assert.ok(pt?.ok, `Missing clickable visible element: ${selector}`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
}

try {
  const srv = await startWorkbench();
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  // Register workspace + configure vaultPath + verify HTTP CSP header on /
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200);
  const cspHeader = htmlRes.headers.get("content-security-policy") || "";
  assert.match(cspHeader, /script-src 'self'/, `Production index.html must enforce strict CSP, got: ${cspHeader}`);

  const wsRes = await fetch(`${baseUrl}/api/workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ path: repoDir }),
  });
  assert.equal(wsRes.status, 201);
  const { workspace } = await wsRes.json();

  const setVaultRes = await fetch(`${baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ vaultPath: vaultDir }),
  });
  assert.equal(setVaultRes.status, 200);

  // Seed XSS memory record + duplicate lessons for Dream button + scheduled task for Kanban/CRON
  const xssTitle = `XSS <img src=x onerror="window.__xss=1"> Probe`;
  await fetch(`${baseUrl}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      title: xssTitle,
      content: `<script>window.__xss=2</script><b>escaped</b>`,
      kind: "lesson",
      workspaceId: workspace.id,
    }),
  });
  await fetch(`${baseUrl}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      title: "Dream Lesson Browser",
      content: "Always bundle frontend CSS tokens via Vite build before shipping.",
      kind: "lesson",
      workspaceId: workspace.id,
    }),
  });
  await fetch(`${baseUrl}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      title: "Dream Lesson Browser",
      content: "Make sure you always bundle frontend CSS tokens via Vite build before shipping releases.",
      kind: "lesson",
      workspaceId: workspace.id,
    }),
  });
  await fetch(`${baseUrl}/api/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({
      workspaceId: workspace.id,
      name: "Cron Sanity Job",
      prompt: "Check repo status",
      intervalMinutes: 60,
    }),
  });

  chrome = await launchHeadlessChrome();
  page1 = await connectCdpPage(chrome.firstPageWsUrl, { failFastOnConsoleError: true });
  page2 = await chrome.openNewPage();

  const setupBootScript = `
    window.opensybauDesktop = { isDesktop: true };
    localStorage.setItem('opensybau.setup-v3', 'done');
    localStorage.setItem('opensybau.desktop-setup-v2', 'done');
    localStorage.setItem('opensybau.theme.v2', 'daylight');
  `;
  await page1.send("Page.addScriptToEvaluateOnNewDocument", { source: setupBootScript });
  await page2.send("Page.addScriptToEvaluateOnNewDocument", { source: setupBootScript });
  await page1.setViewport(1440, 900, false);
  await page2.setViewport(1440, 900, false);

  await Promise.all([page1.navigate(baseUrl), page2.navigate(baseUrl)]);
  await page1.waitFor("!!document.querySelector('[data-home-prompt]')");
  await page2.waitFor("!!document.querySelector('[data-home-prompt]')");

  // 1. DOM XSS safety & Multi-Tab SSE sync + Dream Consolidation
  await clickEl(page1, '[data-page="memory"]');
  await clickEl(page2, '[data-page="memory"]');
  await page1.waitFor("document.body.innerText.includes('XSS')");
  await page2.waitFor("document.body.innerText.includes('XSS')");
  assert.equal(await page1.evaluate("window.__xss === undefined"), true, "DOM XSS executed on page 1!");
  assert.equal(await page2.evaluate("window.__xss === undefined"), true, "DOM XSS executed on page 2!");

  // Trigger creation from page 1 via fetch inside page context -> page 2 must sync via SSE without reload
  await page1.evaluate(`fetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'SSE_SYNC_MEMORY_LIVE', content: 'Synced across tabs via SSE', kind: 'lesson' })
  })`);
  await page2.waitFor("document.body.innerText.includes('SSE_SYNC_MEMORY_LIVE')");

  // Click Dream Consolidate button on page 1 -> duplicate lessons merge & page 2 updates
  await clickEl(page1, '[data-action="consolidate-memory-dream"]');
  await page2.waitFor("[...document.querySelectorAll('article.memory-card')].filter(el => el.textContent.includes('Dream Lesson Browser')).length === 1", 6000);
  page1.assertHealthy("xss-sse-dream-p1");
  page2.assertHealthy("xss-sse-dream-p2");

  // 2. Modal Focus Trap + Focus Restore (on Page 1)
  await page1.evaluate(`document.querySelector('[data-action="new-memory"]')?.focus()`);
  await clickEl(page1, '[data-action="new-memory"]');
  await page1.waitFor("!!document.querySelector('.modal[role=\"dialog\"][aria-modal=\"true\"]')");
  for (let i = 0; i < 6; i += 1) {
    await page1.dispatchKey("Tab", "Tab", i % 2 === 1 ? 8 : 0);
    const insideModal = await page1.evaluate("!!document.activeElement?.closest?.('.modal[role=\"dialog\"]')");
    assert.equal(insideModal, true, `Focus escaped modal dialog on Tab step ${i}`);
  }
  await page1.dispatchKey("Escape", "Escape");
  await page1.waitFor("!document.querySelector('.modal[role=\"dialog\"]')");
  const restoredAction = await page1.evaluate("document.activeElement?.dataset?.action || ''");
  assert.equal(restoredAction, "new-memory", "Closing modal via Escape must restore focus to trigger button");

  // 3. IME Composition Guard on Home Composer
  await clickEl(page1, '[data-page="chat"]');
  await page1.waitFor("!!document.querySelector('[data-home-prompt]')");
  const imePreserved = await page1.evaluate(`(() => {
    const ta = document.querySelector('[data-home-prompt]');
    ta.focus();
    ta.value = 'Gõ tiếng Việt đang tổ hợp';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return !ev.defaultPrevented && ta.value === 'Gõ tiếng Việt đang tổ hợp' && !document.querySelector('.chat-thread');
  })()`);
  assert.equal(imePreserved, true, "Enter during IME composition (isComposing / 229) must not submit form");

  // 4. Settings Device Connect Enter Key Dispatch (separate from <form data-form="settings">)
  await clickEl(page1, '[data-page="settings"]');
  await page1.waitFor("!!document.querySelector('[data-section=\"devices\"]')");
  await clickEl(page1, '[data-section="devices"]');
  await page1.waitFor("!!document.querySelector('#settings-devices #remote-access-pass-input')");
  const settingsFormCountBefore = await page1.evaluate("document.querySelectorAll('#settings-devices').length");
  assert.equal(settingsFormCountBefore, 1);
  assert.equal(
    await page1.evaluate("!!document.querySelector('#settings-devices')?.closest('form[data-form=\"settings\"]')"),
    false,
    "#settings-devices must NOT be nested inside <form data-form=\"settings\">",
  );
  await page1.evaluate(`(() => {
    const input = document.querySelector('#settings-devices #remote-access-pass-input');
    input.focus();
    input.value = 'valid-lan-pass-16chars';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page1.dispatchKey("Enter", "Enter");
  await page1.waitFor("document.querySelector('#toast')?.textContent?.includes('Đã lưu mật khẩu') || document.querySelector('#toast')?.textContent?.includes('mở kết nối LAN')", 6000);
  page1.assertHealthy("settings-devices-enter");

  // 5. Tasks Kanban 4-Column View + CRON Filter Chip
  await clickEl(page1, '[data-page="tasks"]');
  await page1.waitFor("!!document.querySelector('[data-action=\"toggle-tasks-kanban\"]')");
  await clickEl(page1, '[data-action="toggle-tasks-kanban"]');
  await page1.waitFor("document.querySelectorAll('.task-kanban-grid > div').length === 4");
  await clickEl(page1, '[data-filter="cron"]');
  await page1.waitFor("document.querySelector('[data-filter=\"cron\"]')?.getAttribute('aria-pressed') === 'true'");

  // 6. Knowledge Graph Keyboard Navigation + Idle RAF Sleep
  await clickEl(page1, '[data-page="knowledge"]');
  await page1.waitFor("!!document.querySelector('[data-action=\"vault-mode\"][data-mode=\"graph\"]')");
  await clickEl(page1, '[data-action="vault-mode"][data-mode="graph"]');
  await page1.waitFor("!!document.querySelector('#vault-neural-canvas')");
  await page1.evaluate("document.querySelector('#vault-neural-canvas')?.focus()");
  await page1.dispatchKey("ArrowRight", "ArrowRight");
  await page1.dispatchKey("+", "Equal");
  await page1.dispatchKey("0", "Digit0");
  await page1.dispatchKey("Enter", "Enter");
  // Allow simulation settle (~2.2s idle) and ensure no errors and zero runaway loop
  await new Promise((r) => setTimeout(r, 2200));
  page1.assertHealthy("knowledge-graph-kdb-idle");

  // 7. TopBar / RightDock Tablist Arrow Nav + Design Proxy / Viewport Switcher (Desktop / 768 / 390)
  await clickEl(page1, '[data-page="workspaces"]');
  await page1.waitFor("!!document.querySelector('[data-action=\"open-workspace\"]')");
  await clickEl(page1, '[data-action="open-workspace"]');
  await page1.waitFor("document.querySelectorAll('.orca-dock-tabs[role=\"tablist\"] [role=\"tab\"]').length >= 2");

  // Test ArrowRight/ArrowLeft keyboard navigation on [role="tablist"]
  const arrowWorked = await page1.evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.orca-dock-tabs[role="tablist"] [role="tab"]')];
    if (tabs.length < 2) return false;
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const moved = document.activeElement === tabs[1];
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const back = document.activeElement === tabs[0];
    return moved && back;
  })()`);
  assert.equal(arrowWorked, true, "ArrowRight / ArrowLeft must cycle focus across [role=\"tablist\"] tabs");

  // Open live design preview tab (on Chat page where Right Dock "terminal" holds Live URL) -> switch Desktop / 768 / 390 viewports + test TopBar role="tab"
  await clickEl(page1, '[data-page="chat"]');
  await page1.waitFor("!!document.querySelector('[data-page=\"chat\"]')");
  const needOpenDock = await page1.evaluate("!document.querySelector('[data-action=\"right-dock-tab\"][data-tab=\"terminal\"]')?.getClientRects?.()?.length");
  if (needOpenDock) {
    await clickEl(page1, '[data-action="toggle-chat-drawer"]');
  }
  await page1.waitFor("!!document.querySelector('[data-action=\"right-dock-tab\"][data-tab=\"terminal\"]')");
  await clickEl(page1, '[data-action="right-dock-tab"][data-tab="terminal"]');
  await page1.waitFor("!!document.querySelector('[data-live-url-input]')");
  await page1.evaluate(`(() => {
    const urlIn = document.querySelector('[data-live-url-input]');
    urlIn.value = ${JSON.stringify(`http://127.0.0.1:${designPort}/`)};
    urlIn.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickEl(page1, '[data-action="open-live-url"]');
  await page1.waitFor("!!document.querySelector('.codex-viewport-group [data-viewport=\"mobile\"]')");

  await clickEl(page1, '.codex-viewport-group [data-viewport="mobile"]');
  await page1.waitFor("!!document.querySelector('.orca-live-frame-wrap.is-vp-mobile')");
  await clickEl(page1, '.codex-viewport-group [data-viewport="tablet"]');
  await page1.waitFor("!!document.querySelector('.orca-live-frame-wrap.is-vp-tablet')");
  await clickEl(page1, '.codex-viewport-group [data-viewport="desktop"]');
  await page1.waitFor("!!document.querySelector('.orca-live-frame-wrap.is-vp-desktop')");

  // Check TopBar stage [role="tablist"] [role="tab"] exists & is keyboard focusable
  const topTabRoleCount = await page1.evaluate("document.querySelectorAll('.orca-tabbar-scroll[role=\"tablist\"] [role=\"tab\"]').length");
  assert.ok(topTabRoleCount >= 1, "TopBar must render accessible [role=\"tab\"] buttons");

  // Settings CLI / Antigravity OAuth warning & Gemini API Key preset check
  await clickEl(page1, '[data-page="settings"]');
  await page1.waitFor("!!document.querySelector('[data-action=\"settings-nav\"][data-section=\"cli\"]')");
  await clickEl(page1, '[data-action="settings-nav"][data-section="cli"]');
  await page1.waitFor("!!document.querySelector('#cli-setup:not([hidden])')");
  const connectorsSnapshot = await fetch(`${baseUrl}/api/connectors`).then((r) => r.json()).catch(() => ({}));
  if (connectorsSnapshot?.antigravity?.installed && connectorsSnapshot?.antigravity?.authMode !== "gemini-api-key") {
    const hasOAuthWarn = await page1.evaluate("Boolean(document.querySelector('#cli-setup .cli-guide-warning') && document.querySelector('#cli-setup [data-action=\"provider-add-gemini\"]'))");
    assert.equal(hasOAuthWarn, true, "Antigravity OAuth CLI row must render Section 6 warning and Gemini API Key shortcut");
    await clickEl(page1, '#cli-setup [data-action="provider-add-gemini"]');
  } else {
    await clickEl(page1, '[data-action="settings-nav"][data-section="api"]');
    await page1.waitFor("!!document.querySelector('#settings-api:not([hidden]) [data-action=\"provider-add\"]')");
    await clickEl(page1, '#settings-api [data-action="provider-add"]');
    await page1.waitFor("!!document.querySelector('#overlay [data-preset=\"gemini\"]')");
    await clickEl(page1, '#overlay [data-preset="gemini"]');
  }
  await page1.waitFor("document.querySelector('#overlay select[name=\"protocol\"]')?.value === 'gemini'");
  await clickEl(page1, '#overlay [data-action="close-modal"]');

  page1.assertHealthy("page1-final");
  page2.assertHealthy("page2-final");
  console.log("test-browser-security-a11y: PASS");
} finally {
  try { page1?.close(); } catch {}
  try { page2?.close(); } catch {}
  await chrome?.close().catch(() => {});
  await stopWorkbench().catch(() => {});
  designServer.closeAllConnections?.();
  await new Promise((ok) => designServer.close(ok)).catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
