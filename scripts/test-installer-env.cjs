const assert = require("node:assert/strict");
const { installerEnvironment } = require("../desktop/installer-env.cjs");
const modules = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules";
const input = { SystemRoot: "C:\\Windows", PSModulePath: `C:\\PowerShell7\\Modules;${modules}` };
const result = installerEnvironment(input, "win32");
assert.equal(result.PSModulePath, `${modules};C:\\PowerShell7\\Modules`);
assert.equal(installerEnvironment(result, "win32").PSModulePath, result.PSModulePath);
assert.equal(input.PSModulePath, `C:\\PowerShell7\\Modules;${modules}`);
console.log("Installer PowerShell module precedence passed.");
