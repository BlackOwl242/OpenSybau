const path = require("node:path");

function installerEnvironment(env, platform = process.platform) {
  const result = { ...env, NO_COLOR: "1", CODEX_NON_INTERACTIVE: "1" };
  if (platform === "win32") {
    const root = env.SystemRoot || env.SYSTEMROOT || env.WINDIR || "C:\\Windows";
    const systemModules = path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "Modules");
    const existingKey = Object.keys(result).find((key) => key.toLowerCase() === "psmodulepath") || "PSModulePath";
    const paths = String(result[existingKey] || "").split(";").filter(Boolean)
      .filter((entry) => entry.replace(/[\\/]+$/, "").toLowerCase() !== systemModules.toLowerCase());
    result[existingKey] = [systemModules, ...paths].join(";");
  }
  return result;
}

module.exports = { installerEnvironment };
