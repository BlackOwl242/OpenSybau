# <img src="public/opensybau.svg" alt="OpenSybau Logo" width="36" height="36" align="top" /> OpenSybau

**A local-first multi-agent coding workbench & parallel Git worktree arena.**  
OpenSybau brings **Codex CLI**, **Claude Code**, **Antigravity CLI**, and **Anthropic / OpenAI-compatible APIs** (including Ollama, LM Studio, and LocalAI) into a unified frosted-glass desktop and browser interface. Every task, chat, and Git worktree executes directly on your machine with full transparency and zero cloud lock-in.

**Documentation:** [Tiếng Việt](README.vi.md) · **Changelog:** [CHANGELOG.md](CHANGELOG.md) · **License:** [MIT](LICENSE)

---

## ✨ What's New & Core Highlights

### 1. Frosted-Glass Desktop Experience & Smart Two-Tier Composer
- **Windows Mica / Frosted-Glass Shell:** Native translucent sidebar combined with a floating rounded main stage.
- **Two-Tier Bottom-Docked Composer:**
  - **Top Context Rail:** Switch workspaces (`Dự án`), toggle execution isolation between **Local Checkout (`Máy tính này`)** and **Isolated Git Worktree (`Git Worktree`)**, and switch work modes (**Chat**, **Code**, **Plan**, **Arena**).
  - **Bottom Control Bar with Upward Popovers:** Custom upward-opening glass popovers for **Agent & Model**, **Reasoning Effort** (`Low` / `Medium` / `High` / `Max`), file/image attachments (`+` or `@file` mentions), and **Agent Execution Permissions**:
    - 🛡️ **Safe Read-Only (`Chỉ đọc an toàn`):** Analyze code and reply without modifying workspace files.
    - 🧑‍💻 **Read & Edit Project (`Đọc & sửa trong dự án`):** Read, edit files, and run tools scoped to the active workspace.
    - ⚡ **Full Execution Access (`Toàn quyền thực thi`):** Unrestricted command execution, package installation, and file operations on your machine.

### 2. Multi-Slot Parallel Worktree Arena (`Đấu trường`)
- **Run 2 to 8 Parallel Branches Simultaneously:** Spawn multiple isolated Git worktrees for the exact same prompt in one click.
- **Same-Model or Multi-Vendor Competition:** Run **2× or 3× instances of the exact same model** (e.g., 3 parallel Codex or Claude runs to pick the best implementation) or pit different providers/models against each other.
- **Side-by-Side Diff Review & One-Click Merge:** Inspect changed files, token usage, and live tool logs per branch in the **Diff Review Studio**, then apply the winning worktree directly back into your main checkout.

### 3. Multi-Stage Agent Pipelines & Conversation Control
- **Independent Role Routing:** Assign different providers, models, and reasoning efforts to **Plan**, **Build**, and **Review** (e.g., Claude plans → Codex implements → Antigravity reviews).
- **Rich Session Management:** Queue follow-up messages while an agent is busy, fork any completed turn into a new conversation branch, pin/archive threads, attach long-term **Goals & Checklists**, and save versioned **Task Templates**.
- **Rerun from Any Stage:** Re-execute completed or failed pipelines from Plan, Build, or Review while preserving previous stage outputs in history.

### 4. Hardened Security & Zero-Lag Runtime
- **Local-First & Loopback by Default:** Binds to `127.0.0.1` by default. Network/LAN mode requires production mode, an explicit `WORKBENCH_ALLOWED_HOSTS` allowlist, and a strong Basic Auth password (≥ 16 characters).
- **Defense-in-Depth API Protection:** Strict `Sec-Fetch-Site` + `Origin` CSRF validation, `Content-Security-Policy` (CSP), `X-Frame-Options: DENY`, CLI executable extension validation, and SSRF protection (blocking private/loopback/link-local/cloud-metadata IPs for remote APIs).
- **High-Speed Non-Blocking Engine:** 60-second TTL caching for CLI/PATH discovery, coalesced asynchronous disk persistence, parallelized Git workspace & file-tree indexing, and zero-overhead DOM updates that preserve open menus and cursor selection during live SSE streaming.

---

## 📦 Requirements

- **Windows Desktop Installer users:** No need to install Node.js or npm (the runtime is bundled).
- **Running from source / building the installer:** Node.js **20.19+** and npm.
- **Git:** Required for workspace status inspection, Diff Studio, and isolated Git worktrees / Arena mode.
- **Agents (install any combination you use):**
  - Local CLIs: **Codex CLI**, **Claude Code**, or **Antigravity CLI** (auto-detected at startup).
  - API Providers: **OpenAI**, **Anthropic Claude**, **Google Gemini**, **Ollama**, **LM Studio**, **LocalAI**, or any OpenAI/Anthropic-compatible endpoint configured in **Settings**.

---

## 🚀 Quick Start (From Source)

