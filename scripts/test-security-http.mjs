import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { isBlockedEndpointHost } from "../src/server/provider-registry.mjs";

const PASSWORD = "opensybau-http-sec-test-16";
const AUTH_HEADER = "Basic " + Buffer.from(`opensybau:${PASSWORD}`).toString("base64");
const parent = resolve(".runtime");
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(join(parent, "security-http-"));
const dataDir = join(root, "data");
const repoDir = join(root, "repo");
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(repoDir, { recursive: true });

await fs.writeFile(join(repoDir, "index.html"), "<!doctype html><html><head><title>App</title></head><body><main>Hello</main></body></html>\n");
await fs.writeFile(join(repoDir, "deleted-note.txt"), "HEAD_DELETED_SNAPSHOT_OK\n");
await fs.writeFile(join(repoDir, "sample.bin"), Buffer.alloc(1024, 0x41));
await fs.writeFile(join(repoDir, "utf8.txt"), "Khởi tạo\n");
await fs.writeFile(join(repoDir, "large-put.txt"), "init\n");

execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.email", "test@opensybau.local"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["config", "user.name", "OpenSybau Test"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore", windowsHide: true });
execFileSync("git", ["commit", "-m", "initial commit"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
await fs.unlink(join(repoDir, "deleted-note.txt"));

// Loopback design dev-server mock for /api/design-proxy/:port/*
const mockDesignServer = createServer((req, res) => {
  if (req.url === "/style.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    res.end("body { color: #111; }");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'; script-src 'self'",
  });
  res.end("<!doctype html><html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><main>MockDesignTarget</main></body></html>");
});
await new Promise((ok) => mockDesignServer.listen(0, "127.0.0.1", ok));
const mockDesignPort = mockDesignServer.address().port;

let child = null;
let base = "";

async function startServer(extraEnv = {}) {
  let stderr = "";
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WORKBENCH_DATA_DIR: dataDir,
      WORKBENCH_HOST: "127.0.0.1",
      WORKBENCH_PORT: "0",
      WORKBENCH_MODE: "production",
      WORKBENCH_ALLOW_NETWORK: "false",
      WORKBENCH_ACCESS_USERNAME: "opensybau",
      WORKBENCH_ACCESS_PASSWORD: PASSWORD,
      OPENSYBAU_DESKTOP: "0",
      ...extraEnv,
    },
  });
  proc.stderr.on("data", (d) => { stderr += d.toString(); });
  base = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`Server timeout: ${stderr.slice(-800)}`)), 20000);
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/OpenSybau ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`Server exited early (${code}): ${stderr.slice(-800)}`));
    });
  });
  child = proc;
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((ok) => child.once("exit", ok));
  child.kill();
  await closed;
  child = null;
}

async function authFetch(path, options = {}) {
  const headers = {
    Authorization: AUTH_HEADER,
    Origin: base,
    ...(options.headers || {}),
  };
  return globalThis.fetch(`${base}${path}`, { ...options, headers });
}

