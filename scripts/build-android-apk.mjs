import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = resolve(import.meta.dirname, "..");
const DIST_DIR = join(ROOT, "dist");
const ANDROID_DIR = join(ROOT, "android");
const ANDROID_ASSETS_PUBLIC = join(ANDROID_DIR, "app", "src", "main", "assets", "public");
const ANDROID_RES_DIR = join(ANDROID_DIR, "app", "src", "main", "res");
const ICON_SRC = join(ROOT, "desktop", "icon.png");

const syncOnly = process.argv.includes("--sync-only");
const skipWebBuild = process.argv.includes("--skip-web-build");

async function runViteBuild() {
  if (skipWebBuild && existsSync(join(DIST_DIR, "index.html"))) {
    console.log("[android] Skipping Vite build (--skip-web-build); using existing dist/.");
    return;
  }
  console.log("[android] Building production web bundle (vite build)...");
  const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");
  await execFileAsync(process.execPath, [viteBin, "build"], { cwd: ROOT });
}

async function collectFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(fullPath, baseDir)));
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      const sha256 = createHash("sha256").update(content).digest("hex");
      results.push({
        path: relative(baseDir, fullPath).replaceAll("\\", "/"),
        bytes: content.byteLength,
        sha256,
      });
    }
  }
  return results;
}

async function syncAndroidAssets() {
  console.log("[android] Syncing dist/ -> android/app/src/main/assets/public/ ...");
  await rm(ANDROID_ASSETS_PUBLIC, { recursive: true, force: true });
  await mkdir(ANDROID_ASSETS_PUBLIC, { recursive: true });
  await cp(DIST_DIR, ANDROID_ASSETS_PUBLIC, { recursive: true });

  const capConfigPath = join(ROOT, "capacitor.config.json");
  if (existsSync(capConfigPath)) {
    await cp(capConfigPath, join(ANDROID_DIR, "app", "src", "main", "assets", "capacitor.config.json"));
  }

  if (existsSync(ICON_SRC)) {
    const mipmapDirs = ["mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"];
    for (const dirName of mipmapDirs) {
      const targetDir = join(ANDROID_RES_DIR, dirName);
      await mkdir(targetDir, { recursive: true });
      await cp(ICON_SRC, join(targetDir, "ic_launcher.png"));
    }
  }

  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const files = await collectFiles(ANDROID_ASSETS_PUBLIC);
  const manifest = {
    appId: "com.opensybau.mobile",
    appName: pkg.desktopName || "OpenSybau",
    version: pkg.version,
    syncedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + item.bytes, 0),
    files,
  };
  await writeFile(join(ANDROID_DIR, "build-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[android] Synced ${files.length} web assets (${(manifest.totalBytes / 1024).toFixed(1)} KB) & launcher icons.`);
  return manifest;
}

async function detectAndroidToolchain() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  let hasJava = false;
  let hasGradle = false;
  try {
    await execFileAsync("java", ["-version"]);
    hasJava = true;
  } catch {}
  try {
    await execFileAsync(process.platform === "win32" ? "gradle.bat" : "gradle", ["--version"]);
    hasGradle = true;
  } catch {}
  const gradlewPath = join(ANDROID_DIR, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const hasGradlew = existsSync(gradlewPath);
  return {
    sdkRoot,
    hasSdk: Boolean(sdkRoot && existsSync(sdkRoot)),
    hasJava,
    hasGradle: hasGradle || hasGradlew,
    gradlewPath: hasGradlew ? gradlewPath : null,
  };
}

await runViteBuild();
const manifest = await syncAndroidAssets();

if (syncOnly) {
  console.log("[android] Android APK project sync completed (--sync-only).");
  process.exit(0);
}

const toolchain = await detectAndroidToolchain();
if (toolchain.hasJava && toolchain.hasSdk && toolchain.hasGradle) {
  console.log("[android] Android SDK & JDK detected. Compiling debug APK...");
  const cmd = toolchain.gradlewPath || (process.platform === "win32" ? "gradle.bat" : "gradle");
  await execFileAsync(cmd, ["assembleDebug"], { cwd: ANDROID_DIR });
  const apkSource = join(ANDROID_DIR, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (existsSync(apkSource)) {
    const outDir = join(ROOT, "release", "android");
    await mkdir(outDir, { recursive: true });
    const outApk = join(outDir, `OpenSybau-${manifest.version}-android.apk`);
    await cp(apkSource, outApk);
    const info = await stat(outApk);
    console.log(`[android] APK built successfully: ${outApk} (${(info.size / 1024 / 1024).toFixed(2)} MB)`);
  }
} else {
  console.log("[android] Native Android project & OpenSybau web bundle are 100% synced in ./android.");
  console.log(`[android] Toolchain status: JDK=${toolchain.hasJava ? "ready" : "missing"}, ANDROID_HOME=${toolchain.hasSdk ? "ready" : "missing"}, Gradle=${toolchain.hasGradle ? "ready" : "missing"}.`);
  console.log("[android] Open ./android in Android Studio or run `gradle assembleDebug` on a machine with Android SDK to output app-debug.apk.");
}
