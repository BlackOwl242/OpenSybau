import { existsSync } from "node:fs";

export function cliIsInstalled(executable, versionExitCode, fileExists = existsSync) {
  return versionExitCode === 0 || Boolean(executable && fileExists(executable));
}
