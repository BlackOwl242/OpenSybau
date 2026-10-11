# OpenSybau

**A local-first control center for coding agents.** OpenSybau organizes workspaces, conversations, agent workflows, and execution activity in one browser-based interface. Tasks run on the computer that hosts OpenSybau through its configured local CLIs and API providers.

**Documentation:** [Tiếng Việt](README.vi.md)

**Windows desktop app:** OpenSybau can also be packaged as a per-user Windows installer. The desktop app bundles its runtime, keeps its local server bound to `127.0.0.1`, and stores configuration and task data under your Windows user profile.

> OpenSybau is designed for one trusted operator or a small private network. It is not a multi-tenant service. Do not expose it to the public internet without HTTPS and access controls.

## Highlights

- Manage multiple local workspaces and conversations from one interface.
- Route planning, implementation, and review independently between the installed Codex, Antigravity, and Claude Code CLIs.
- Add Anthropic/OpenAI-compatible API providers in Settings, including local Ollama, LM Studio, and LocalAI endpoints.
- Follow task stages, agent events, outputs, and workspace changes as they happen.
- Rename conversations, queue multiple messages in order, copy their original request, pin, archive, and restore them; optionally isolate task work in Git worktrees.
- Group projects into sections, pin projects, and open project folders on the host.
- Browse local skills and knowledge, and keep notes for later tasks.
- Use the responsive interface in a mobile browser; install it on the home screen as a web app when served over HTTPS.
- Keep execution, CLI credentials, workspace files, and task history on the host computer.

## Requirements

- End users of the Windows desktop installer do not need to install Node.js or npm.
- To run from source or build the installer: Node.js **20.19 or newer** and npm.
- Git for workspace inspection and optional isolated worktrees.
- At least one supported provider installed and configured on the host. Codex CLI, Antigravity CLI, and Claude Code are optional local coding agents; install only the agents you plan to use.
- API providers are optional and can be configured in Settings or with environment variables. They can chat, plan, review, or implement bounded text-file changes from the project context supplied by OpenSybau; they cannot run workspace tools.
- Workspace folders must be available on the host computer.

Windows, macOS, and Linux can host OpenSybau. Install and authenticate each CLI under the operating-system account that will run the server.

## Build the Windows desktop installer

On Windows, install dependencies and create the NSIS installer:

```powershell
npm ci
npm run desktop:dist
```

The installer is written to `release/`. It installs for the current Windows user and creates Start menu and desktop shortcuts. On first launch, OpenSybau checks Codex CLI, Claude Code, and Antigravity CLI; install only the agents you want to use, then select **Quét lại**. You can also configure API providers from the setup guide. OpenSybau does not silently install third-party agents.

The desktop app keeps its server on `127.0.0.1`. Use the browser-host setup below when you want a phone or another computer to connect over a local network.

User settings, API configuration, conversations, and task data are stored in `%APPDATA%\OpenSybau` and remain separate from the app installation directory.

## Quick start

```sh
git clone https://github.com/BlackOwl242/OpenSybau.git
cd OpenSybau
npm ci
npm run dev
```

Open <http://127.0.0.1:4173>. Development mode listens on the local computer only and enables Vite hot reload. On Windows, [`start-workbench.bat`](start-workbench.bat) is a launcher shortcut.

To run an optimized production build locally:

```sh
npm ci
npm run build
npm start
```

The production server also defaults to local-only access. Network access must be explicitly configured and authenticated.

## Connect from a phone on the same Wi-Fi

This makes the computer running OpenSybau the host. Keep that computer on and connected to the network while using the phone.

### 1. Build the app on the host computer

```sh
npm ci
npm run build
```

### 2. Find the host computer's local IP address

On Windows, open PowerShell or Command Prompt and run:

```powershell
ipconfig
```

Under the active **Wi-Fi adapter**, note its **IPv4 Address**, for example `192.168.1.20`. On macOS, find the Wi-Fi address in System Settings → Network. On Linux, run `ip addr` and check the active network adapter.

### 3. Configure LAN access

In the project folder on the host, copy the example configuration and edit it:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set the following values. Replace the sample IP with the IPv4 address you just found, and choose a unique password of at least 16 characters:

```dotenv
WORKBENCH_HOST=0.0.0.0
WORKBENCH_PORT=4173
WORKBENCH_ALLOWED_HOSTS=192.168.1.20:4173
WORKBENCH_ACCESS_USERNAME=opensybau
WORKBENCH_ACCESS_PASSWORD=replace-with-your-own-long-random-password
```

`WORKBENCH_ALLOWED_HOSTS` must match the address (and port, if present) that you enter in the phone's browser. If the computer's IP changes, update this value.

### 4. Allow the app through the host firewall

