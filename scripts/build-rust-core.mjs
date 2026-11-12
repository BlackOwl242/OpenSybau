import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const crateDir = resolve(rootDir, "native/opensybau-core");

function buildRustEnv() {
  const extraPaths = [];
  const cargoBin = resolve(homedir(), ".cargo", "bin");
  if (existsSync(cargoBin)) extraPaths.push(cargoBin);

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const wingetPkgs = resolve(process.env.LOCALAPPDATA, "Microsoft/WinGet/Packages");
    if (existsSync(wingetPkgs)) {
      for (const entry of readdirSync(wingetPkgs)) {
        if (entry.startsWith("MartinStorsjo.LLVM-MinGW.UCRT")) {
          const pkgDir = resolve(wingetPkgs, entry);
          for (const sub of readdirSync(pkgDir)) {
            const binCandidate = resolve(pkgDir, sub, "bin");
            if (existsSync(binCandidate)) extraPaths.push(binCandidate);
          }
        }
      }
    }
  }

  return {
    ...process.env,
    PATH: [...extraPaths, process.env.PATH || ""].filter(Boolean).join(delimiter),
  };
}

const env = buildRustEnv();
const cargoCmd = process.platform === "win32" && existsSync(resolve(homedir(), ".cargo/bin/cargo.exe"))
  ? resolve(homedir(), ".cargo/bin/cargo.exe")
  : "cargo";

console.log("[rust:build] Running cargo test in native/opensybau-core...");
execFileSync(cargoCmd, ["test"], {
  cwd: crateDir,
  env,
  stdio: "inherit",
  windowsHide: true,
});

console.log("[rust:build] Building release binary (cargo build --release)...");
execFileSync(cargoCmd, ["build", "--release"], {
  cwd: crateDir,
  env,
  stdio: "inherit",
  windowsHide: true,
});

console.log("[rust:build] Native Rust core built successfully.");