```sh
git clone https://github.com/BlackOwl242/OpenSybau.git
cd OpenSybau
npm ci
npm run dev
```

Open <http://127.0.0.1:4173> in your browser. On Windows, you can also double-click [`start-workbench.bat`](start-workbench.bat).

To run an optimized production build locally:

```sh
npm ci
npm run build
npm start
```

---

## 🖥️ Build the Windows Desktop Installer (`.exe`)

```powershell
npm ci
npm run desktop:dist
```

- Generates the per-user NSIS installer (`release/OpenSybau-Setup-<version>-x64.exe`) and unpacked desktop bundle (`release/win-unpacked/`).
- Creates Desktop and Start Menu shortcuts, keeps its local server bound to `127.0.0.1`, and stores user data separately in `%APPDATA%\OpenSybau`.
- Checks GitHub Releases for updates in the background.

---

## 📱 Connect from a Phone or Tablet on the Same Wi-Fi (LAN Mode)

1. **Build the production frontend:**
   ```sh
   npm ci
   npm run build
   ```
2. **Find your host computer's LAN IPv4 address** (e.g., `192.168.1.20` via `ipconfig` on Windows or `ip addr` on Linux).
3. **Create `.env` from `.env.example`:**
   ```dotenv
   WORKBENCH_HOST=0.0.0.0
   WORKBENCH_PORT=4173
   WORKBENCH_ALLOWED_HOSTS=192.168.1.20:4173
   WORKBENCH_ACCESS_USERNAME=opensybau
   WORKBENCH_ACCESS_PASSWORD=replace-with-a-random-password-at-least-16-chars
   ```
   *(Tip: generate a strong password with `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"`)*
4. **Allow TCP port `4173` on the Private firewall profile only**, then run:
   ```sh
   npm start
   ```
5. Open `http://192.168.1.20:4173` on your phone and sign in with your configured credentials.

---

## ⚙️ Configuration Reference (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `WORKBENCH_HOST` | `127.0.0.1` | Bind address (`127.0.0.1` for local-only, `0.0.0.0` for LAN/proxy). |
| `WORKBENCH_PORT` | `4173` | HTTP/HTTPS port. |
| `WORKBENCH_ALLOWED_HOSTS` | Localhost aliases | Comma-separated exact `Host` headers allowed when bound to `0.0.0.0`. |
| `WORKBENCH_ACCESS_USERNAME` | `opensybau` | Basic Auth username. |
| `WORKBENCH_ACCESS_PASSWORD` | Unset | Basic Auth password (required ≥ 16 chars for non-loopback binds). |
| `WORKBENCH_DATA_DIR` | `.runtime` | Storage directory for tasks, settings, encrypted/local keys, logs, and Git worktrees. |
| `WORKBENCH_TLS_CERT` / `KEY` | Unset | Optional TLS certificate and private key paths for direct HTTPS. |
| `CODEX_CLI_PATH` | Auto-detected | Optional custom path to Codex CLI executable. |
| `CLAUDE_CLI_PATH` | Auto-detected | Optional custom path to Claude Code executable or `cli.js`. |
| `ANTIGRAVITY_CLI_PATH` | Auto-detected | Optional custom path to Antigravity CLI executable. |
| `ANTHROPIC_API_KEY` | Unset | Optional environment key for the built-in Claude API connector. |
| `WORKBENCH_CLAUDE_MODEL` | Unset | Default model ID for the built-in Claude API connector. |
| `WORKBENCH_API_PROVIDERS` | Unset | Optional JSON array of additional Anthropic/OpenAI-compatible providers. |

---

## 🗂️ Project Structure

```text
desktop/        Electron main process, preload bridge, and desktop icons
src/
  domain/       Workflow, role routing, and task domain models
  features/     Workbench controller, Smart Composer, Diff Studio, and Arena UI
  server/       CLI discovery, API provider registry, and runtime helpers
  shared/       Icons, i18n localization, and shared utilities
  shell/        Frosted-glass app frame, sidebar, and responsive navigation
  styles/       Design tokens, glassmorphism theme, and component styles
server.mjs      Local HTTP/SSE server, task queue, Git worktree manager, and CLI runner
scripts/        Cross-platform launchers and automated integration test suites
public/         Brand assets, logos, and web app manifest
CHANGELOG.md    Version history and release notes
LICENSE         MIT License
```

---

## 🧪 Development & Test Commands

| Command | Description |
| --- | --- |
| `npm ci` | Install locked dependencies. |
| `npm run dev` | Start loopback development server with Vite hot reload. |
| `npm test` | Run CLI detection, startup recovery, and task/worktree integration tests. |
| `npm run build` | Build production frontend into `dist/`. |
| `npm start` | Start production server. |
| `npm run desktop:dist` | Build production frontend and package Windows NSIS installer (`release/`). |

---

## 📄 License

Distributed under the **[MIT License](LICENSE)**. Copyright (c) 2026 **OpenSybau (BlackOwl242)**.
