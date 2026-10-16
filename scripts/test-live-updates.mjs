import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";
import "./test-state-sync.mjs";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL("./test-live-dom.cjs", import.meta.url))], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const timer = setTimeout(() => { child.kill(); process.exitCode = 1; console.error("Live DOM checks timed out."); }, 30_000);
child.once("error", (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.once("exit", (code) => { clearTimeout(timer); process.exitCode = code === 0 ? (process.exitCode || 0) : 1; });
