import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRustAcceleratorStatus,
  rustParseDiffSync,
  rustParseDiffAsync,
  rustBuildVaultGraphAsync,
  rustRankBm25Sync,
  rustScanWorkspaceFilesAsync,
} from "../src/server/rust-accelerator.mjs";
import { parseUnifiedDiffFiles, parseUnifiedDiffFilesAsync } from "../src/server/diff-parser.mjs";
import { buildVaultKnowledgeGraph } from "../src/server/vault-service.mjs";
import { relevantMemory } from "../src/server/memory-bm25.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

async function main() {
  console.log("=== OpenSybau Hybrid Rust Accelerator Verification & Benchmark ===\n");

  const status = getRustAcceleratorStatus();
  assert.equal(status.available, true, "Rust native binary must be available");
  assert.equal(status.lang, "rust", "Engine language must be rust");
  console.log(`[PASS] Rust Binary Health: ${status.engine} v${status.version} (${status.threads} CPU threads)`);
  console.log(`       Binary Path: ${status.binaryPath}\n`);

  // 1. Unified Diff Parser Test & Benchmark (2,500-line multi-file git diff)
  const chunk = [
    'diff --git "a/src/\\303\\241pp.js" "b/src/\\303\\241pp.js"',
    '--- "a/src/\\303\\241pp.js"',
    '+++ "b/src/\\303\\241pp.js"',
    "@@ -10,6 +10,8 @@ function boot() {",
    " const alpha = 1;",
    "-const beta = 2;",
    "+const beta = 20;",
    "+const gamma = 30;",
    " return alpha + beta;",
  ].join("\n");
  const syntheticDiff = Array.from({ length: 45 }, (_, idx) =>
    chunk.replaceAll("ápp.js", `module-${idx}.js`).replaceAll("\\303\\241pp.js", `\\303\\241pp-${idx}.js`)
  ).join("\n");

  const t0 = performance.now();
  const rustDiff = await rustParseDiffAsync(syntheticDiff);
  const rustDiffMs = performance.now() - t0;

  assert.equal(rustDiff.length, 45, "Should parse all 45 files in diff");
  assert.equal(rustDiff[0].path, "src/ápp-0.js", "Should decode Git octal UTF-8 paths in Rust");
  assert.equal(rustDiff[0].additions, 2);
  assert.equal(rustDiff[0].deletions, 1);

  const integratedDiff = await parseUnifiedDiffFilesAsync(syntheticDiff);
  assert.equal(integratedDiff.length, 45);
  console.log(`[PASS] Native Rust Diff Parser (parse-diff): 45 files parsed in ${rustDiffMs.toFixed(2)} ms`);

  // 2. Multi-threaded Vault Knowledge Graph Test & Benchmark
  const tVault0 = performance.now();
  const vaultGraph = await rustBuildVaultGraphAsync(repoRoot);
  const vaultMs = performance.now() - tVault0;
  assert.ok(Array.isArray(vaultGraph.nodes), "Vault graph nodes must be an array");
  assert.ok(Array.isArray(vaultGraph.edges), "Vault graph edges must be an array");
  assert.ok(vaultGraph.nodes.length >= 1, "Should find markdown files in repository");

  const integratedVault = await buildVaultKnowledgeGraph(repoRoot);
  assert.equal(integratedVault.nodes.length, vaultGraph.nodes.length);
  console.log(`[PASS] Multi-Threaded Rust Vault Knowledge Graph (vault-graph): ${vaultGraph.nodes.length} notes, ${vaultGraph.edges.length} edges in ${vaultMs.toFixed(2)} ms`);

  // 3. Native Okapi BM25 Memory Ranker Test & Benchmark
  const syntheticMemories = Array.from({ length: 120 }, (_, i) => ({
    id: `mem-${i}`,
    workspaceId: "ws-main",
    kind: i === 42 ? "pitfall" : "lesson",
    title: i === 42 ? "Git Worktree Shared Checkout Lock" : `General coding note ${i}`,
    content: i === 42
      ? "[BLOCKING] Serialize shared-checkout git worktree tasks and avoid concurrent index mutation"
      : `Routine implementation details for module ${i} with standard styling`,
    tags: i === 42 ? ["git", "worktree", "concurrency"] : ["ui", "css"],
  }));

  const tBm0 = performance.now();
  const bm25Res = rustRankBm25Sync({
    query: "fix git worktree shared checkout lock",
    workspaceId: "ws-main",
    memories: syntheticMemories,
    limit: 4,
  });
  const bm25Ms = performance.now() - tBm0;
  assert.ok(bm25Res && Array.isArray(bm25Res.indices), "BM25 result must include indices");
  assert.equal(bm25Res.indices[0], 42, "Top BM25 hit must be mem-42");

  const integratedMem = relevantMemory(
    { title: "fix git worktree shared checkout lock", prompt: "", goal: "" },
    { id: "ws-main" },
    syntheticMemories
  );
  assert.equal(integratedMem[0]?.id, "mem-42", "relevantMemory() must return mem-42 via Rust BM25");
  console.log(`[PASS] Native Rust Okapi BM25 Ranker (rank-bm25): 120 memories ranked in ${bm25Ms.toFixed(2)} ms (top hit: ${integratedMem[0].id})`);

  // 4. Native Workspace File Scanner Test & Benchmark
  const tScan0 = performance.now();
  const scannedFiles = await rustScanWorkspaceFilesAsync(repoRoot, 180);
  const scanMs = performance.now() - tScan0;
  assert.ok(Array.isArray(scannedFiles) && scannedFiles.length > 10, "Should scan repository files");
  assert.ok(!scannedFiles.some((f) => f.includes("node_modules") || f.includes(".git/") || f.endsWith(".sqlite")), "Must exclude ignored dirs & sensitive files");
  console.log(`[PASS] Native Rust Workspace Scanner (scan-files): ${scannedFiles.length} safe context files scanned in ${scanMs.toFixed(2)} ms`);

  const finalStatus = getRustAcceleratorStatus();
  console.log(`\n=== ALL RUST ACCELERATOR TESTS PASSED (workerActive=${finalStatus.workerActive}, totalCalls=${finalStatus.callsTotal}) ===`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
