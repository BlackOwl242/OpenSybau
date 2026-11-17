import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CliApprovalQueue } from "./cli-approval-queue.mjs";

/**
 * Lightweight Agent Client Protocol (ACP) JSON-RPC 2.0 stdio client.
 * Supports `initialize`, `session/new`, `session/prompt`, `session/cancel`,
 * and bridges `session/request_permission` through CliApprovalQueue.
 */
export class AcpClient {
  constructor({ exe, args = [], cwd, env = process.env, killTree = null, onNotification = null, onApproval = null, task = null, persist = null, publish = null } = {}) {
    this.exe = exe;
    this.args = Array.isArray(args) ? args : [];
    this.cwd = cwd;
    this.env = env;
    this.killTree = killTree;
    this.onNotification = onNotification;
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    this.sessionId = null;
    this.approvals = new CliApprovalQueue({
      task: task || { id: `acp-${randomUUID().slice(0, 6)}`, pendingApprovals: [] },
      client: {
        respond: (requestId, decision) => {
          this.respond(requestId, decision);
        },
      },
      record: onNotification ? (_t, msg, kind) => onNotification({ method: "status", params: { msg, kind } }) : null,
      persist,
      publish,
      timeoutMs: 120_000,
    });
    this.customApprovalHandler = onApproval;
  }

  async start() {
    if (this.child) return;
    this.child = spawn(this.exe, this.args, {
      cwd: this.cwd,
      env: { ...this.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stdin.on("error", () => {});
    this.child.on("close", (code) => {
      this.closed = true;
      this.approvals.close();
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`ACP process exited with code ${code}`));
        this.pending.delete(id);
      }
    });
    return this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "opensybau", version: "0.3.11" },
      capabilities: { fs: { readTextFile: true, writeTextFile: true } },
    }, 15_000);
  }

  #onData(chunk) {
    this.buffer += String(chunk || "");
    let idx;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
        const entry = this.pending.get(msg.id);
        if (!entry) continue;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message || "ACP RPC error"));
        else entry.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method) {
        this.#handleServerRequest(msg);
      } else if (msg.method) {
        this.onNotification?.(msg);
      }
    }
  }

  async #handleServerRequest(msg) {
    if (msg.method === "session/request_permission") {
      if (typeof this.customApprovalHandler === "function") {
        const result = await Promise.resolve(this.customApprovalHandler(msg.params || {}));
        this.respond(msg.id, result || { outcome: { outcome: "selected", optionId: "allow_once" } });
        return;
      }
      this.approvals.enqueue(msg.id, msg.method, msg.params || {});
      return;
    }
    this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Unsupported method: ${msg.method}` } });
  }

  respond(requestId, result) {
    this.send({ jsonrpc: "2.0", id: requestId, result });
  }

  send(payload) {
    if (this.closed || !this.child?.stdin?.writable) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  request(method, params = {}, timeoutMs = 60_000) {
    if (this.closed) return Promise.reject(new Error("ACP client is closed"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timeout: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ jsonrpc: "2.0", id, method, params })) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error("Failed to write ACP stdin"));
      }
    });
  }

  async runPromptSession({ cwd, prompt, timeoutMs = 120_000 }) {
    await this.start();
    const created = await this.request("session/new", { cwd: cwd || this.cwd, mcpServers: [] }, 15_000);
    this.sessionId = created?.sessionId || `sess-${randomUUID().slice(0, 8)}`;
    const result = await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: String(prompt || "") }],
    }, timeoutMs);
    return result;
  }

  async cancel() {
    if (this.sessionId) {
      this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
    }
    await this.close();
  }

  async close() {
    this.closed = true;
    this.approvals.close();
    if (this.child) {
      if (this.killTree) this.killTree(this.child);
      else try { this.child.kill("SIGTERM"); } catch {}
    }
  }
}
