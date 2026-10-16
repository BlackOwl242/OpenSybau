import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import config from "../vite.config.js";

const prefix = join(tmpdir(), "opensybau-watch-");
const directory = await mkdtemp(prefix);
let server;
try {
  for (const folder of [".runtime/worktrees/task", "release", "dist"]) await mkdir(join(directory, folder), { recursive: true });
  const source = join(directory, "source.js");
  await writeFile(source, "export const count = 1;");
  server = await createServer({
    configFile: false,
    root: directory,
    server: { middlewareMode: true, watch: config.server.watch },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await delay(300);
  const seen = [];
  server.watcher.on("all", (_type, file) => seen.push(file.replaceAll("\\", "/")));
  await writeFile(source, "export const count = 2;");
  for (const folder of [".runtime/worktrees/task", "release", "dist"]) await writeFile(join(directory, folder, "generated.html"), "<p>Agent output</p>");
  const until = Date.now() + 5000;
  while (!seen.some((file) => file.endsWith("/source.js")) && Date.now() < until) await delay(100);
  assert.ok(seen.some((file) => file.endsWith("/source.js")), "Real source edits must remain watchable.");
  await delay(300);
  assert.equal(seen.some((file) => file.endsWith("/generated.html")), false, "Generated HTML must not trigger a Vite reload.");
  console.log("Development watcher checks passed: source changes observed, runtime/worktree and package output ignored.");
} finally {
  await server?.close();
  if (!resolve(directory).startsWith(resolve(prefix))) throw new Error("Unexpected test directory");
  await rm(directory, { recursive: true, force: true });
}