try {
  // 1. SSRF checks (pure host checks)
  for (const blocked of ["127.0.0.2", "0.0.0.0", "169.254.169.254", "[::ffff:169.254.169.254]", "metadata.google.internal", "10.0.0.8", "192.168.1.10"]) {
    assert.equal(isBlockedEndpointHost(blocked), true, `Expected blocked host: ${blocked}`);
  }
  assert.equal(isBlockedEndpointHost("api.openai.com"), false);
  assert.equal(isBlockedEndpointHost("generativelanguage.googleapis.com"), false);

  await startServer();

  // Register test workspace
  const regRes = await authFetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoDir }),
  });
  assert.equal(regRes.status, 201);
  const { workspace } = await regRes.json();

  // 2. Scoped media tokens vs raw password query param rejection
  const rawPassState = await globalThis.fetch(`${base}/api/state?access_token=${encodeURIComponent(PASSWORD)}`);
  assert.equal(rawPassState.status, 401, "Raw password in query must be rejected");
  const rawPassMedia = await globalThis.fetch(`${base}/api/workspaces/${workspace.id}/raw/index.html?access_token=${encodeURIComponent(PASSWORD)}`);
  assert.equal(rawPassMedia.status, 401, "Raw password in media ?access_token= must be rejected");

  const tokenRes = await authFetch(`/api/auth/media-token?workspaceId=${encodeURIComponent(workspace.id)}`);
  assert.equal(tokenRes.status, 200);
  const tokenJson = await tokenRes.json();
  assert.ok(tokenJson.accessToken && tokenJson.streamToken && tokenJson.expiresInSec >= 60);

  // Scoped media token works for target workspace /raw/
  const mediaOk = await globalThis.fetch(`${base}/api/workspaces/${workspace.id}/raw/index.html?access_token=${encodeURIComponent(tokenJson.accessToken)}`);
  assert.equal(mediaOk.status, 200);
  const mediaCsp = mediaOk.headers.get("content-security-policy") || "";
  assert.ok(!mediaCsp.includes("allow-same-origin"), `Unexpected allow-same-origin in CSP: ${mediaCsp}`);
  assert.ok(!mediaCsp.includes("allow-modals"), `Unexpected allow-modals in CSP: ${mediaCsp}`);
  assert.ok(!mediaCsp.includes("unsafe-eval"), `Unexpected unsafe-eval in CSP: ${mediaCsp}`);
  const mediaBody = await mediaOk.text();
  assert.match(mediaBody, /data-orca-inspector/i);

  // Scoped media token CANNOT access /api/state or another workspace ID
  const stateWithMediaToken = await globalThis.fetch(`${base}/api/state?access_token=${encodeURIComponent(tokenJson.accessToken)}`);
  assert.equal(stateWithMediaToken.status, 401);
  const wrongWsRes = await globalThis.fetch(`${base}/api/workspaces/other-ws-id/raw/index.html?access_token=${encodeURIComponent(tokenJson.accessToken)}`);
  assert.equal(wrongWsRes.status, 401);

  // 3. HTTP 206 Byte-Range streaming + 416 out-of-range
  const rangeRes = await authFetch(`/api/workspaces/${workspace.id}/raw/sample.bin`, {
    headers: { Range: "bytes=0-63" },
  });
  assert.equal(rangeRes.status, 206);
  assert.equal(rangeRes.headers.get("content-range"), "bytes 0-63/1024");
  assert.equal((await rangeRes.arrayBuffer()).byteLength, 64);

  const badRange = await authFetch(`/api/workspaces/${workspace.id}/raw/sample.bin`, {
    headers: { Range: "bytes=2048-4096" },
  });
  assert.equal(badRange.status, 416);

  // 4. Git Deleted HEAD fallback on GET /file
  const deletedRes = await authFetch(`/api/workspaces/${workspace.id}/file?path=deleted-note.txt`);
  assert.equal(deletedRes.status, 200);
  const deletedJson = await deletedRes.json();
  assert.equal(deletedJson.deleted, true);
  assert.equal(deletedJson.content, "HEAD_DELETED_SNAPSHOT_OK\n");

  const missingRes = await authFetch(`/api/workspaces/${workspace.id}/file?path=does-not-exist-anywhere.txt`);
  assert.equal(missingRes.status, 404);

  // 5. readBody: multi-byte >80KB UTF-8 + 1.8MB PUT /file, >2.5MB -> 413, non-JSON -> 415
  const utf8Chunk = "Tiếng Việt đa byte 🚀 kiểm tra chuẩn UTF-8 — ".repeat(1600);
  assert.ok(Buffer.byteLength(utf8Chunk, "utf8") > 80_000);
  const putUtf8 = await authFetch(`/api/workspaces/${workspace.id}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "utf8.txt", content: utf8Chunk }),
  });
  assert.equal(putUtf8.status, 200);
  assert.equal(await fs.readFile(join(repoDir, "utf8.txt"), "utf8"), utf8Chunk);

  const largeAscii = "Z".repeat(1_750_000);
  const putLarge = await authFetch(`/api/workspaces/${workspace.id}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "large-put.txt", content: largeAscii }),
  });
  assert.equal(putLarge.status, 200);
  assert.equal((await fs.readFile(join(repoDir, "large-put.txt"), "utf8")).length, 1_750_000);

  const overLimit = await authFetch(`/api/workspaces/${workspace.id}/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "huge.txt", content: "X".repeat(2_600_000) }),
  });
  assert.equal(overLimit.status, 413);

  const wrongMime = await authFetch(`/api/workspaces/${workspace.id}/file`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: "plain text",
  });
  assert.equal(wrongMime.status, 415);

  // 6. Cross-Origin Design Proxy + invalid port guard + unreachable upstream
  const proxyRes = await globalThis.fetch(`${base}/api/design-proxy/${mockDesignPort}/index.html?access_token=${encodeURIComponent(tokenJson.streamToken)}`);
  assert.equal(proxyRes.status, 200);
  assert.equal(proxyRes.headers.get("x-frame-options"), null);
  const proxyCsp = proxyRes.headers.get("content-security-policy") || "";
  assert.ok(!proxyCsp.includes("frame-ancestors 'none'"), "Upstream frame-ancestors 'none' must be replaced");
  assert.ok(proxyCsp.includes("frame-ancestors 'self'"), "Design proxy must permit same-origin framing");
  const proxyHtml = await proxyRes.text();
  assert.ok(proxyHtml.includes(`<base href="/api/design-proxy/${mockDesignPort}/">`), "Missing rewritten <base> tag");
  assert.ok(proxyHtml.includes("MockDesignTarget"), "Missing upstream HTML");
  assert.ok(proxyHtml.includes("data-orca-inspector"), "Missing injected inspector script");

  const privPort = await authFetch("/api/design-proxy/80/index.html");
  assert.ok([400, 404].includes(privPort.status), `Expected 400 or 404 for port 80, got ${privPort.status}`);
  const badPort = await authFetch("/api/design-proxy/70000/index.html");
  assert.equal(badPort.status, 400);
  const closedPort = await authFetch("/api/design-proxy/49999/index.html");
  assert.equal(closedPort.status, 502);

  // 7. Memory Dream Consolidation preserving USER.md & pinned items
  const memPayloads = [
    { title: "Personal Rule", content: "Always reply concisely in Vietnamese.", kind: "user-profile", pinned: false },
    { title: "Pinned Convention", content: "Never commit .env secrets.", kind: "pitfall", pinned: true, workspaceId: workspace.id },
    { title: "Build Pitfall Rule", content: "Run npm run build before packaging dist artifacts for Vite bundle verification", kind: "lesson", pinned: false, workspaceId: workspace.id },
    { title: "build-pitfall-rule", content: "Always run npm run build before packaging dist artifacts for Vite bundle verification checks", kind: "lesson", pinned: false, workspaceId: workspace.id },
  ];
  for (const m of memPayloads) {
    const r = await authFetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(m),
    });
    assert.equal(r.status, 201);
  }
  const dreamRes = await authFetch("/api/memory/consolidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: workspace.id }),
  });
  assert.equal(dreamRes.status, 200);
  const dreamJson = await dreamRes.json();
  assert.equal(dreamJson.ok, true);
  assert.ok(dreamJson.merged >= 1, `Expected duplicate lessons to merge, got merged=${dreamJson.merged}`);
  assert.ok(dreamJson.memories.some((m) => m.kind === "user-profile"), "USER.md profile must never be pruned");
  assert.ok(dreamJson.memories.some((m) => m.pinned), "Pinned memory must never be pruned");

  // 8. MCP disabled by default on HTTP, OTLP traces loopback ingest
  const mcpDisabled = await authFetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  assert.equal(mcpDisabled.status, 403);

  const otelRes = await authFetch("/api/otel/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: "abcd1234",
            spanId: "span1",
            name: "gen_ai.chat",
            startTimeUnixNano: String(Date.now() * 1_000_000),
            endTimeUnixNano: String((Date.now() + 50) * 1_000_000),
            attributes: [{ key: "gen_ai.request.model", value: { stringValue: "gpt-5.4" } }],
          }],
        }],
      }],
    }),
  });
  assert.equal(otelRes.status, 200);
  const otelJson = await otelRes.json();
  assert.equal(otelJson.accepted, 1);

  // 9. Crash persistence recovery + detail.json hydration on restart
  await stopServer();
  const statePath = join(dataDir, "state.json");
  const savedState = JSON.parse(await fs.readFile(statePath, "utf8"));
  const crashTaskId = "crash-recovery-task-1";
  const nowIso = new Date().toISOString();
  savedState.tasks.unshift({
    id: crashTaskId,
    code: "TASK-CRASH",
    title: "Crash Recovery Task",
    workspaceId: workspace.id,
    workspacePath: repoDir,
    status: "running",
    workflow: "chat-only",
    createdAt: nowIso,
    updatedAt: nowIso,
    cycles: [],
    checkpoints: [],
    telemetrySpans: [],
  });
  await fs.writeFile(statePath, JSON.stringify(savedState, null, 2));
  const detailDir = join(dataDir, "tasks", crashTaskId);
  await fs.mkdir(detailDir, { recursive: true });
  await fs.writeFile(join(detailDir, "detail.json"), JSON.stringify({
    id: crashTaskId,
    cycles: [{ id: "cyc-1", stage: "build", status: "done" }],
    checkpoints: [{ id: "cp-1", label: "Before edit", sha: "deadbeef", at: nowIso }],
    telemetrySpans: [{ id: "sp-1", name: "gen_ai.build", durationMs: 42 }],
    updatedAt: nowIso,
  }, null, 2));

  await startServer();
  const recoveredState = await (await authFetch("/api/state")).json();
  const recoveredTask = recoveredState.tasks.find((t) => t.id === crashTaskId);
  assert.ok(recoveredTask, "Recovered task must exist in /api/state");
  assert.equal(recoveredTask.status, "failed", "Interrupted running task must fail cleanly on boot");
  assert.equal(recoveredTask.cycles?.length, 1, "cycles must rehydrate from detail.json");
  assert.equal(recoveredTask.checkpoints?.length, 1, "checkpoints must rehydrate from detail.json");
  assert.equal(recoveredTask.telemetrySpans?.length, 1, "telemetrySpans must rehydrate from detail.json");

  console.log("test-security-http: PASS");
} finally {
  await stopServer().catch(() => {});
  await new Promise((ok) => mockDesignServer.close(ok)).catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