Allow inbound TCP port **4173** on the **Private** network profile only. On Windows, create an inbound rule in Windows Defender Firewall → Advanced settings → Inbound Rules. Do not enable the rule for Public networks. If this is your trusted home Wi-Fi but Windows classifies it as Public, change that Wi-Fi connection to the Private profile in Settings first; never do this on public Wi-Fi.

### 5. Start OpenSybau and open it on the phone

On the host computer:

```sh
npm start
```

On the phone, join the same Wi-Fi and open `http://192.168.1.20:4173`, replacing the example IP with your host's address. When prompted, enter the username and password from `.env`.

The phone gets a mobile layout with a bottom navigation bar and a slide-out workspace/chat list. You can use the link directly in the browser. For a home-screen app shortcut, serve the app through HTTPS and choose **Add to Home Screen** in the browser menu. The installed shortcut still needs a network connection to the host.

### If the phone cannot connect

1. Confirm the host and phone are on the same non-guest Wi-Fi. Guest networks often block devices from reaching each other.
2. Check that `npm start` is still running on the host.
3. Confirm the URL uses the host's current IPv4 address and port `4173`.
4. Check that `WORKBENCH_ALLOWED_HOSTS` contains the exact browser host, such as `192.168.1.20:4173`.
5. Check that the firewall rule allows port `4173` on the Private profile.

## Remote access over the internet

For access outside the home or office network, use a hosting platform, HTTPS tunnel, or reverse proxy that provides TLS. Configure `WORKBENCH_HOST=0.0.0.0`, the port required by the host, an exact `WORKBENCH_ALLOWED_HOSTS` value matching the public `Host` header, and a strong `WORKBENCH_ACCESS_PASSWORD`. Preserve the original `Host` header through the proxy. Keep OpenSybau authentication enabled even if the host provider has its own login page.

Do not expose the app to the public internet over plain HTTP or forward a router port to an unauthenticated server. The public endpoint must use HTTPS and should be restricted to trusted users. OpenSybau's Basic Auth is a shared operator credential, not individual user accounts or role-based access.

The host must support a persistent Node.js process and provide access to the installed CLIs and workspace files. Many short-lived or serverless platforms do not meet these requirements. OpenSybau executes tasks on the host; it does not copy projects or CLI sign-in from your computer to the host. Each installation has its own data unless you deliberately configure shared storage.

Plain HTTP is suitable only for a trusted private LAN because credentials and task data are not encrypted in transit. For a local network that is shared or untrusted, configure direct HTTPS by setting both `WORKBENCH_TLS_CERT` and `WORKBENCH_TLS_KEY`, or place the server behind a TLS-enabled proxy.

## Configuration reference

Copy `.env.example` to `.env`. The `.env` file is ignored by Git and must never contain secrets that are committed to the repository.

| Variable | Default | Description |
| --- | --- | --- |
| `WORKBENCH_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN or host-platform access. Non-loopback binds require production mode, a host allowlist, and a password. |
| `WORKBENCH_PORT` | `4173` | Port for the HTTP or HTTPS server. |
| `WORKBENCH_ALLOWED_HOSTS` | Localhost aliases | Comma-separated exact `Host` values allowed by the server, e.g. `192.168.1.20:4173` or `opensybau.example.com`. |
| `WORKBENCH_ACCESS_USERNAME` | `opensybau` | Username shown in the browser's Basic Auth prompt. |
| `WORKBENCH_ACCESS_PASSWORD` | Unset | Enables Basic Auth. Required with at least 16 characters for network access. |
| `WORKBENCH_DATA_DIR` | `.runtime` | Directory for settings, task history, memory, task output, and Git worktrees. Relative paths resolve from the project folder. |
| `WORKBENCH_TLS_CERT` | Unset | Path to the TLS certificate. Set together with `WORKBENCH_TLS_KEY`. |
| `WORKBENCH_TLS_KEY` | Unset | Path to the TLS private key. Keep the key private. |
| `CODEX_CLI_PATH` | Auto-detected | Optional path to the Codex executable. |
| `ANTIGRAVITY_CLI_PATH` | Auto-detected | Optional path to the Antigravity executable. |
| `CLAUDE_CLI_PATH` | Auto-detected | Optional path to Claude Code, including its `cli.js` entry point. |
| `ANTHROPIC_API_KEY` | Unset | Optional secret for the built-in Claude API connector. Read from the host environment only. |
| `WORKBENCH_CLAUDE_MODEL` | Unset | Model ID to expose in the Claude API connector. |
| `WORKBENCH_CLAUDE_MODELS` | Unset | Optional comma-separated list or JSON array of Claude API model IDs. |
| `WORKBENCH_CLAUDE_BASE_URL` | `https://api.anthropic.com/v1` | Optional Anthropic-compatible API base URL. Must use HTTPS except localhost. |
| `WORKBENCH_API_PROVIDERS` | Unset | Optional JSON array defining up to 12 additional API connectors. Settings can also manage up to 20 local API providers. |

