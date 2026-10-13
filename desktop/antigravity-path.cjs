const path = require("node:path");
const { existsSync } = require("node:fs");

function findDesktopAntigravityPath({ explicitPath = "", localAppData = "", roamingAppData = "", home = "", fileExists = existsSync } = {}) {
  const candidates = [
    explicitPath,
    localAppData && path.join(localAppData, "agy", "bin", "agy.exe"),
    roamingAppData && path.resolve(roamingAppData, "..", "Local", "agy", "bin", "agy.exe"),
    home && path.join(home, "AppData", "Local", "agy", "bin", "agy.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fileExists(candidate)) || "";
}

module.exports = { findDesktopAntigravityPath };
