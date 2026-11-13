# OpenSybau — Product Charter & Architectural Positioning (`PRODUCT.md`)

## 1. Mission & Category Definition

**OpenSybau** is a **Local-First Multi-Harness Agent Development Environment (ADE) & Parallel Git Worktree Workbench** with a paired **LAN / VPN Mobile Remote Triage Companion**.

Modern AI software engineering operates across three distinct layers:

1. **Layer 0 — Foundation Models & Inference Endpoints:** Stateless token and tool-call generators (`GPT/Codex`, `Claude`, `Gemini`, `DeepSeek`, local `Ollama` / `LM Studio` / `LocalAI`).
2. **Layer 1 — Single-Agent CLI Harnesses (`Agent = Model + Harness`):** Loop runtimes wrapping one reasoning engine with an Agent-Computer Interface (ACI), context compaction, sandbox gates, and tool execution (`OpenAI Codex CLI` / `codex app-server`, `Claude Code`, `Google Antigravity CLI (agy)`, `DeepSeek Harness (dsh)`, `Hermes Agent`, `SWE-agent`).
3. **Layer 2 — Multi-Harness Local Orchestrator Workbench + Remote Companion:** The **Air Traffic Control Tower & Code Review Studio** sitting above installed CLI harnesses and direct model APIs on the developer's workstation (`OpenSybau`, alongside category peers `Stably Orca`, `Conductor`, `Superset`, `Codex Desktop`, and `Antigravity Agent Manager`).

### Core Job-To-Be-Done (JTBD)
> When building software across local repositories using multiple AI coding subscriptions and local models (`Codex CLI`, `Claude Code`, `Antigravity CLI`, `OpenAI / Anthropic / Ollama APIs`), OpenSybau lets developers **dispatch, isolate via Git worktrees, compare head-to-head in a multi-agent Arena, monitor 5h/7d CLI quotas, and review/merge diffs** in one local-first control plane without cloud code exfiltration or checkout collisions, while enabling **untethered triage, command/plan approvals, and safe worktree task dispatch** from a phone over LAN or Tailscale.

---

## 2. Strict Platform Separation: Desktop Host vs. Mobile Companion

OpenSybau ships two distinct operational experiences tailored to physical ergonomics, attention span, and execution locality. **Mobile is NEVER treated as a CSS-shrunk clone of Desktop.**

| Capability Domain | Desktop App (`Electron` / Local Workstation Browser) | Mobile Companion (`Android APK` / Paired Mobile Web) |
| :--- | :--- | :--- |
| **Primary Role** | Local runtime host, multi-pane authoring & code inspection studio, parallel Arena judge, and final Git merge gatekeeper. | Asynchronous remote control: triage blocked runs, approve/reject CLI permissions & plans, inspect quota health, and dispatch isolated tasks on the go. |
| **Navigation Architecture** | **3-Zone Spatial Permanence:** Left Workspace/Thread & Inbox Sidebar + Center Conversation/Artifact Stage + Right File/Diff/Preview Inspector + `Ctrl+K` Command Palette. | **Thumb-Zone Remote Companion:** Priority **Needs-Attention Inbox**, grouped active **Sessions** (`Chat · Shell · Plan`), **Quick Dispatch** (`Git Worktree = ON` by default), and **Host & Quota** telemetry. |
| **Execution Safety Default** | Supports both serialized Shared Checkout (`Máy tính này`) and isolated `Git Worktree`, plus `2–8x` Parallel Arena. | **Defaults `Git Worktree = ON` automatically** so away-from-desk mobile dispatches never mutate uncommitted files open on the desktop PC. |
| **Approvals & Plan Gate** | Inline permission cards above the composer + split `PLAN.md` / `REVIEW.md` stage tabs. | High-contrast thumb-friendly **Decision Cards** (`>= 44px` targets) at the top of Home/Chat with clear command & blast-radius previews. |
| **Diff & Preview** | Full Unified/Split Diff Studio with inline code-line review comments, 3-way conflict resolution, and localhost iframe inspector. | Compact file-level diff digest & single-column review; rewrites `localhost` preview ports to the paired PC's LAN host; hides PC-local OS window spawners (`Explorer`, `Obsidian`, interactive PC terminal login). |

---

## 3. Non-Negotiable Product Invariants

1. **Local-First & Zero Fake Seed Data:** Default strictly to loopback (`127.0.0.1`). Expose LAN/network access only in production mode with an explicit `host:port` allowlist and strong HTTP Basic Auth (`>= 16` chars). Never seed fake tasks, tokens, or memories; always render honest, instructive empty states.
2. **Runtime CLI Truth:** Discover models, reasoning efforts, and `5h / 7d` usage windows dynamically from installed CLIs at runtime. Invoke CLI binaries strictly via argument arrays (`shell: false`) inside registered workspaces.
3. **Checkout Safety:** Serialize shared-checkout runs per Git root; run concurrent tasks, multi-agent Arenas, and scheduled automations exclusively in isolated Git worktrees (with optional `.opensybau/worktree.json` environment file copy).
4. **Zero Surprise Navigation:** User actions (viewing `PLAN.md`, picking a skill, creating a subagent profile, commenting on a diff, or creating a task from `Tasks`/`Flows`) must preserve spatial context in-place via contextual drawers, tabs, or modals rather than unexpectedly teleporting across routes.
