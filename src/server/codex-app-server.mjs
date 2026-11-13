import { spawn } from "node:child_process";

export class CodexAppServer {
  constructor(executable, { cwd, args = [], onEvent = () => {}, onRequest = () => {}, spawnProcess = spawn } = {}) {
    this.pending = new Map(); this.seq = 0; this.turnId = null; this.threadId = null; this.steers = new Map();
    this.childThreads = new Set(); this.activeTurns = new Map();
    this.child = spawnProcess(executable, [...args, "app-server", "--stdio"], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.closed = new Promise((resolve) => this.child.once("close", resolve));
    this.failure = null;
    let buffer = "";
    this.child.stdout.setEncoding?.("utf8");
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 8000000) { this.close(new Error("Codex protocol buffer exceeded limit")); return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (!message || typeof message !== "object" || Array.isArray(message)) continue;
        if (message.method && message.id !== undefined) { try { onRequest(message, this); } catch (error) { void this.close(error); } continue; }
        if (message.id !== undefined) {
          const request = this.pending.get(message.id);
          if (request) { clearTimeout(request.timer); this.pending.delete(message.id); message.error ? request.reject(new Error(message.error.message || "Codex protocol error")) : request.resolve(message.result); }
        } else if (message.method) {
          if (message.method === "turn/started" && message.params?.threadId === this.threadId) this.turnId = message.params?.turn?.id;
          if (message.method === "turn/started" && (message.params?.threadId === this.threadId || this.childThreads.has(message.params?.threadId))) this.activeTurns.set(message.params.threadId, message.params.turn?.id);
          if (message.method === "turn/completed" && this.activeTurns.get(message.params?.threadId) === message.params?.turn?.id) this.activeTurns.delete(message.params.threadId);
          if (message.method === "turn/completed" && message.params?.threadId === this.threadId && message.params?.turn?.id === this.turnId) this.turnId = null;
          try { onEvent(message, this); } catch (error) { void this.close(error); }
        }
      }
    });
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.stderr.on("data", () => {});
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", () => this.fail(new Error("Codex App Server disconnected")));
  }
  fail(error) {
    if (this.failure) return;
    this.failure ||= error;
    this.activeTurns.clear(); this.turnId = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear(); this.onDisconnect?.(error);
  }
  request(method, params = {}, timeout = 30000) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }
  respond(id, result) { if (this.failure) throw this.failure; this.child.stdin.write(`${JSON.stringify({ id, result })}\n`); }
  isActiveTurn(threadId, turnId) { return Boolean(turnId && !this.failure && (threadId === this.threadId ? turnId === this.turnId : this.childThreads.has(threadId) && this.activeTurns.get(threadId) === turnId)); }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "opensybau", version: "0.3.10" } });
    this.child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  }
  steer(text, expectedTurnId, key) {
    if (!this.turnId || expectedTurnId !== this.turnId) return Promise.reject(new Error("Active Codex turn changed; queue the message instead"));
    if (this.steers.has(key)) {
      const previous = this.steers.get(key);
      return previous.text === text ? previous.request : Promise.reject(new Error("Request ID already used for a different message"));
    }
    if (this.steers.size >= 256) return Promise.reject(new Error("Steering request limit reached for this session"));
    const request = this.request("turn/steer", { threadId: this.threadId, expectedTurnId, input: [{ type: "text", text }] });
    this.steers.set(key, { text, request });
    return request; // Do not retry an uncertain request after a disconnect.
  }
  close(error = new Error("Codex session closed")) { this.fail(error); this.child.kill(); return this.closed; }
}
