import readline from "node:readline";

export const OPENSYBAU_MCP_TOOLS = [
  {
    name: "list_workspaces",
    description: "List registered local Git/project workspaces managed by OpenSybau.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_quota",
    description: "Read current 5h/weekly quota usage and readiness across Codex, Antigravity, and Claude CLI.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List recent OpenSybau tasks with status, round, artifacts, and cost metrics.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Max tasks to return (default 20, max 50)." },
        status: { type: "string", description: "Optional status filter (queued, running, done, failed)." },
      },
    },
  },
  {
    name: "get_task_diff",
    description: "Inspect unified Git diff or artifacts produced by a specific OpenSybau task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID to inspect." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "search_workbench",
    description: "Search tasks, memories, and distilled lessons using OpenSybau FTS5 index.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords." },
        limit: { type: "integer", description: "Max hits (default 10)." },
      },
      required: ["query"],
    },
  },
];

/**
 * Create an opt-in local MCP JSON-RPC 2.0 server exposing safe read-only OpenSybau state.
 */
export function createOpenSybauMcpServer({
  getState,
  getMemories = () => [],
  getQuotas = async () => ({}),
  getTaskDiff = async () => "",
  searchWorkbench = async () => ({ results: [] }),
}) {
  async function callTool(name, args = {}) {
    const state = getState();
    if (name === "list_workspaces") {
      const workspaces = (state?.workspaces || []).map((ws) => ({
        id: ws.id,
        name: ws.name,
        path: ws.path,
        isGit: Boolean(ws.runtime?.isGit),
        branch: ws.runtime?.branch || null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ workspaces }, null, 2) }] };
    }
    if (name === "get_quota") {
      const quotas = await getQuotas();
      return { content: [{ type: "text", text: JSON.stringify(quotas, null, 2) }] };
    }
    if (name === "list_tasks") {
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
      const statusFilter = String(args.status || "").trim();
      const tasks = (state?.tasks || [])
        .filter((t) => !statusFilter || t.status === statusFilter)
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          code: t.code || null,
          title: t.title,
          status: t.status,
          phase: t.phase,
          workspaceId: t.workspaceId,
          artifacts: (t.artifacts || []).slice(0, 20),
          costUsd: t.costUsd || 0,
          updatedAt: t.updatedAt,
        }));
      return { content: [{ type: "text", text: JSON.stringify({ tasks }, null, 2) }] };
    }
    if (name === "get_task_diff") {
      const taskId = String(args.taskId || "").trim();
      const task = (state?.tasks || []).find((t) => t.id === taskId);
      if (!task) return { isError: true, content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      const diff = await getTaskDiff(task);
      return { content: [{ type: "text", text: String(diff || "No diff changes.").slice(0, 40_000) }] };
    }
    if (name === "search_workbench") {
      const query = String(args.query || "").trim();
      const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
      const res = await searchWorkbench({
        query,
        tasks: state?.tasks || [],
        memories: getMemories(),
        skills: [],
        limit,
      });
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }

  async function handleJsonRpcMessage(message) {
    if (!message || typeof message !== "object") {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } };
    }
    const { id, method, params = {} } = message;
    if (method === "notifications/initialized" || id === undefined) {
      return null;
    }
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "opensybau-mcp", version: "0.3.12" },
        },
      };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: OPENSYBAU_MCP_TOOLS } };
    }
    if (method === "tools/call") {
      const result = await callTool(String(params.name || ""), params.arguments || {});
      return { jsonrpc: "2.0", id, result };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  function serveStdio(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try { parsed = JSON.parse(trimmed); }
      catch {
        output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
        return;
      }
      const reply = await handleJsonRpcMessage(parsed);
      if (reply) output.write(`${JSON.stringify(reply)}\n`);
    });
    return rl;
  }

  return { handleJsonRpcMessage, serveStdio, tools: OPENSYBAU_MCP_TOOLS };
}
