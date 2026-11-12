export class CliApprovalQueue {
  constructor(task, client, { timeoutMs = 180000, changed = () => {}, record = () => {} } = {}) {
    this.task = task; this.client = client; this.timers = new Map();
    this.timeoutMs = timeoutMs; this.changed = changed; this.record = record;
  }
  add(message) {
    const { params = {}, id, method } = message;
    if (!this.active(params.threadId, params.turnId) || id == null) return false;
    if (this.timers.has(String(id))) return true;
    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString();
    this.task.pendingApprovals ||= [];
    const files = (this.client.fileProposals?.get(params.itemId) || []).slice(0, 20).map((file) => ({ path: String(file.path || "").slice(0, 1000), diff: String(file.diff || "").slice(0, 8000) }));
    this.task.pendingApprovals.push({ id, method, threadId: params.threadId, turnId: params.turnId, command: String(params.command || "").slice(0, 8000), reason: String(params.reason || "").slice(0, 4000), itemId: params.itemId, cwd: params.cwd || "", grantRoot: params.grantRoot || "", files, createdAt: new Date().toISOString(), expiresAt });
    this.record(this.task, `Codex đang chờ duyệt · ${String(params.command || params.reason || method).slice(0, 240)}`, "approval", { source: "codex-app-server", approvalId: id, threadId: params.threadId, turnId: params.turnId });
    const timer = setTimeout(() => {
      const approval = this.task.pendingApprovals.find((item) => String(item.id) === String(id));
      if (approval && this.active(approval.threadId, approval.turnId)) this.client.respond(id, { decision: "decline" });
      this.remove(id);
      this.record(this.task, "Codex: yêu cầu duyệt đã hết hạn hoặc lượt chạy đã kết thúc.", "warning", { source: "codex-app-server", approvalId: id });
    }, this.timeoutMs);
    timer.unref?.(); this.timers.set(String(id), timer); this.changed(); return true;
  }
  remove(id) {
    clearTimeout(this.timers.get(String(id))); this.timers.delete(String(id));
    this.task.pendingApprovals = (this.task.pendingApprovals || []).filter((item) => String(item.id) !== String(id));
    this.changed();
  }
  active(threadId, turnId) { return !this.client.stageEnded && (this.client.isActiveTurn ? this.client.isActiveTurn(threadId, turnId) : !this.client.failure && this.client.threadId === threadId && this.client.turnId === turnId); }
  resolve(id, turnId, decision) {
    const item = (this.task.pendingApprovals || []).find((entry) => String(entry.id) === String(id) && entry.turnId === turnId);
    if (!item || !this.active(item.threadId, turnId) || Date.parse(item.expiresAt) <= Date.now() || !["accept", "decline"].includes(decision)) return false;
    this.client.respond(item.id, { decision }); this.remove(id); return true;
  }
  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.task.pendingApprovals = []; this.changed();
  }
}
