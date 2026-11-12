import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customizationInventory } from "../src/server/customization-inventory.mjs";
const root = await fs.mkdtemp(join(tmpdir(), "opensybau-inventory-"));
try {
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  await fs.mkdir(join(workspace, ".agents/skills/example"), { recursive: true });
  await fs.mkdir(home);
  await fs.writeFile(join(workspace, "AGENTS.md"), "Use registered workspace.");
  await fs.writeFile(join(workspace, ".agents/skills/example/SKILL.md"), "Example instructions");
  await fs.writeFile(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { test: { env: { SECRET: "never-return-this-secret" } } } }));
  const data = await customizationInventory({ id: "test", path: workspace, trustedSkills: false }, home);
  assert.equal(data.entries.length, 3);
  assert.equal(data.entries.find((item) => item.kind === "mcp").serverCount, 1);
  assert.equal(data.entries.find((item) => item.kind === "skills").trusted, false);
  assert.ok(!JSON.stringify(data).includes("never-return-this-secret"));
  assert.ok(data.entries.every((item) => item.loaded === "unknown"));
  await fs.writeFile(join(workspace,".agents/skills/large.md"), "x".repeat(128001));
  await fs.writeFile(join(workspace,".agents/skills/invalid.toml"), "[settings]");
  const outside=join(root,"outside");await fs.mkdir(outside);await fs.writeFile(join(outside,"SECRET.md"),"outside");
  await fs.symlink(outside,join(workspace,".agents/skills/escape"),process.platform==="win32"?"junction":"dir");
  const bounded=await customizationInventory({id:"test",path:workspace},home);
  assert.equal(bounded.entries.find(item=>item.name==="large.md").oversized,true);
  assert.ok(!bounded.entries.some(item=>item.name==="SECRET.md"));
  console.log("Customization inventory scope and secret exclusion passed.");
} finally { await fs.rm(root, { recursive: true, force: true }); }
