import { promises as fs } from "node:fs";
import { resolve, relative, basename, extname } from "node:path";
import { homedir } from "node:os";
import { within } from "./fs-security.mjs";

// Inventory metadata only. Never return configuration bodies, keys or command arguments.
export async function customizationInventory(workspace, home = homedir()) {
  const entries = [];
  let truncated = false;
  let visited = 0;
  const roots = [
    [workspace.path, "workspace", ["codex", "claude", "antigravity"]],
    [resolve(home, ".codex"), "global", ["codex"]],
    [resolve(home, ".agents"), "global", ["codex", "claude", "antigravity"]],
    [resolve(home, ".claude"), "global", ["claude"]],
    [resolve(home, ".gemini"), "global", ["antigravity"]],
    [resolve(home, ".gemini/config"), "global", ["antigravity"]],
  ];
  for (const [root, scope, providers] of roots) {
    let realRoot; try { realRoot = await fs.realpath(root); } catch { continue; }
    const seen = new Set();
    async function read(path, kind) {
      if (entries.length >= 512) { truncated = true; return; }
      try {
        const stat = await fs.lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) return;
        const real = await fs.realpath(path);
        if (!within(realRoot, real) || seen.has(real)) return;
        seen.add(real);
        const source = relative(root, path).replaceAll("\\", "/");
        const effectiveProviders = /(?:^|\/)CLAUDE\.md$|^\.claude\//i.test(source) ? ["claude"] : /(?:^|\/)GEMINI\.md$|^\.(?:gemini|agent)\//i.test(source) ? ["antigravity"] : /^\.codex\//i.test(source) ? ["codex"] : providers;
        const item = { name: basename(path), source: scope === "global" ? `~/${relative(home, root).replaceAll("\\", "/")}/${source}` : source, kind, scope, providers: effectiveProviders, bytes: stat.size, loaded: "unknown", trusted: scope === "global" || Boolean(workspace.trustedSkills), tokenEstimate: null };
        if (stat.size <= 128000) {
          const body = await fs.readFile(real, "utf8");
          if (kind === "mcp") {
            if (extname(path) === ".toml") item.serverCount = [...body.matchAll(/^\[mcp_servers\.[^\]]+\]/gm)].length;
            else try { item.serverCount = Object.keys(JSON.parse(body).mcpServers || {}).length; } catch { item.parseError = true; }
          } else item.tokenEstimate = Math.ceil(body.length / 4);
        } else item.oversized = true;
        entries.push(item);
      } catch { /* Missing or inaccessible customization is not operational data. */ }
    }
    async function walk(path, kind, depth = 0) {
      if (depth > 5 || entries.length >= 512 || ++visited > 2000) { truncated = true; return; }
      let files; try { const real = await fs.realpath(path); if (!within(realRoot, real)) return; files = await fs.readdir(path, { withFileTypes: true }); } catch { return; }
      for (const file of files) {
        if (entries.length >= 512 || visited > 2000) { truncated = true; break; }
        if (file.isSymbolicLink()) continue;
        const target = resolve(path, file.name);
        if (file.isDirectory()) await walk(target, kind, depth + 1);
        else if (file.isFile() && [".md", ".toml"].includes(extname(file.name).toLowerCase())) await read(target, kind);
      }
    }
    for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) await read(resolve(root, name), "rules");
    for (const name of [".mcp.json", "mcp_config.json"]) await read(resolve(root, name), "mcp");
    if (scope === "global" && providers.includes("codex")) await read(resolve(root, "config.toml"), "mcp");
    for (const prefix of scope === "workspace" ? [".agents", ".claude", ".codex", ".gemini", ".agent"] : [""]) {
      for (const kind of ["rules", "skills", "agents"]) await walk(resolve(root, prefix, kind), kind);
      for (const name of [".mcp.json", "mcp_config.json"]) await read(resolve(root, prefix, name), "mcp");
    }
  }
  return { workspaceId: workspace.id, entries, truncated, estimateMethod: "characters-divided-by-four", loadedStatus: "not-reported-by-cli" };
}
