# <img src="public/opensybau.svg" alt="OpenSybau Logo" width="36" height="36" align="top" /> OpenSybau

**A local-first multi-agent coding workbench & parallel Git worktree arena.**  
OpenSybau brings **Codex CLI**, **Claude Code**, **Antigravity CLI**, and **Anthropic / OpenAI-compatible APIs** (including Ollama, LM Studio, and LocalAI) into a unified frosted-glass desktop and browser interface. Every task, chat, and Git worktree executes directly on your machine with full transparency and zero cloud lock-in.

**Documentation:** [Tiếng Việt](README.vi.md) · **Changelog:** [CHANGELOG.md](CHANGELOG.md) · **License:** [MIT](LICENSE)

---

## 🖼️ System Overview

### 1. Home Workbench & Two-Tier Smart Composer
![Home Workbench & Two-Tier Smart Composer](docs/screenshots/home-composer-workbench.png)

### 2. Unified Chat, GFM Markdown Tables & Side-by-Side Split Code Viewer
![Unified Chat, Markdown Tables & Split Code Viewer](docs/screenshots/chat-split-review.png)

### 3. Knowledge Vault & Interactive Neural Link Graph
![Knowledge Vault & Neural Graph](docs/screenshots/knowledge-vault.png)

### 4. Agent Skills Library & Context-Aware Sidebar
![Agent Skills Library & Context-Aware Sidebar](docs/screenshots/skills-library.png)

---

## ✨ Core Highlights

### 1. Frosted-Glass Desktop Experience & Smart Two-Tier Composer
- **Windows Mica / Frosted-Glass Shell:** Native translucent navigation rail with subtle section dividers and a floating rounded main stage.
- **Two-Tier Bottom-Docked Composer:**
  - **Top Context Rail:** Switch workspaces (`Dự án`), toggle execution isolation between **Local Checkout (`Máy tính này`)** and **Isolated Git Worktree (`Git Worktree`)**, and switch work modes (**Chat**, **Code**, **Plan**, **Multi-Thread (`Đa luồng`)**).
  - **Bottom Control Bar with Upward Popovers:** Custom upward-opening glass popovers for **Agent & Model**, **Reasoning Effort** (`Low` / `Medium` / `High` / `Max`), file/image attachments (`+`), and **Agent Execution Permissions**:
    - 🛡️ **Safe Read-Only (`Chỉ đọc an toàn`):** Analyze code and reply without modifying workspace files.
    - 🧑‍💻 **Read & Edit Project (`Đọc & sửa dự án`):** Read, edit files, and run tools scoped to the active workspace.
    - ⚡ **Full Execution Access (`Toàn quyền`):** Unrestricted command execution, package installation, and file operations on your machine.

### 2. Multi-Window File Tabs, Split Review & Page-Aware Right Sidebar
- **Orca-Style Multi-Tab & Side-by-Side Split View:** Open any workspace file directly from the right file tree or from changed file pills inside a chat message. View Chat and File Preview side by side with a draggable splitter.
- **Rich Native Format Previews:**
  - **HTML (`Xem trước` / `Mã nguồn`):** Live sandboxed iframe with an address bar (`Back`, `Reload`, path badge) or numbered source code.
  - **Markdown & `.docx` Word Documents:** Formatted preview or raw source toggle.
  - **PDF, Images, Audio, Video & CSV/TSV Spreadsheets:** Native embedded media players and rendered tabular grids.
- **Context-Aware Right Dock:** Automatically adapts its tabs per page (`Tệp`, `Tìm`, `Nhánh Git`, `Mục lục` in Chat/Workspace; `Kho ghi chú`, `Tìm`, `Đồ thị`, `Mục lục` in Knowledge Vault; `Kỹ năng`, `Tìm` in Skills; and auto-hides on standalone utility pages like Workflows, Token Usage, Memory, and Settings).

### 3. Unified Chat Stream, GFM Tables & Tool Activity Accordion
- **GFM Markdown Tables & Code Blocks:** Full GitHub-Flavored Markdown table parsing with horizontal scroll wrappers, inline code badges, and syntax-styled code blocks.
- **Clean Tool Activity Stream (`Hoạt động công cụ`):** Collapsible Zinc-Dark tool stream that automatically strips noisy shell wrappers (`powershell.exe -Command`, `cmd.exe /c`) and displays clickable file artifact pills.
- **Multi-Thread Parallel Worktree Arena (`Đa luồng`):** Spawn 2 to 8 isolated Git worktrees simultaneously for the same prompt (same model or multi-vendor) and merge the winning branch in one click.

### 4. Knowledge Vault, Neural Graph & Agent Skills
- **Local Markdown Knowledge Vault (`Tri thức`):** Connect any local Markdown or Obsidian folder, edit notes with `[[WikiLinks]]` and `#tags`, and explore connections via an interactive force-directed **Neural Graph**.
- **Skills & Memory Management (`Kỹ năng` & `Bộ nhớ`):** Browse installed CLI/IDE skills, create custom project `SKILL.md` definitions, and filter persistent agent memories by workspace scope.

### 5. Hardened Security & Zero-Lag Runtime
- **Local-First & Loopback by Default:** Binds to `127.0.0.1` by default. Network/LAN mode requires production mode, an explicit `WORKBENCH_ALLOWED_HOSTS` allowlist, and a strong Basic Auth password (≥ 16 characters).
- **Defense-in-Depth API Protection:** Strict `Sec-Fetch-Site` + `Origin` CSRF validation, `Content-Security-Policy` (CSP), `X-Frame-Options: DENY`, argument-array CLI invocation, and SSRF protection.

---

## 📦 Requirements

- **Windows Desktop Installer users:** No need to install Node.js or npm (the runtime is bundled).
- **Running from source / building the installer:** Node.js **20.19+** and npm.
- **Git:** Required for workspace status inspection and isolated Git worktrees / Arena mode.
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
docs/           System screenshots and documentation assets
src/
  domain/       Workflow, role routing, and task domain models
  features/     Workbench controller, Smart Composer, File Tab Viewer, and Arena UI
  server/       CLI discovery, API provider registry, and runtime helpers
  shared/       Icons, i18n localization, and shared utilities
  shell/        Frosted-glass app frame, navigation rail, and context sidebar
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
