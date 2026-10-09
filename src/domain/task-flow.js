export function orchestrationNodes(task) {
  const events = task.events || [];
  const hasEvent = (pattern) => events.some((event) => pattern.test(event.text || ""));
  const isChat = task.config.workflow === "chat-only";
  const planOnly = task.config.workflow === "plan-only";
  const failed = task.status === "failed" || task.status === "cancelled";
  const phaseOrder = { queued: 0, chat: 2, plan: 3, build: 5, review: 7, done: 9, failed: 9, cancelled: 9 };
  const activeOrder = phaseOrder[task.phase] ?? 0;
  const status = (order, done, active = false, failureRelevant = false) => {
    if (failureRelevant && failed && (task.failedPhase === task.phase || task.phase === "failed" || task.phase === "cancelled")) return task.status;
    if (done || task.status === "done" && order <= activeOrder) return "complete";
    if (task.status === "queued") return order === 0 ? "complete" : "queued";
    if (active || task.status === "running" && order === activeOrder) return "active";
    return task.status === "running" && order < activeOrder ? "complete" : "pending";
  };
  const nodes = [{ id: "request", group: "WORKBENCH", title: "Nhận yêu cầu & tạo task", detail: "Task được ghi vào hàng đợi cục bộ.", icon: "square-terminal", order: 0, state: status(0, true) }];
  const skillEvidence = task.skillSelectionCompleted || hasEvent(/chọn skill|nạp .*skill|không tìm được skill/i);
  nodes.push({ id: "skills", group: "ROUTER", title: "Tìm và chọn skill", detail: task.skills?.length ? `${task.skills.length} skill được chọn: ${task.skills.map((skill) => skill.name).join(", ")}` : skillEvidence ? "Đã tìm thư viện; task tiếp tục theo lựa chọn của bộ định tuyến." : "Tìm ứng viên phù hợp trong thư viện skill.", icon: "notebook-tabs", order: 1, state: status(1, skillEvidence, false, true), output: task.skillSelectionReason });
  const memoryEvidence = (task.memoryUsed || []).length > 0 || hasEvent(/ghi chú phù hợp từ bộ nhớ|bộ nhớ cục bộ/i);
  nodes.push({ id: "memory", group: "CONTEXT", title: "Nạp ghi nhớ liên quan", detail: (task.memoryUsed || []).length ? `${task.memoryUsed.length} ghi chú: ${task.memoryUsed.map((item) => item.title).join(", ")}` : memoryEvidence ? "Đã kiểm tra bộ nhớ cục bộ." : task.status === "queued" ? "Chờ task bắt đầu để kiểm tra ghi nhớ phù hợp." : "Đã kiểm tra; không có ghi chú phù hợp.", icon: "brain", order: 1.5, state: status(1.5, memoryEvidence || task.status !== "queued"), output: task.memoryUsed?.map((item) => item.title).join("\n") });
  if (isChat) {
    const provider = task.config.chatProvider === "antigravity" ? "Antigravity" : "Codex";
    nodes.push({ id: "agent-chat", group: "AGENT", title: `Agent trả lời · ${provider}`, detail: `${task.config.chatModel || "Model theo cấu hình task"} · ${task.config.chatEffort || "mức suy nghĩ đã chọn"}`, icon: "book-open-text", order: 3, state: status(2, task.status === "done", task.phase === "chat", true), output: task.chatMessages?.filter((message) => message.role === "assistant").at(-1)?.content });
    nodes.push({ id: "result", group: "RESULT", title: "Lưu kết quả hội thoại", detail: task.status === "done" ? "Phản hồi đã được lưu trong task." : "Phản hồi sẽ xuất hiện tại đây khi CLI hoàn tất.", icon: "book-check", order: 9, state: status(9, task.status === "done") });
    return nodes;
  }
  const planDone = Boolean(task.plan) || task.phase === "build" || task.phase === "review" || task.phase === "done" && planOnly;
  nodes.push({ id: "plan", group: "CODEX · PLAN", title: "Phân tích workspace & lập kế hoạch", detail: `${task.config.codexModel || "Codex CLI"} · ${task.config.codexEffort || "mức suy nghĩ đã chọn"}`, icon: "list-checks", order: 3, state: status(3, planDone, task.phase === "plan", true), output: task.plan });
  if (planOnly) {
    nodes.push({ id: "result", group: "RESULT", title: "Lưu kế hoạch", detail: task.status === "done" ? "Kế hoạch đã hoàn tất; chưa chạy triển khai." : "Đầu ra kế hoạch sẽ được lưu ở đây.", icon: "book-check", order: 9, state: status(9, task.status === "done"), output: task.plan });
    return nodes;
  }
  const handoffToAgy = hasEvent(/Handoff Codex → Antigravity/i);
  nodes.push({ id: "handoff-build", group: "HANDOFF", title: "Chuyển kế hoạch sang Antigravity", detail: "Bàn giao đầu ra Codex và cấu hình triển khai.", icon: "arrow-up-right", order: 4, state: status(4, handoffToAgy || planDone && (task.phase === "build" || task.phase === "review" || task.status === "done")) });
  const buildDone = Boolean(task.implementation) || task.phase === "review" || task.status === "done";
  nodes.push({ id: "build", group: "ANTIGRAVITY · BUILD", title: "Triển khai thay đổi", detail: `${task.config.agyModel || "Antigravity CLI"} · ${task.config.agyEffort || "mức suy nghĩ đã chọn"}`, icon: "folder-code", order: 5, state: status(5, buildDone, task.phase === "build", true), output: task.implementation });
  const toolEvents = events.filter((event) => event.kind === "tool");
  if (toolEvents.length) nodes.push({ id: "tools", group: "OBSERVED TOOLS", title: `${toolEvents.length} lần gọi công cụ CLI`, detail: "Danh sách chỉ gồm sự kiện công cụ được CLI ghi nhận thực tế.", icon: "settings-2", order: 5.5, state: status(5.5, buildDone || task.status === "running" && task.phase === "review"), events: toolEvents });
  const handoffToCodex = hasEvent(/Handoff Antigravity → Codex/i);
  nodes.push({ id: "handoff-review", group: "HANDOFF", title: "Chuyển thay đổi về Codex", detail: "Bàn giao kết quả triển khai cho stage review.", icon: "arrow-up-right", order: 6, state: status(6, handoffToCodex || task.phase === "review" || Boolean(task.review)) });
  nodes.push({ id: "review", group: "CODEX · REVIEW", title: "Review thay đổi & kiểm tra kết quả", detail: `${task.config.codexModel || "Codex CLI"} · ${task.config.codexEffort || "mức suy nghĩ đã chọn"}`, icon: "book-check", order: 7, state: status(7, Boolean(task.review) || task.status === "done", task.phase === "review", true), output: task.review });
  const artifactCount = (task.artifacts || []).length;
  nodes.push({ id: "result", group: "RESULT", title: "Ghi nhận đầu ra & tệp thay đổi", detail: task.status === "done" ? `${artifactCount} tệp thay đổi được ghi nhận trong task.` : "Kết quả và danh sách tệp sẽ hiện sau khi luồng hoàn tất.", icon: "file", order: 9, state: status(9, task.status === "done"), files: task.artifacts || [] });
  return nodes;
}
