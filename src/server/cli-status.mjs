import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export function cliIsInstalled(executable, versionExitCode, fileExists = existsSync, scriptTarget = "") {
  if (versionExitCode === 0) return true;
  if (!executable) return false;
  if (scriptTarget) {
    return isAbsolute(scriptTarget) && Boolean(fileExists(scriptTarget));
  }
  if (executable === process.execPath) return false;
  if (!isAbsolute(executable) || !fileExists(executable)) return false;
  try {
    return statSync(executable).isFile();
  } catch {
    return true;
  }
}
