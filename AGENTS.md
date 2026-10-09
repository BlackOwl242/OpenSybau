# OpenSybau project notes

- Keep the first version local-first and easy to run without a service stack. Default to loopback; support network access only in production mode with an explicit host allowlist and strong Basic Auth.
- Never seed example task, token, or memory records into the operational UI. Show an empty state when there is no local data.
- Read provider-specific model and reasoning choices from the installed CLI catalog at runtime.
- Persist task origin, workspace, stage output, and events so the user can inspect every run.
- Serialize shared-checkout tasks per workspace. Allow concurrent work in that workspace only through separate Git worktrees.
- Invoke CLI executables with argument arrays (never a shell-built user command), and restrict task execution to registered workspaces. Never expose network mode without authentication and host/origin validation.
- Do not add an orchestration framework until a concrete workflow needs it.
