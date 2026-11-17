import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, resolve } from "node:path";

const ALLOWED_MCP_COMMANDS = new Set(["node", "node.exe", "npx", "npx.cmd", "python", "python3", "python.exe", "uvx", "uvx.exe"]);
const DISALLOWED_SHELLS = new Set(["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash", "zsh"]);

function isSafeMcpCommand(command) {
  const raw = String(command || "").trim();
  if (!raw || raw.includes("\0") || /[;&|`$<>]/.test(raw)) return false;
  const base = basename(raw).toLowerCase();
  if (DISALLOWED_SHELLS.has(base)) return false;
  return ALLOWED_MCP_COMMANDS.has(base) || existsSync(raw);
}

/**
 * Local stdio MCP client that discovers and calls tools declared in workspace `.mcp.json`
 * when workspace trust permits running local tools.
 */
export function createLocalMcpClient({ isWorkspaceTrusted = () => false, cacheTtlMs = 45_000 } = {}) {
  const catalogCache = new Map();

  async function readMcpConfig(cwd) {
    if (!cwd || !isWorkspaceTrusted(cwd)) return {};
    const configPath = resolve(cwd, ".mcp.json");
    if (!existsSync(configPath)) return {};
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed?.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
    } catch {
      return {};
    }
  }

  async function rpcExchange(serverName, serverSpec, requests, timeoutMs = 10_000) {
    if (!isSafeMcpCommand(serverSpec?.command)) {
      throw new Error(`Disallowed or unsafe MCP command for server "${serverName}".`);
    }
    const args = Array.isArray(serverSpec.args) ? serverSpec.args.map(String) : [];
    const env = { ...process.env };
    if (serverSpec.env && typeof serverSpec.env === "object") {
      for (const [k, v] of Object.entries(serverSpec.env)) {
        if (/^[A-Z0-9_]{1,64}$/i.test(k) && !["PATH", "LD_PRELOAD", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"].includes(k.toUpperCase())) {
          env[k] = String(v);
        }
      }
    }
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(serverSpec.command, args, {
        cwd: serverSpec.cwd || undefined,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      const responses = new Map();
      let buf = "";
      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch {}
        rejectPromise(new Error(`MCP server "${serverName}" timeout`));
      }, timeoutMs);
      timer.unref?.();

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined) responses.set(msg.id, msg);
          } catch {}
        }
        if (requests.every((r) => r.id === undefined || responses.has(r.id))) {
          clearTimeout(timer);
          try { child.kill("SIGTERM"); } catch {}
          resolvePromise(responses);
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        rejectPromise(err);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolvePromise(responses);
      });
      child.stdin.on("error", () => {});
      for (const req of requests) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...req })}\n`);
      }
      child.stdin.end();
    });
  }

  async function listToolsForWorkspace(cwd) {
    const cached = catalogCache.get(cwd);
    if (cached && Date.now() - cached.at < cacheTtlMs) return cached.tools;
    const servers = await readMcpConfig(cwd);
    const discovered = [];
    for (const [serverName, spec] of Object.entries(servers)) {
      if (!/^[a-z0-9_-]{1,40}$/i.test(serverName) || !spec?.command) continue;
      try {
        const replies = await rpcExchange(serverName, spec, [
          { id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "opensybau", version: "0.3.11" } } },
          { method: "notifications/initialized" },
          { id: 2, method: "tools/list", params: {} },
        ], 8000);
        const toolsRes = replies.get(2)?.result?.tools || [];
        for (const tool of toolsRes.slice(0, 20)) {
          if (!tool?.name) continue;
          discovered.push({
            name: `mcp:${serverName}:${tool.name}`,
            description: String(tool.description || `MCP tool ${tool.name} from ${serverName}`).slice(0, 300),
            parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
            _mcpServer: serverName,
            _mcpTool: tool.name,
          });
        }
      } catch {}
    }
    catalogCache.set(cwd, { at: Date.now(), tools: discovered });
    return discovered;
  }

  async function callTool(cwd, namespacedName, args = {}) {
    const match = String(namespacedName || "").match(/^mcp:([^:]+):(.+)$/);
    if (!match) return { ok: false, summary: `Invalid MCP tool name ${namespacedName}`, output: "Error: invalid MCP tool." };
    const [, serverName, toolName] = match;
    const servers = await readMcpConfig(cwd);
    const spec = servers[serverName];
    if (!spec) return { ok: false, summary: `MCP server not found: ${serverName}`, output: `Error: MCP server "${serverName}" unavailable.` };
    try {
      const replies = await rpcExchange(serverName, spec, [
        { id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "opensybau", version: "0.3.11" } } },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/call", params: { name: toolName, arguments: args } },
      ], 15_000);
      const rpcReply = replies.get(2);
      if (rpcReply?.error) {
        return { ok: false, summary: `${namespacedName} error`, output: `MCP error: ${rpcReply.error.message || "call failed"}` };
      }
      const res = rpcReply?.result || {};
      const text = (Array.isArray(res.content) ? res.content : []).map((c) => c.text || JSON.stringify(c)).join("\n").slice(0, 12_000);
      return {
        ok: !res.isError,
        summary: `${namespacedName}() -> ${text.length} chars`,
        output: text || "OK",
      };
    } catch (err) {
      return { ok: false, summary: `${namespacedName} failed`, output: `Error invoking MCP tool: ${err?.message || err}` };
    }
  }

  function invalidate(cwd = "") {
    if (cwd) catalogCache.delete(cwd);
    else catalogCache.clear();
  }

  return { listToolsForWorkspace, callTool, invalidate };
}
