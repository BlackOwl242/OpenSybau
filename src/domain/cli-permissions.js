// These are provider settings, not equivalent security guarantees.
export function effectiveCliPermissions(provider, preset = "workspace-write", stage = "chat-initial", transport = "exec") {
  const full = preset === "full-access";
  const codexReadOnly = preset === "read-only" || !(stage === "build" || stage.startsWith("chat-"));
  if (provider === "codex") return { supported: true, sandbox: full ? "danger-full-access" : codexReadOnly ? "read-only" : "workspace-write", approval: full || transport !== "app-server" ? "never" : "on-request", liveApproval: !full && transport === "app-server", liveSteer: transport === "app-server" };
  if (provider === "claude") return { supported: true, mode: full ? "bypassPermissions" : preset === "read-only" || ["plan", "review"].includes(stage) ? "plan" : "acceptEdits", sandbox: "not-configured", liveApproval: false, liveSteer: false };
  if (provider === "antigravity") return { supported: preset !== "read-only", mode: full ? "dangerously-skip-permissions" : "sandbox", liveApproval: false, liveSteer: false };
  return { supported: false, liveApproval: false, liveSteer: false };
}