### Provider routing and API setup

Each task can choose a separate provider, model, and reasoning setting for **Plan**, **Build**, and **Review**. This supports arrangements such as Claude planning → Codex implementation → Antigravity review, provided those local CLIs are installed and available. The defaults are editable in **Settings**, and each new task can override them. Chat also has its own provider selection. Add API endpoints directly in **Settings → Sources and models**; enter one model ID per line. Local Ollama, LM Studio, and LocalAI endpoints can use HTTP on `localhost` without an API key. Cloud endpoints must use HTTPS.

Local CLIs can inspect the registered workspace and use their own tools. Claude Code is optional; install and sign it in on the host, or set `CLAUDE_CLI_PATH` if automatic discovery does not find it.

The built-in Claude API connector appears after setting a key and model in `.env`:

```dotenv
ANTHROPIC_API_KEY=your-key
WORKBENCH_CLAUDE_MODEL=your-model-id
```

To register another endpoint, set its secret separately and define a provider as one-line JSON. For example:

```dotenv
EXAMPLE_API_KEY=your-key
WORKBENCH_API_PROVIDERS='[{"id":"example-api","name":"Example API","protocol":"openai-compatible","baseUrl":"https://api.example.com/v1","apiKeyEnv":"EXAMPLE_API_KEY","models":["your-model-id"]}]'
```

Use `protocol: "anthropic"` for an Anthropic Messages-compatible endpoint or `protocol: "openai-compatible"` for a Chat Completions-compatible endpoint. Each provider needs a unique lowercase ID, an HTTPS `baseUrl` (HTTP is allowed only for localhost), and one or more model IDs. Environment-managed API keys are read from the environment. Keys entered in Settings are stored in a separate local file under `WORKBENCH_DATA_DIR`; they are never returned to the browser or saved in task settings. Enter a key from localhost or over HTTPS. Restart OpenSybau after changing `.env`.

API providers can run chat, planning, review, and implementation. They receive the task prompt and the context OpenSybau supplies; planning and review may include workspace paths, project manifests, diffs, or selected source snapshots. For implementation, the model returns a structured list of complete text-file contents, which OpenSybau validates and writes inside the selected workspace. API implementation is limited to 40 files and 1 MB of text per task; it cannot run commands or inspect files beyond the context sent with the request. **That context leaves the host and goes to the configured API provider.** Choose a local CLI when a task needs direct workspace inspection, tool execution, broader repository context, or iterative changes.

Only configure API services that you trust. Provider billing, data retention, and privacy terms are controlled by that service.

All app routes, static assets, APIs, and live event streams are protected when a password is configured. The server validates allowed hosts and same-origin browser requests. Development mode is restricted to loopback.

## Data and execution model

- The Node.js server owns task scheduling, persistence, CLI processes, and live updates. The Preact/Vite frontend is served by that same server.
- Task records, settings, notes, event history, provider configuration and keys, and task output are stored in `WORKBENCH_DATA_DIR` (or `.runtime` by default). Back up this directory to preserve them, and protect it as you would other local credentials.
- Standard tasks modify their selected workspace directly and are serialized per shared workspace. Git worktree mode uses a separate worktree when the repository has at least one commit; it does not merge changes automatically.
- Every task stores its selected provider/model per role. CLI providers perform workspace work according to their own permission mode; API providers implement bounded text-file edits from the supplied context and do not run workspace tools.
- A task can modify files in its selected workspace. Review the task output and Git diff before using the changes.
- “Open folder” opens the native file manager on the host computer. A phone browser cannot open the host's file manager.

## Project structure

```text
src/
  domain/       Workflow and task domain logic
  features/     Workbench pages and actions
  shared/       Shared state, helpers, and UI primitives
  shell/        App frame, navigation, sidebars, and responsive mobile nav
  styles/       Design tokens, shell styles, and feature styles
server.mjs      Local API, task runtime, CLI and static-file server
scripts/        Cross-platform development/production launcher
public/         Static assets, icons, and web app manifest
.runtime/       Local task data (ignored by Git)
```

## Development commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked dependencies. |
| `npm run dev` | Start loopback-only development mode with Vite hot reload. |
| `npm run build` | Create the optimized frontend in `dist/`. |
| `npm start` | Serve the production build and local API. |

To stop the server, press `Ctrl+C` in its terminal. Inspect the workspace before rerunning tasks interrupted by a server shutdown.
