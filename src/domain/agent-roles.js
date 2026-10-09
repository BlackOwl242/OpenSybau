export const workflowRoles = [
  { id: "plan", label: "Lập kế hoạch", capability: "plan", legacyProvider: "codex", legacyModel: "codexModel", legacyEffort: "codexEffort" },
  { id: "build", label: "Triển khai", capability: "build", legacyProvider: "antigravity", legacyModel: "agyModel", legacyEffort: "agyEffort" },
  { id: "review", label: "Review", capability: "review", legacyProvider: "codex", legacyModel: "codexModel", legacyEffort: "codexEffort" },
];

export function roleConfig(config, roleId) {
  const role = workflowRoles.find((item) => item.id === roleId);
  if (!role) return null;
  const configured = config?.roles?.[roleId];
  if (configured?.provider && configured?.model) return configured;
  return {
    provider: role.legacyProvider,
    model: config?.[role.legacyModel] || "",
    effort: config?.[role.legacyEffort] || "medium",
  };
}

export function connectorSupports(connector, capability) {
  return Boolean(connector?.available && connector.models?.length && connector.capabilities?.[capability]);
}

export function providersForRole(connectors, roleId) {
  const role = workflowRoles.find((item) => item.id === roleId);
  return Object.entries(connectors || {}).filter(([, connector]) => connectorSupports(connector, role?.capability));
}

export function providerTitle(connectors, id) {
  return connectors?.[id]?.name || ({ codex: "Codex", antigravity: "Antigravity", claude: "Claude Code", "claude-api": "Claude API" })[id] || id || "Agent";
}
