# Changelog

Tất cả những thay đổi đáng chú ý của dự án **OpenSybau** sẽ được ghi lại tại tệp này.  
All notable changes to **OpenSybau** are documented in this file.

---

## [0.2.101] - 2026-10-21

### English
- **Compact & Mobile-Size Desktop Window Resizing (`desktop/main.cjs`, `src/styles/preset-theme.css`)**:
  - Lower Electron `BrowserWindow` constraints from `minWidth: 960, minHeight: 640` to `minWidth: 360, minHeight: 480` so the desktop window can be freely resized down to phone, split-screen, or compact sidebar dimensions.
  - Preserve the `140px` right-side safe zone on `.wb-window-chrome.is-desktop` at narrow viewports (`<= 740px`) and compact right-hand chrome pills so the native Windows Minimize/Maximize/Close overlay buttons (`titleBarOverlay`) are never covered or blocked.
- **Plain, Natural Language & Elimination of Technical Jargon (`src/domain/task-flow.js`, `src/domain/agent-roles.js`, `src/features/workbench/controller.js`, `src/shared/i18n.js`)**:
  - Replace cryptic/robotic terms (`Chiến dịch Wave DAG` / `Wave DAG Campaign`, `Luồng điều phối`, `6 Trạm`, `Bản ghi điều phối`) with clear, human-friendly phrasing (`Giao việc theo đợt` / `Batch tasks`, `Tiến trình công việc` / `Work progress`, `Bước 1`–`Bước 6` / `Step 1`–`Step 6`, `Chi tiết các bước đã chạy` / `Step-by-step run details`).
  - Simplify the 6-step progress labels to everyday workflow steps: `1. Lên kế hoạch` (`1. Plan`), `2. Duyệt kế hoạch` (`2. Approve plan`), `3. Viết code` (`3. Write code`), `4. Kiểm tra code` (`4. Check code`), `5. Chạy thử` (`5. Test run`), and `6. Gộp vào dự án` (`6. Merge to project`).
- **Full Mobile & Compact Viewport Responsiveness (`src/styles/preset-theme.css`)**:
  - Upgrade responsive layouts across `@media (max-width: 740px)` and `@media (max-width: 560px)` for the 6-step progress bar (`.mc-stations-track` 2-column and 1-column grids), batch task board (`.mc-wave-board`), plan approval banner (`.mc-plan-gate-banner`), horizontal filter strip, composer rail, Arena compare strip, Settings 6-step map, and Knowledge Base topbar.

### Tiếng Việt
- **Thu nhỏ cửa sổ linh hoạt xuống kích thước điện thoại (`desktop/main.cjs`, `src/styles/preset-theme.css`)**:
  - Hạ giới hạn thu nhỏ cửa sổ Electron từ `960x640` xuống `360x480` (`minWidth: 360, minHeight: 480`), cho phép thu gọn cửa sổ ứng dụng xuống kích thước màn hình điện thoại hoặc chia đôi/chia ba màn hình.
  - Giữ vùng đệm an toàn `140px` bên phải thanh tiêu đề `.wb-window-chrome.is-desktop` khi thu hẹp cửa sổ để cụm nút Thu nhỏ / Phóng to / Đóng của Windows không bao giờ bị đè lấp.
- **Ngôn ngữ tự nhiên, gần gũi – Loại bỏ thuật ngữ máy móc (`src/domain/task-flow.js`, `src/domain/agent-roles.js`, `src/features/workbench/controller.js`, `src/shared/i18n.js`)**:
  - Thay thế toàn bộ các cụm từ kỹ thuật khó hiểu (`Chiến dịch Wave DAG`, `Luồng điều phối`, `Trạm 1..6`, `Bản ghi điều phối`) bằng ngôn từ đời thường, dễ hiểu (`Giao việc theo đợt`, `Tiến trình công việc`, `Bước 1..6`, `Chi tiết các bước đã chạy`).
  - Đơn giản hóa tên gọi 6 bước làm việc: `1. Lên kế hoạch`, `2. Duyệt kế hoạch`, `3. Viết code`, `4. Kiểm tra code`, `5. Chạy thử`, `6. Gộp vào dự án`.
- **Nâng cấp toàn diện giao diện Điện thoại & Màn hình nhỏ (`src/styles/preset-theme.css`)**:
  - Tối ưu hóa bố cục responsive (`<= 740px` và `<= 560px`) cho toàn bộ tính năng mới: Thanh 6 bước công việc tự động co thành lưới 2 cột / 1 cột, bảng công việc theo đợt tự xếp chồng gọn gàng, thanh duyệt kế hoạch, thanh lọc trạng thái vuốt ngang mượt mà, thanh công cụ khung nhập lệnh, bảng so sánh Arena và sơ đồ phân vai trong Cài đặt.

---

## [0.2.100] - 2026-10-20

### English
- **Unified 6-Station Pipeline & 3-Role AI Routing (`src/domain/task-flow.js`, `src/domain/agent-roles.js`, `src/features/workbench/controller.js`)**:
  - Unify the 6-station pipeline stepper with the 3-role AI routing configuration so there is zero contradiction: **Stations 1, 3, and 4** are powered by the **3 AI Roles** (`1. Plan` -> Planning AI, `3. Implement` -> Implementation AI, `4. Review` -> Review AI), while **Stations 2, 5, and 6** are **Human & System Checkpoints** (`2. Plan Gate`, `5. QA Runner`, `6. Integrate`) that do not consume an additional AI model.
  - Add station badges (`Station 1/6`, `Station 3/6`, `Station 4/6`) to each role card and a visual 6-station architecture strip inside **Settings → Who plans and who implements**.
- **Clean Status Filter & Monochrome SVG Icons on Flows Board (`workflowPage`)**:
  - Replace the cryptic `Risk: All | S | M | L | ⚡ Critical` filter bar and AI-style `⚡` emoji with a clear, practical status filter (`Show: All | Needs attention | Running | Done`) using monochrome SVG icons.
- **100% Language Consistency Across Vietnamese (`VI`) & English (`EN`) (`src/shared/i18n.js`, `src/features/workbench/controller.js`, `src/shell/shell.jsx`)**:
  - Eliminate mixed English/Vietnamese strings across the Flows board, 6-station stepper, Right Dock, Effort selectors (`Minimal`, `Low`, `Medium`, `Standard`, `High`, `Extra High`, `Max`), Event Log, and Status Bar in both `VI` and `EN` modes.

### Tiếng Việt
- **Đồng bộ hóa Tiến trình 6 trạm với Định tuyến 3 vai trò AI (`src/domain/task-flow.js`, `src/domain/agent-roles.js`, `src/features/workbench/controller.js`)**:
  - Thống nhất hoàn toàn giữa thanh tiến trình 6 trạm và 3 mốc chọn model trong Cài đặt mà không hề mâu thuẫn: **3 trạm AI suy luận** (`Trạm 1/6 · Lập kế hoạch`, `Trạm 3/6 · Triển khai`, `Trạm 4/6 · Đánh giá`) kết hợp cùng **3 cổng kiểm soát của Bạn & Hệ thống** (`Trạm 2/6 · Duyệt kế hoạch`, `Trạm 5/6 · Kiểm thử QA`, `Trạm 6/6 · Tích hợp Git`) không tốn thêm model AI.
  - Gắn nhãn trạm (`Trạm 1/6`, `Trạm 3/6`, `Trạm 4/6`) trực tiếp trên từng thẻ chọn model và bổ sung sơ đồ ánh xạ 6 trạm ngay trong mục **Cài đặt → Ai ra lệnh, ai thực hiện**.
- **Bộ lọc trạng thái trực quan & loại bỏ biểu tượng emoji AI (`workflowPage`)**:
  - Thay thế cụm lọc khó hiểu `Risk: Tất cả | S | M | L | ⚡ Critical` và emoji `⚡` bằng bộ lọc trạng thái thực tế (`Hiển thị: Tất cả | Cần chú ý | Đang chạy | Hoàn tất`) sử dụng biểu tượng vector đơn sắc đồng bộ.
- **Chuẩn hóa 100% ngôn ngữ Tiếng Việt (`VI`) & Tiếng Anh (`EN`) (`src/shared/i18n.js`, `src/features/workbench/controller.js`, `src/shell/shell.jsx`)**:
  - Loại bỏ triệt để tình trạng lẫn lộn Anh – Việt trên toàn bộ màn hình Luồng điều phối, Thanh tiến trình 6 trạm, Thanh công cụ bên phải, Mức suy luận (`Tối thiểu`, `Thấp`, `Trung bình`, `Tiêu chuẩn`, `Cao`, `Rất cao`, `Tối đa`), Nhật ký sự kiện và Thanh trạng thái ở cả hai chế độ `VI` và `EN`.

---

## [0.2.99] - 2026-10-20

### English
- **Orca & Mission Control End-to-End Verification & Schema Alignment (`src/domain/task-flow.js`, `src/features/workbench/controller.js`)**:
  - Align `pipelineStepperData` and `computeWaveDag` data contracts with Mission Control UI views (`wave.tasks`, `wave.index`, `wave.label`, `wave.doneCount`, `dag.needsLookTasks`, `currentRound`, `maxRounds`, normalized cycle telemetry, and `doc::` stage document tab IDs).
  - Add **SVG Bezier Dependency Connectors (`drawWaveDagEdges`)** across Wave columns on the Mission Control DAG Board (`[data-wave-dag-board]`) to visually link `dependsOn` tasks across waves.
  - Add **Plan Gate (`GO`)** toggle pill and **Max Rounds (`R1..R3`)** selector pill directly on the Home Composer rail when in `Code` or `Plan` mode.
- **Live DOM Patching & Multi-Pane Scroll Stability (`src/shared/dom-patch.js`)**:
  - Fix `patchHtml` (`morphdom`) so foreground composer submissions reliably clear active `<textarea>` inputs while background SSE updates preserve drafts, focus, selection ranges, and independent scroll positions per `.multi-chat-pane`.

### Tiếng Việt
- **Hoàn thiện & Kiểm thử toàn diện hệ thống Orca / Mission Control (`src/domain/task-flow.js`, `src/features/workbench/controller.js`)**:
  - Đồng bộ hóa cấu trúc dữ liệu `pipelineStepperData` và `computeWaveDag` với giao diện Mission Control (`wave.tasks`, `wave.index`, `wave.label`, `wave.doneCount`, `dag.needsLookTasks`, `currentRound`, `maxRounds`, chuẩn hóa lịch sử vòng lặp và mã tab `doc::` của Tài liệu Stage).
  - Bổ sung **đường nối phụ thuộc SVG Bezier (`drawWaveDagEdges`)** nối trực tiếp giữa các thẻ task có quan hệ `dependsOn` qua các cột `Wave 1..N` trên bảng Mission Control.
  - Bổ sung nút bật nhanh **Plan Gate (`GO`)** và chọn nhanh **Vòng sửa (`R1..R3`)** ngay trên thanh công cụ Home Composer khi ở chế độ `Code` hoặc `Kế hoạch`.
- **Sửa lỗi cập nhật DOM thời gian thực & cuộn đa khung (`src/shared/dom-patch.js`)**:
  - Khắc phục lỗi `patchHtml` (`morphdom`) giữ lại văn bản cũ sau khi bấm gửi tin nhắn ở foreground, đồng thời bảo toàn tuyệt đối vị trí cuộn độc lập của từng khung chat song song (`.multi-chat-pane`), con trỏ soạn thảo và bộ gõ tiếng Việt khi nhận luồng SSE ngầm.

---

## [0.2.98] - 2026-10-20

### English
- **Unified 6-Station Pipeline Stepper & Ferry Delivery Lifecycle (`src/domain/task-flow.js`, `src/features/workbench/controller.js`)**:
  - Upgrade the conversation pipeline strip and task orchestration view with a 6-station horizontal stepper (`Start` → `Plan review` → `You (Plan Gate)` → `Code review` → `QA` → `Draft PR`), interactive **Stage Documents** (`spec.md`, `plan.md`, `implementation.md`, `review-verdict.md`, `qa-report.md`), and per-cycle telemetry (`Round 1..3`, `blocking`, `advisory`, `turns`, `duration`, `$cost`).
- **Human Plan Gate (`You · GO`) & Multi-Round Autonomous Quality Loop (`server.mjs`)**:
  - Add optional **Human Plan Gate (`planGate`)** that pauses execution (`awaiting_approval`) after planning so you can inspect `plan.md`, leave feedback, and click **Approve & Deploy (GO)** or **Revise Plan**.
  - Add **Multi-Round Autonomous Fix Loop (`maxRounds: 1..3`)** that parses `[BLOCKING]` vs. `[ADVISORY]` review findings and QA test exit codes, automatically feeding failures back into subsequent `Build (fix rN) -> Review -> QA` rounds.
- **Mission Control Wave DAG Board (`/api/tasks/decompose`, `workflowPage`)**:
  - Transform the Flows screen into a **Mission Control Wave DAG Board** with topological wave columns (`Wave 1..N`), `"Needs a look"` human-attention banner, live status counters (`for you`, `running`, `in review`, `ready`, `blocked`, `done`), `Risk S/M/L` and `⚡ Critical` filters, and multi-wave campaign decomposition with automatic `dependsOn` scheduling.
- **Orca Worktree QA Runner, Live Localhost Browser & Quick Git Commit (`orcaRightDockMarkup`)**:
  - Add safe argument-array QA & terminal execution (`/api/tasks/:id/qa`, `npm test`, `npm run build`, `npm run lint`, `git status`, `git diff --stat`), one-click **Quick Git Commit** (`/api/tasks/:id/git-commit`), and **Live Localhost Dev Server Preview** (`:3000`, `:5173`, `:4173`, `:8080`) with DOM Element Inspector inside the unified Stage Viewer.
- **Okapi BM25 Memory Ranking & Auto-Distillation (`server.mjs`)**:
  - Upgrade local memory retrieval (`relevantMemory`) to Okapi BM25 ($k_1 = 1.5, b = 0.75$) with workspace-scope boosting, and automatically distill completed pipeline lessons (`autoDistillTaskMemory`) without duplicate notes.

### Tiếng Việt
- **Thanh tiến trình 6 trạm & Vòng đời tài liệu Stage (`Ferry Lifecycle` + `Orca Stage Viewer`)**:
  - Nâng cấp thanh tiến trình trong khung Chat và màn hình Chi tiết luồng thành **6 trạm trực quan** (`Start` → `Plan review` → `You (Plan Gate)` → `Code review` → `QA` → `Draft PR`), tích hợp cây **Tài liệu Stage** (`spec.md`, `plan.md`, `implementation.md`, `review-verdict.md`, `qa-report.md`) mở trực tiếp trong Stage Viewer cùng thống kê từng vòng lặp (`Round 1..3`, `blocking`, `advisory`, `turns`, thời lượng, chi phí `$cost`).
- **Cổng duyệt Kế hoạch (`Human Plan Gate · You · GO`) & Vòng lặp Tự sửa lỗi đa tầng (`Multi-Round Fix Loop`)**:
  - Cho phép bật **Plan Gate** để tạm dừng sau bước lập kế hoạch (`Chờ duyệt Plan`), giúp bạn đọc `plan.md`, ghi chú điều chỉnh và bấm **Duyệt & Triển khai (GO)** hoặc **Yêu cầu lập lại Plan**.
  - Tự động phân tích lỗi `[BLOCKING]` / `[ADVISORY]` từ Reviewer và kết quả kiểm thử QA để kích hoạt vòng lặp `Round 2..3 · implement (fix r1)` cho đến khi sạch lỗi blocking.
- **Bảng điều hành Mission Control & Chiến dịch Wave DAG (`workflowPage`, `/api/tasks/decompose`)**:
  - Nâng cấp màn hình **Luồng** thành bảng **Mission Control Wave DAG** chia cột `Wave 1..N` theo quan hệ phụ thuộc (`dependsOn`), kèm khu vực **`Needs a look`**, bộ đếm thời gian thực (`for you`, `running`, `in review`, `ready`, `blocked`, `done`), bộ lọc `Risk S/M/L`, `⚡ Critical` và hộp thoại khởi chạy chiến dịch Wave DAG đa tầng.
- **Trình chạy QA/Terminal cô lập, Duyệt Web Localhost trực tiếp & Quick Git Commit**:
  - Bổ sung tab **Tài liệu Stage** và **QA Runner / Terminal / Live Localhost** trên thanh công cụ bên phải: chạy kiểm thử an toàn (`npm test`, `npm run build`, `npm run lint`, `git status`...) trực tiếp trong worktree của task, **Quick Git Commit** nhanh thay đổi, và mở máy chủ dev cục bộ (`http://localhost:3000`, `:5173`...) ngay trong Stage Viewer kèm công cụ chọn phần tử DOM.
- **Xếp hạng Bộ nhớ BM25 & Tự động đúc kết bài học (`BM25 Memory & Auto-Distillation`)**:
  - Nâng cấp thuật toán truy xuất bộ nhớ cục bộ lên **Okapi BM25** có ưu tiên theo dự án, đồng thời tự động đúc kết kinh nghiệm từ các pipeline hoàn tất vào kho bộ nhớ mà không tạo bản ghi trùng lặp.

---

## [0.2.97] - 2026-10-20

### English
- **Unified Modal, Menu & Input Theme Surfaces**: Synchronize modal dialogs (`#overlay .modal`, `.composer-config-dialog`, `.desktop-setup-dialog`, `.multi-chat-create-form`), context menus (`.wb-project-menu`, `.wb-task-menu`, `.codex-pop-card`, `.wb-theme-pop-card`), inner cards (`var(--wb-surface-soft)`), and form fields (`var(--wb-field)`) across all 13 themes, aligning `Obsidian Dark` tokens with warm graphite charcoal while preserving the native acrylic frosted-glass sidebar.
- **Clean Input Borders & Focus States**: Replace bright white (`var(--wb-subtle)`) borders and neon blue focus rings (`rgba(96, 165, 250, 0.65)`) on inputs, dropdowns, and menu buttons with subtle theme-synchronized borders (`var(--wb-border-subtle)` / `var(--wb-border-strong)`), and disable spellcheck red underlines on project/task/skill/vault/provider name inputs.
- **Single-Box Source Folder Input Row**: Fix the double-wrapped nested input box inside `Thư mục nguồn` (`.source-folder-row`) so each folder row renders as a clean single input bar.
- **Sidebar Header Cleanup**: Remove the redundant `+` button next to `OpenSybau` and the search toggle in the left sidebar header.

### Tiếng Việt
- **Đồng bộ màu sắc Modal, Menu và Ô nhập liệu trên toàn bộ 13 chủ đề**: Đồng bộ nền hộp thoại (`#overlay .modal`, `.composer-config-dialog`, `.desktop-setup-dialog`, `.multi-chat-create-form`), menu ngữ cảnh (`.wb-project-menu`, `.wb-task-menu`, `.codex-pop-card`, `.wb-theme-pop-card`), thẻ con (`var(--wb-surface-soft)`) và ô nhập liệu (`var(--wb-field)`), đồng thời chuẩn hóa bảng màu `Obsidian Dark` ấm áp hài hòa với hiệu ứng kính mờ (acrylic frosted glass).
- **Loại bỏ viền trắng gắt & viền xanh dương đậm trên ô input/menu**: Thay thế toàn bộ viền trắng sáng (`var(--wb-subtle)`) và khung focus xanh dương đậm (`rgba(96, 165, 250, 0.65)`) bằng viền mảnh đồng bộ theo từng chủ đề (`var(--wb-border-subtle)` / `var(--wb-border-strong)`), đồng thời tắt gạch chân đỏ kiểm tra chính tả (`spellcheck="false"`) ở các ô đặt tên dự án, hội thoại, kỹ năng, kho tri thức và API.
- **Sửa thiết kế bọc 2 lớp ở ô `Thư mục nguồn` (`.source-folder-row`)**: Gỡ bỏ khung bọc kép bên trong `.source-folder-row` để mỗi dòng thư mục hiển thị gọn gàng như một thanh input thống nhất.
- **Tinh gọn thanh tiêu đề Sidebar**: Loại bỏ nút `+` dư thừa nằm cùng dòng với `OpenSybau` và nút tìm kiếm.

---

## [0.2.96] - 2026-10-20

### English
- Restore the native acrylic frosted-glass sidebar (`--wb-sidebar: rgba(20, 24, 30, .28)`) and translucent shell gradient (`linear-gradient(145deg, rgba(16, 20, 26, 0.62) 0%, rgba(12, 15, 19, 0.68) 100%)`) for the default `Obsidian Dark` (`desktop-glass`) theme.

### Tiếng Việt
- Khôi phục hiệu ứng kính mờ (acrylic frosted glass) trên thanh bên trái (`--wb-sidebar: rgba(20, 24, 30, .28)`) và khung nền trong suốt (`linear-gradient(145deg, rgba(16, 20, 26, 0.62) 0%, rgba(12, 15, 19, 0.68) 100%)`) cho chủ đề mặc định `Obsidian Dark` (`desktop-glass`).

---

## [0.2.95] - 2026-10-20

### English
- **Default Safe Permission Preset**: Change the default execution permission preset across backend APIs and frontend composers from `"full-access"` to `"workspace-write"` (while preserving explicit `"read-only"` and `"full-access"` selections).
- **Multi-Threading, Worktree & Queue Serialization Fixes**:
  - Normalize `busyWorkspaces` lock keys (`workspaceLockKey`) across Windows/POSIX and enforce shared-checkout serialization (`usesSharedCheckout`) when an isolated task's worktree has been applied/cleaned up.
  - Queue follow-up chat messages when a shared-checkout workspace is busy instead of rejecting with `409` or leaving failed turns in `task.chatQueue`, and automatically drain queued chat turns across all waiting tasks when the workspace lock is released.
  - Hold `busyWorkspaces` lock during async `applyTaskWorktree` patch operations, return `appliedFiles` count accurately to the UI toast, and reset `worktreeAppliedAt` when new stage reruns or follow-up chat turns modify worktree files.
  - Prevent Arena fanout (`/api/tasks/fanout`) from permanently overwriting `state.settings.maxConcurrent` in `state.json`, and validate `read-only` / role capabilities consistently.
- **Core Chat/Code Pipeline & CLI Process Lifecycle**:
  - Add `child.stdin` error handling (`EPIPE`/`EOF` guard), a 15-minute CLI inactivity watchdog (`STAGE_IDLE_TIMEOUT_MS`), pipe destruction on `killTree`/`run()` timeouts, `SIGINT`/`SIGTERM` cleanup handlers, and Windows `EPERM`/`EACCES` fallback in `persistJsonFile`.
  - Fix `parseAgyEvent` delta vs. full-message duplication and coalesce consecutive `"output"` delta events in `record()` so streaming output never evicts `"tool"`, `"handoff"`, or `"stage"` events from the 250-event buffer.
  - Fix Claude CLI JSON buffer truncation and `is_error` detection, remove false-positive regex failures on normal `agent_message` text in `parseCodexEvent`, and accumulate `task.usage` token counts across stages and chat turns.
  - Preserve `"done"` task status when stopping a follow-up chat turn on an already-completed task, enrich `makeChatPrompt` with skills, local memory, build/review summaries, and external API workspace context, and deep-clone task state on conversation fork (`/api/tasks/:id/fork`).
- **UI/Theme Synchronization & DOM Performance (`morphdom`)**:
  - Fix sidebar search results rendering raw HTML strings on Preact re-renders (`ContextSidebar.jsx`).
  - Fix opaque modal backdrops (`var(--wb-overlay)`), unify z-index hierarchy (`#overlay` `90`, `.wb-window-chrome` `100`, `#toast` `110`, `.orca-tree-item:has([open])` `30`), add light-theme semantic status tokens (`--wb-*-soft`, `--wb-*-raised`), and replace remaining hardcoded hex colors and `white` mixes with theme tokens.
  - Preserve scroll positions across all scrollable containers (including Split Chat, Code/Diff viewers, Right Dock, and Diff Studio), protect active inputs and Vietnamese IME composition (`[data-skill-inline-editor]`, `[data-chat-drawer-filter]`, comment inputs) during background SSE renders, skip redundant `localizeDom` tree walks in default Vietnamese mode, and memoize Right Dock file tree construction.
- **Security & Electron Hardening**:
  - Isolate raw workspace HTML/SVG previews (`/api/workspaces/:id/raw/*`) with `Content-Security-Policy: sandbox allow-scripts ...` (opaque origin) and `X-Content-Type-Options: nosniff`, and verify `event.source === frame.contentWindow` for Live HTML Inspector messages.
  - Block workspace/temp files from being registered as custom CLI executables, block sensitive system/root directories in workspace/vault/`sourceFolders` registration, enforce `resolveInside` and `allowedTextFile` (`.env` & symlink protection) across `checkDiff`, `/file-diff`, `externalWorkspaceContext`, and `openObsidianUri`, enforce `Content-Type: application/json` on JSON body endpoints, and sanitize `.env` keys and external URI protocols in `desktop/main.cjs`.

### Tiếng Việt
- **Mặc định quyền thực thi an toàn (`"workspace-write"`)**: Chuyển quyền thực thi mặc định trên toàn bộ API backend và khung nhập lệnh frontend từ `"full-access"` sang `"workspace-write"`.
- **Khắc phục lỗi Đa luồng, Khóa Workspace (`busyWorkspaces`) & Git Worktree**:
  - Chuẩn hóa khóa `busyWorkspaces` (`workspaceLockKey`) và bắt buộc áp dụng khóa tuần tự (`usesSharedCheckout`) đối với các task cô lập đã gộp hoặc dọn dẹp worktree.
  - Tự động xếp hàng chờ (`queued`) cho các tin nhắn chat tiếp theo khi workspace đang bận thay vì báo lỗi `409` hoặc chạy lặp các lượt đã lỗi, đồng thời tự động kích hoạt hàng đợi chat ngay khi khóa workspace được giải phóng.
  - Giữ khóa `busyWorkspaces` trong suốt quá trình `applyTaskWorktree`, trả về chính xác số lượng tệp đã gộp trên thông báo UI, và xóa trạng thái `worktreeAppliedAt` khi chạy lại stage hoặc chat làm phát sinh thay đổi mới trong worktree.
  - Ngăn chế độ Đấu trường Song song (`/api/tasks/fanout`) ghi đè vĩnh viễn cài đặt `maxConcurrent` trong `state.json` và đồng bộ kiểm tra quyền `read-only`.
- **Nâng cấp Quy trình Chat/Code & Vòng đời Tiến trình CLI**:
  - Bổ sung bắt lỗi `child.stdin` (`EPIPE`/`EOF`), bộ đếm watchdog 15 phút cho tiến trình CLI treo, đóng luồng pipe khi `killTree`/timeout trên Windows, xử lý tín hiệu `SIGINT`/`SIGTERM`, và cơ chế ghi dự phòng khi gặp lỗi khóa tệp `EPERM`/`EACCES` trên Windows.
  - Khắc phục lỗi nhân đôi văn bản streaming trong `parseAgyEvent` và gộp các sự kiện `"output"` liên tiếp để tránh làm tràn bộ đệm 250 sự kiện (giữ nguyên lịch sử công cụ `"tool"` và `"handoff"`).
  - Sửa lỗi cắt chuỗi JSON và bắt cờ `is_error` của Claude CLI, bỏ regex bắt nhầm nội dung chat của `parseCodexEvent`, và cộng dồn chính xác lượng token (`task.usage`) qua nhiều bước và lượt chat.
  - Giữ nguyên trạng thái `"done"` của task khi bấm dừng một lượt chat phụ, bổ sung đầy đủ ngữ cảnh (`skills`, `memory`, `implementation`, `review`, cây thư mục cho API provider) vào `makeChatPrompt`, và sao chép sâu (`structuredClone`) khi tách nhánh hội thoại (`/api/tasks/:id/fork`).
- **Đồng bộ Giao diện Theme & Tối ưu Hiệu năng DOM (`morphdom`)**:
  - Sửa lỗi hiển thị mã HTML thô ở kết quả tìm kiếm trên Sidebar trái (`ContextSidebar.jsx`).
  - Sửa lớp nền mờ modal (`var(--wb-overlay)`), chuẩn hóa thứ tự `z-index` (`#overlay` `90`, `.wb-window-chrome` `100`, `#toast` `110`, `.orca-tree-item:has([open])` `30`), bổ sung biến màu trạng thái cho các theme sáng (`--wb-*-soft`, `--wb-*-raised`) và thay thế toàn bộ mã màu cố định sang biến theme.
  - Giữ nguyên vị trí cuộn cho mọi vùng cuộn (Split Chat, trình xem Code/Diff, Right Dock, Diff Studio), bảo vệ ô nhập liệu đang gõ và bộ gõ tiếng Việt (Telex/VNI) cùng trình sửa Skill khi có cập nhật SSE ngầm, bỏ lượt duyệt DOM dư thừa của `localizeDom` ở chế độ Tiếng Việt, và lưu đệm cây thư mục Right Dock.
- **Gia cố Bảo mật & Kiến trúc Electron**:
  - Cô lập khung xem trước HTML/SVG (`/api/workspaces/:id/raw/*`) bằng header `Content-Security-Policy: sandbox allow-scripts ...` và kiểm tra `event.source` cho trình Inspector HTML.
  - Chặn sử dụng tệp trong workspace làm tệp thực thi CLI, chặn đăng ký các thư mục hệ thống nhạy cảm làm workspace/vault/`sourceFolders`, chặn đọc symlink và tệp `.env` qua `checkDiff` / `/file-diff` / `externalWorkspaceContext` / `openObsidianUri`, bắt buộc `Content-Type: application/json`, và lọc danh sách biến `.env` cũng như giao thức liên kết ngoài trong `desktop/main.cjs`.

---

## [0.2.94] - 2026-10-19

### English
- Fix Antigravity CLI stream parsing (`parseAgyEvent`) so recoverable intermediate tool errors (e.g., `ContentOffset` validation notices during `view_file` pagination) do not prematurely mark `task.stageFailure` or abort a stage that subsequently finishes with `status === "SUCCESS"`, and reset `task.stageFailure` cleanly at the start of every stage.
- Fix workflow stage status attribution (`orchestrationNodes`) so only the stage that actually failed (`order === failedOrder`) displays as `"failed"`, while subsequent unexecuted stages remain `"pending"` instead of falsely showing `"Lỗi"` simultaneously.
- Fix legacy pale-red highlight boxes (`#fbe9e9`) on `.workflow-node.node-failed em` and `.workflow-node-mark` by unifying workflow node badges, icons, and `.chat-tool-card.is-error` cards with theme-native semantic tokens (`--wb-red`, `--wb-red-soft`).

### Tiếng Việt
- Khắc phục lỗi xử lý luồng tiến trình Antigravity CLI (`parseAgyEvent`) khiến các lỗi công cụ trung gian có thể tự phục hồi (như thông báo vượt `ContentOffset` khi phân trang `view_file`) làm gán nhầm `task.stageFailure` và đánh trượt cả giai đoạn dù tiến trình kết thúc thành công (`status === "SUCCESS"`), đồng thời reset `task.stageFailure` khi bắt đầu mỗi giai đoạn.
- Sửa logic hiển thị trạng thái giai đoạn trong `orchestrationNodes` để chỉ đúng giai đoạn gặp sự cố (`order === failedOrder`) hiển thị `"Lỗi"`, còn các giai đoạn phía sau chưa chạy giữ nguyên trạng thái `"Chưa chạy"` thay vì báo lỗi hàng loạt.
- Xóa bỏ khung nền tô đỏ nhạt (`#fbe9e9`) lạc tông quanh chữ `"Lỗi"` (`.workflow-node.node-failed em` và `.workflow-node-mark`), đồng bộ hoàn toàn màu chữ, biểu tượng trạng thái và thẻ `.chat-tool-card.is-error` theo hệ màu của chủ đề (`--wb-red`, `--wb-red-soft`).

---

## [0.2.93] - 2026-10-19

### English
- Fix `.codex-composer-rail` stacking context so opening a top-rail dropdown never causes the rail's bottom overlap skirt (`margin-bottom: -16px`) to protrude in front of `.home-composer`, while `.codex-pop-card` (`z-index: 60`) still floats cleanly above the composer.
- Unify popover card surface tokens (`--wb-raised` / `--wb-panel`) with the default `Obsidian Dark` desktop-glass palette so dropdowns and popovers match the composer and theme surfaces seamlessly.

### Tiếng Việt
- Khắc phục lỗi ngữ cảnh xếp lớp (`z-index`) của `.codex-composer-rail` khiến phần viền dưới (`margin-bottom: -16px`) bị lòi đè lên khung chat `.home-composer` khi mở menu bật lên, trong khi `.codex-pop-card` (`z-index: 60`) vẫn nổi rõ phía trên.
- Đồng bộ bảng màu bề mặt của các popup/dropdown (`--wb-raised` / `--wb-panel`) với chủ đề mặc định `Obsidian Dark` (kể cả chế độ `desktop-glass`) để tiệp hoàn toàn với màu khung nhập lệnh và giao diện chung.

---

## [0.2.92] - 2026-10-19

### English
- Fix composer top context rail dropdowns (Workspace picker & Task mode picker) so they open upward (`is-up`) instead of downward, and elevate `.codex-composer-rail` stacking context (`z-index`) when a popover is open so menus are never clipped or hidden behind `.home-composer`.

### Tiếng Việt
- Sửa các menu chọn ở thanh ngữ cảnh phía trên khung nhập lệnh (Chọn dự án & Chế độ tác vụ) để luôn bật ngược lên trên (`is-up`) và nâng `z-index` của `.codex-composer-rail` khi mở menu nhằm tránh bị khung nhập lệnh che khuất.

---

## [0.2.91] - 2026-10-19

### English
- Ensure all composer bottom-bar popovers (Execution Permissions, Agent & Model, and Reasoning Effort) open upward above the composer instead of overflowing downward.
- Fix model selection resetting to the initial provider default when sending a message from the home composer or continuing an active chat thread, and persist the latest selected model and effort on the task configuration.

### Tiếng Việt
- Đảm bảo toàn bộ menu bật lên ở thanh dưới của khung nhập lệnh (Quyền thực thi, Agent & Model, Mức suy luận) luôn bật ngược lên trên thay vì xổ xuống dưới.
- Khắc phục lỗi gửi tin nhắn làm model tự động bị reset về model mặc định ban đầu ở cả màn hình chính và trong luồng chat đang mở, đồng thời lưu giữ model và mức suy luận đang chọn cho các lượt chat tiếp theo.

---

## [0.2.90] - 2026-10-19

### English
- Refresh system overview documentation (`README.md` & `README.vi.md`) with clean demo workspace screenshots showcasing `Antigravity Cosmic`, `Synthwave Pulse`, `Daylight Frost`, `Editorial Stone`, and the Settings Theme Gallery.
- Package updated Windows NSIS (`x64`) and Linux (`deb`, `rpm`) installers with the complete 13-theme system and brand asset suite.

### Tiếng Việt
- Cập nhật tài liệu giới thiệu hệ thống (`README.md` & `README.vi.md`) với bộ ảnh chụp giao diện mẫu sạch cho các chủ đề `Antigravity Cosmic`, `Synthwave Pulse`, `Daylight Frost`, `Editorial Stone` và Thư viện Chủ đề trong Cài đặt.
- Đóng gói bản cài đặt Windows NSIS (`x64`) và Linux (`deb`, `rpm`) mới nhất tích hợp đầy đủ hệ thống 13 chủ đề màu và bộ nhận diện thương hiệu.

---

## [0.2.89] - 2026-10-19

### English
- Introduce a 13-theme appearance system spanning Original Dark (`Obsidian Dark`, `Carbon OLED`), Antigravity Chromatic (`Antigravity Cosmic`, `Tokyo Night`, `Synthwave Pulse`, `Catppuccin Mocha`, `Emerald Matrix`, `Rosé Pine`, `Amber Forge`, `Nordic Aurora`), and Elegant Light (`Daylight Frost`, `Editorial Stone`, `Sakura Daylight`).
- Add a quick theme switcher in the top window chrome and a visual Theme Gallery with miniature window previews in Settings, syncing the native desktop titlebar overlay and color scheme.
- Unify CSS surface, border, and contrast tokens across all layout panes, composers, right dock, modals, and knowledge graphs for seamless dark, chromatic, and light rendering.
- Ship complete dark and monochrome brand asset variants alongside the heritage OpenSybau logo.

### Tiếng Việt
- Bổ sung hệ thống 13 chủ đề giao diện (Theme) gồm 3 nhóm: Tối nguyên bản (`Obsidian Dark`, `Carbon OLED`), Đa sắc Antigravity (`Antigravity Cosmic`, `Tokyo Night`, `Synthwave Pulse`, `Catppuccin Mocha`, `Emerald Matrix`, `Rosé Pine`, `Amber Forge`, `Nordic Aurora`) và Sáng thanh lịch (`Daylight Frost`, `Editorial Stone`, `Sakura Daylight`).
- Thêm bộ chuyển nhanh theme trên thanh tiêu đề cửa sổ và Thư viện Chủ đề trực quan kèm khung preview thu nhỏ trong phần Cài đặt, tự động đồng bộ màu thanh tiêu đề native trên bản Desktop.
- Đồng bộ toàn bộ biến màu nền, viền và độ tương phản chữ/icon trên mọi thành phần giao diện (rail, sidebar, khung chat, composer, right dock, modal và đồ thị tri thức) cho cả chế độ tối, đa sắc và sáng.
- Bổ sung trọn bộ biến thể logo bản tối và đơn sắc bên cạnh logo OpenSybau nguyên bản.

---

## [0.2.88] - 2026-10-17

### English
- Update chat and dock content in place instead of recreating it on each task event, preserving drafts, focus, open dropdowns, per-pane scroll positions, and preview documents without changing the interface design.
- Add revision-based state snapshots and conditional requests so unchanged data returns HTTP 304 without retransmitting task history or triggering a render.
- Coalesce background updates and log persistence, pause event-driven fetching in hidden tabs, and add SSE heartbeat, reconnection timing, and slow-client backpressure handling.
- Exclude runtime/worktree and packaging output from development file watching to prevent generated files from triggering page reloads.
- Cache Markdown with a memory bound, localize changed DOM branches, and keep unchanged knowledge graph canvases mounted.
- Add synchronization and DOM regression checks and document the next performance improvements in `docs/performance-plan.md`.

### Tiếng Việt
- Cập nhật nội dung chat và dock tại chỗ thay vì tạo lại sau mỗi sự kiện task, giữ bản nháp, focus, dropdown đang mở, vị trí cuộn từng khung và tài liệu preview; không thay đổi thiết kế giao diện.
- Bổ sung snapshot trạng thái theo revision và yêu cầu có điều kiện: dữ liệu không đổi trả HTTP 304, không truyền lại lịch sử task hoặc render lại.
- Gộp các lượt cập nhật nền và ghi log, tạm ngưng tải theo sự kiện khi tab bị ẩn, bổ sung heartbeat SSE, thời gian nối lại và xử lý backpressure cho client chậm.
- Loại runtime/worktree và đầu ra đóng gói khỏi bộ theo dõi tệp ở môi trường phát triển để tệp sinh ra không kích hoạt tải lại trang.
- Cache Markdown có giới hạn bộ nhớ, chỉ dịch nhánh DOM thay đổi và giữ canvas đồ thị tri thức khi dữ liệu không đổi.
- Bổ sung kiểm tra hồi quy đồng bộ/DOM và ghi phương án tối ưu tiếp theo trong `docs/performance-plan.md`.

---

## [0.2.87] - 2026-10-16

### English
- Keep newly created worktree chats in the parallel split view without reloading workspace state, and provide a stop control while a chat is running.
- Refine the parallel chat picker and setup dialog, including clearer task status, consistent composer styling, and less rounded prompt input corners.
- Remove the running-task count badge beside workspace names.

### Tiếng Việt
- Giữ chat worktree mới ngay trong giao diện chia khung mà không tải lại trạng thái workspace, đồng thời bổ sung nút dừng khi chat đang chạy.
- Tinh chỉnh danh sách chọn chat và hộp cấu hình chat song song, gồm trạng thái tác vụ rõ hơn, ô nhập đồng bộ với composer và giảm độ bo góc.
- Bỏ badge đếm tác vụ đang chạy bên cạnh tên workspace.

---

## [0.2.86] - 2026-10-16

### English
- Create additional worktree chat panes from within the parallel chat view, keeping existing panes open and adding the new chat directly to the split layout.
- Reworked the parallel chat picker and added an in-place chat setup dialog with prompt, agent, model, reasoning, and permission choices.
- Fixed composer controls being clipped at the bottom of narrow split panes by allowing the controls to wrap within each pane.

### Tiếng Việt
- Tạo thêm khung chat worktree ngay trong giao diện đa cửa sổ, giữ nguyên các khung đang mở và thêm chat mới trực tiếp vào bố cục chia khung.
- Thiết kế lại danh sách thêm chat và bổ sung hộp cấu hình ngay tại giao diện chia khung, gồm yêu cầu, agent, model, mức suy nghĩ và quyền truy cập.
- Sửa các nút composer bị cắt ở cuối những khung chat hẹp bằng cách cho phép các điều khiển tự xuống dòng bên trong từng khung.

---

## [0.2.85] - 2026-10-16

### English
- Matched the background of parallel chat panes to the regular conversation view.
- Right-aligned the language control in the web title bar while preserving space for native desktop window controls.
- Limited standard dropdowns to five visible choices, opened them downward, and kept the selected choice in view. Model and reasoning menus retain their flexible direction and list sizing.
- Improved parallel chat tabs and workspace navigation, including clearer chat previews, status indicators, and tree branches.
- Refined task setup, permission controls, modal spacing and typography, and full-panel image previews.

### Tiếng Việt
- Đồng bộ màu nền của các khung chat song song với giao diện cuộc trò chuyện thông thường.
- Đưa nút đổi ngôn ngữ sát mép phải trên thanh tiêu đề web, đồng thời giữ khoảng trống cho nút điều khiển cửa sổ desktop.
- Giới hạn dropdown thông thường còn tối đa 5 lựa chọn nhìn thấy, mở xuống và tự cuộn tới lựa chọn đang dùng. Menu model và mức suy nghĩ giữ cách mở linh hoạt và kích thước danh sách riêng.
- Cải thiện tab chat song song và điều hướng workspace, gồm preview đoạn chat, trạng thái tác vụ và nhánh cây dễ nhìn hơn.
- Tinh chỉnh cấu hình tác vụ, quyền truy cập, khoảng cách và kiểu chữ trong modal, cùng phần xem ảnh toàn khung.

---

## [0.2.83] - 2026-10-15

### Sửa bộ chọn chế độ Chat và giao diện nhập liệu
- Gộp Chat, Code, Kế hoạch và Đa luồng vào một menu chọn gọn; giữ nguyên điều kiện khả dụng của từng chế độ.
- Sửa xung đột tên class khiến menu chế độ nhận nhầm nền trắng, hiện đúng giao diện tối.
- Giữ vị trí chữ trong ô nhập ổn định khi focus và tinh chỉnh khoảng cách, trạng thái chọn trên thanh điều hướng mobile.

---

## [0.2.82] - 2026-10-15

### Cải thiện điều hướng hội thoại, thống kê lượt trả lời và giao diện mobile
- Thêm thanh tóm tắt và điều hướng nhanh theo từng câu trả lời; nhóm các bước trong pipeline vào cùng một mục để số mục khớp với số prompt.
- Ghi nhận thời gian xử lý và số token đầu ra theo từng lượt trả lời khi CLI/API cung cấp usage; bổ sung thống kê usage theo nhà cung cấp và dùng dữ liệu task đã lưu cho các lượt cũ khi có thể đối chiếu.
- Rút gọn thông tin dưới câu trả lời: giữ thời gian và số token, bỏ nhãn “Generated/Đã sinh”; lượt cũ không có token riêng hiển thị `— tokens`.
- Sửa một số bố cục hội thoại trên màn hình nhỏ, điều chỉnh chiều cao composer và bổ sung bản dịch tiếng Anh cho các nhãn điều hướng, thao tác và cài đặt.
- Cải thiện nhãn trợ năng và trạng thái điều hướng/đóng mở ở thanh tiêu đề và sidebar.

---

## [0.2.81] - 2026-10-15

### Sửa chiều cao dropdown trong popup nhận xét HTML
- Giới hạn menu Agent/model ở tối đa 280 px, cuộn bên trong danh sách thay vì kéo dài che nội dung trang.
- Chọn hướng mở theo vùng trống nhưng giữ kích thước menu ngắn gọn, không phủ lên toàn bộ khung xem.

---

## [0.2.80] - 2026-10-15

### Cải thiện trình xem HTML và thao tác chọn phần tử
- Bỏ selector và đường dẫn tệp dư thừa trong popup nhận xét; giữ nhãn phần tử HTML và tiêu đề để giao diện gọn, dễ đọc.
- Dropdown chọn model và mức suy luận tự mở về phía có nhiều không gian hơn, giới hạn chiều cao theo vùng hiển thị và cuộn danh sách khi cần.
- Thay nhãn chữ “Xem/Code” bằng icon Lucide mắt và mã nguồn có hiệu ứng hover; làm rõ trạng thái đang chọn và căn chiều cao với thanh địa chỉ.

---

## [0.2.79] - 2026-10-15

### Fixed & Improved (Hiển Thị Bảng Markdown Trên Chat, Đồng Bộ Khối Hoạt Động Công Cụ, Tối Ưu Bong Bóng Chat Người Dùng, Bỏ Nút Cài Đặt Khung Chat & Thêm Vạch Ngăn Cách Sidebar Trái)
- **Hỗ trợ hiển thị bảng Markdown (`GFM Table`) trong khung Chat & trang Tri thức**:
  - Nâng cấp bộ phân tích `renderMarkdown` (`splitMarkdownTableRow`, `isMarkdownTableDelimiter`) để chuyển đổi cú pháp bảng `| Cột 1 | Cột 2 |` + `|---|---|` thành bảng HTML `.md-table` có khung bo góc, tiêu đề cột rõ ràng và định dạng `code`/`bold` bên trong từng ô.
- **Thiết kế lại khối `Hoạt động công cụ` (`.chat-tool-stream`) đồng bộ tông tối Zinc**:
  - Tự động lọc bỏ chuỗi đường dẫn vỏ `powershell.exe -Command` / `cmd.exe /c` rườm rà để hiển thị nội dung câu lệnh thực thi ngắn gọn, dễ đọc.
  - Thay chữ `"Nhấn để đóng/mở"` bằng biểu tượng mũi tên xoay gọn gàng; thiết kế lại danh sách `Tệp sửa đổi` thành các nhãn đơn dòng (`Tên tệp` + `thư mục`) mở trực tiếp trong trình xem tab.
- **Tối ưu bong bóng tin nhắn người dùng gửi (`.chat-message.from-user`)**:
  - Loại bỏ phần tiêu đề cồng kềnh (`Bạn · model · Fork`) bên trong bong bóng; đưa nội dung tin nhắn vào khung bo tròn gọn gàng `.user-bubble-card` và chỉ hiện nút `Tạo nhánh` nhỏ gọn bên dưới khi di chuột qua.
- **Loại bỏ nút biểu tượng bánh răng cài đặt (`⚙️ .codex-config-gear`) ở góc dưới khung nhập Chat**:
  - Giữ thanh công cụ dưới khung nhập tinh gọn vì bộ chọn Agent/Model và mức suy luận (`Low`/`Medium`/`High`) đã nằm trực tiếp ngay bên cạnh nút gửi.
- **Bổ sung vạch ngăn cách mờ trên thanh điều hướng bên trái (`.wb-rail`)**:
  - Thêm đường kẻ ngang mảnh tinh tế (`rgba(255, 255, 255, 0.12)`) ngăn cách dưới biểu tượng thương hiệu và giữa các cụm nút chức năng (`Làm việc`, `Thư viện`, `Hệ thống`).

---

## [0.2.78] - 2026-10-15

### Fixed & Improved (Tối Ưu Sidebar Phải Theo Từng Trang & Đồng Bộ Triệt Để Font Chữ Hệ Thống)
- **Tối ưu Sidebar phải thông minh theo từng trang (`pageSupportsRightDock` & `getRightDockTabsForPage`)**:
  - **Ẩn hoàn toàn Sidebar phải & nút bật/tắt góc trên bên phải** trên các trang độc lập không cần khung phụ: **Cài đặt (`settings`)**, **Bộ nhớ (`memory`)**, **Công việc (`tasks`)**, **Luồng (`flows`)**, và **Tri thức (`knowledge`)** khi chưa kết nối kho lưu trữ.
  - **Tích hợp thanh lọc phạm vi dự án (`.memory-scope-filters`) trực tiếp vào trang Bộ nhớ (`memory`)**: Cho phép lọc nhanh `Tất cả`, `Dùng chung`, hoặc từng dự án ngay trên trang mà không cần mở Sidebar phải.
  - **Rút gọn các tab chức năng của Sidebar phải đúng với ngữ cảnh từng trang**:
    - **Dự án (`workspaces`)** & **Tác vụ mới (`chat` trang chủ)**: Chỉ hiển thị 2 tab (`Tệp dự án`, `Tìm kiếm tệp`).
    - **Phiên trò chuyện đang mở (`chat` có task)**: Hiển thị đầy đủ 4 tab (`Tệp dự án`, `Tìm kiếm tệp`, `Thay đổi Git & Worktree`, `Mục tiêu & Công cụ phiên`).
    - **Kỹ năng (`skills`)**: Chỉ hiển thị 2 tab (`Danh mục Kỹ năng`, `Tìm kiếm kỹ năng`).
    - **Tri thức (`knowledge` đã kết nối Vault)**: Hiển thị các tab chuyên biệt cho ghi chú (`Cây ghi chú`, `Tìm ghi chú & #tag`, `Liên kết hai chiều & #tag`, và `Mục lục ghi chú` khi đang mở bài viết).
- **Đồng bộ triệt để font chữ `Nunito Sans Variable` trên toàn hệ thống**:
  - Sửa lỗi hộp thoại **Thêm ghi nhớ (`memory`)** bị áp nhầm font monospace (`var(--mono)`) và chiều cao `340px` của trình sửa Skill trên `<textarea name="content">`.
  - Xóa bỏ khai báo cứng `Segoe UI, Arial, sans-serif` trên `.chat-input` và ép đồng bộ `var(--wb-font-sans)` cho toàn bộ `input`, `textarea`, `select`, `::placeholder`, hộp thoại `.modal`, `.vault-editor-textarea`, và thẻ `<code>` nội dòng trên giao diện.

---

## [0.2.77] - 2026-10-15

### Fixed & Improved (Tối Giản Thanh Công Cụ Trình Xem Tệp: Loại Bỏ `Diff` & `@Chèn`)
- **Loại bỏ nút `Diff` và `@Chèn` trên thanh công cụ trình xem tệp (`.orca-viewer-toolbar`)**:
  - Giữ lại duy nhất bộ chuyển đổi tối giản **`Xem` / `Code`** cho các tệp hỗ trợ bản xem trước phong phú (`.html`, `.md`, `.docx`, `.doc`, `.csv`, `.json`), và ẩn hoàn toàn cụm nút phụ trên các tệp chỉ có một chế độ xem để thanh tiêu đề tệp thoáng sạch.
  - Gỡ bỏ hoàn toàn huy hiệu `Diff` trên thanh Tab (`.orca-tab`) và bỏ truy vấn `/file-diff` dư thừa khi mở tab tệp, giúp tốc độ mở tệp tức thì hơn.

---

## [0.2.76] - 2026-10-15

### Fixed & Improved (Thẳng Hàng Tuyệt Đối Các Đường Kẻ Ngang, Tối Giản Trình Xem Tệp Theo Định Dạng & Khắc Phục Lỗi Khuyết Giao Diện Split View)
- **Căn chỉnh thẳng hàng tuyệt đối các đường kẻ phân cách ngang (`y = 40px` & `y = 74px`)**:
  - Khóa chiều cao **Hàng 1** (`.wb-topbar`, `.wb-topbar.orca-tabbar`, `.orca-dock-topbar`, `.kb-pane-head`, `.kb-stage-topbar`) cố định ở đúng **`40px`** và **Hàng 2** (`.orca-viewer-toolbar`, `.orca-dock-subheader`) cố định ở đúng **`34px` một dòng (`flex-wrap: nowrap`)**, giúp các đường viền ngang nối liền mạch từ khu vực chính sang Sidebar phải mà không bị lệch tầng.
- **Tối giản bố cục Trình xem tệp (`.orca-file-viewer`) & Thanh địa chỉ trình duyệt theo đúng định dạng**:
  - Chỉ hiển thị nút **Quay lại (`←`)**, **Tải lại (`↻`)** và **Thanh địa chỉ URL (`http://workspace.local/...`)** khi đang xem trực tiếp tệp trang web **HTML (`.html`, `.htm`)** ở chế độ `Xem`.
  - Đối với các định dạng khác (`.md`, `.docx`, `.doc`, `.pdf`, `.csv`, `.json`, mã nguồn, hình ảnh): chỉ hiển thị đường dẫn tệp gọn gàng cùng thông số (`dòng · dung lượng` hoặc `+thêm / -xóa`) ở bên trái và cụm nút `Xem` / `Code` / `Diff` + `@Chèn` trên cùng 1 hàng duy nhất; loại bỏ hoàn toàn thanh banner phụ `.orca-diff-banner` và thanh nổi `.orca-live-floating-bar` gây che khuất nội dung.
  - Bổ sung bộ giải nén văn bản trực tiếp cho tài liệu Word **`.docx` và `.doc`** (`extractOfficeDocumentText`) để đọc nội dung ngay trong tab mà không bị báo tệp nhị phân.
  - Sửa bố cục khung bình luận dòng code (`.diff-comment-editor`) tự động giãn toàn chiều ngang dễ nhập liệu.
- **Khắc phục lỗi khuyết giao diện ở chế độ Chia đôi màn hình (`.orca-stage-split-layout`)**:
  - Cắt gọn tên Workspace dài trên thanh chọn (`.codex-rail-pill`) bằng dấu `...` trên một dòng và giới hạn kích thước menu nổi (`.codex-pop-card`) để không bị cắt mất mép phải khi mở trong khung chia đôi.

---

## [0.2.75] - 2026-10-15

### Fixed & Improved (Đồng Bộ Hóa Font Chữ Toàn Hệ Thống `Nunito Sans Variable`)
- **Đồng bộ hóa hoàn toàn font chữ giao diện (`--wb-font-sans`)**:
  - Chuyển toàn bộ thanh trạng thái dưới đáy (`.wb-statusbar`: tên dự án tiếng Việt có dấu, trạng thái chạy, thống kê token `5h` / `7d`), nhãn thời gian tương đối cạnh cuộc trò chuyện ở Sidebar trái (`.wb-task-time`: `7g`, `12p`), các huy hiệu số lượng/nhánh trong Sidebar phải (`.orca-tree-badge`, `.kb-degree-pill`, `.kb-section-badge`), thanh địa chỉ tệp (`.orca-address-path`), danh sách tệp Diff và các thẻ công cụ sang dùng chung font hệ thống **`Nunito Sans Variable`** kết hợp `font-variant-numeric: tabular-nums` để chữ tiếng Việt sắc nét và số liệu vẫn thẳng hàng.
  - Chỉ giữ font đơn cách (`--wb-font-mono`) cho nội dung mã nguồn, dòng Diff code và khung soạn thảo Markdown.

---

## [0.2.74] - 2026-10-14

### Added & Improved (Đa Cửa Sổ Tab Kiểu ORCA, Trình Xem Tệp Đa Định Dạng Tức Thì & Chế Độ Chia Đôi Màn Hình Split View)
- **Thanh Đa Cửa Sổ Tab kiểu ORCA (`.orca-tabbar`) & Chế độ Chia đôi màn hình (`.orca-stage-split-layout`)**:
  - Khi bấm vào bất kỳ tệp nào trong Sidebar phải (`Files`, `Search`, `Source Control / Changes`) hoặc các thẻ tệp đính kèm trong cuộc trò chuyện, tệp sẽ được mở ngay thành **Tab cửa sổ riêng** trên thanh `TopBar` (`.orca-tabbar`) kèm vạch nhấn trắng trên đỉnh tab đang mở, biểu tượng định dạng, huy hiệu `Diff` và nút đóng `×`.
  - Hỗ trợ nút **Chia đôi màn hình (`columns-2` Split View)** trên thanh Tab để vừa trò chuyện với Agent ở cột trái vừa xem trực tiếp tệp / bản xem trước / Diff Review ở cột phải, kèm thanh kéo phân cách chỉnh độ rộng linh hoạt (`[data-stage-split-resizer]`).
- **Trình xem tệp thông minh đa định dạng (`.orca-file-viewer`) & Diff Review từng tệp**:
  - **HTML (`.html`, `.htm`)**: Xem trước trang web trực tiếp (`Xem trước`) qua `<iframe class="orca-live-frame">` hỗ trợ đầy đủ đường dẫn tương đối CSS/JS/ảnh qua endpoint `/api/workspaces/:id/raw/<subpath>`, chuyển đổi tức thì sang `Mã nguồn (Code)` hoặc `Diff Review`.
  - **PDF (`.pdf`)**: Mở trực tiếp tài liệu PDF ngay trong tab bằng trình đọc PDF tích hợp (`#toolbar=1&navpanes=1&view=FitH`).
  - **Hình ảnh & Đa phương tiện (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp`, `.mp4`, `.webm`, `.mp3`, `.wav`)**: Khung xem studio sắc nét ngay trong tab.
  - **Markdown (`.md`, `.mdx`), Bảng dữ liệu (`.csv`, `.tsv`) & JSON (`.json`)**: Hỗ trợ chế độ `Xem trước` định dạng đẹp (bảng dữ liệu cố định tiêu đề, JSON kiểm tra cú pháp) song song với `Mã nguồn` và `Diff Review`.
  - **Mã nguồn & Bình luận từng dòng (Inline Line Comment)**: Bấm vào bất kỳ dòng code nào để mở ô ghi chú và gửi yêu cầu chỉnh sửa chính xác dòng đó cho Agent; tích hợp chế độ `Diff Review` (`+` / `-` hunks) cho từng tệp thông qua `/api/workspaces/:id/file-diff`.

---

## [0.2.73] - 2026-10-14

### Fixed & Improved (Sửa Lỗi Bố Cục Sidebar Phải Bị Tràn Xuống Dưới & Loại Bỏ Hoàn Toàn Các Badge `main` / `Codex` Rườm Rà)
- **Khắc phục lỗi bố cục Sidebar phải (`.orca-right-dock`) bị rớt xuống góc dưới bên trái**:
  - Bổ sung class `has-right-dock` trực tiếp vào khung lưới `.wb-workspace-split` và khóa cứng `grid-template-columns: minmax(0, 1fr) var(--right-dock-width, 288px) !important` để Sidebar phải luôn neo chuẩn xác dọc theo cạnh phải của cửa sổ chính.
  - Đồng bộ chiều cao thanh công cụ đỉnh Sidebar phải (`.orca-dock-topbar`, `44px`) khớp tuyệt đối với thanh `TopBar` của khung giữa.
- **Loại bỏ toàn bộ các badge `main`, `Codex` và dòng phụ gây rối mắt trên giao diện**:
  - Xóa hoàn toàn các nhãn nhánh `main` (`wb-project-branch`, `wb-top-branch-pill`, `(main)` ở nút chọn dự án màn hình chính và `StatusBar`).
  - Tinh giản danh sách cuộc trò chuyện ở Sidebar trái thành **1 dòng duy nhất** gọn gàng (`[chấm trạng thái] [Tiêu đề] [thời gian]`), loại bỏ các badge `Codex`, `wt`, `3 tệp thay đổi` và popup preview đè lên danh sách dự án.

---

## [0.2.72] - 2026-10-14

### Changed & Improved (Đồng Bộ Hóa Khung Trò Chuyện Không Viền & Đưa Các Nút Thao Tác Phiên Vào Sidebar Phải)
- **Gộp giao diện cuộc trò chuyện vào khung chat tối giản bình thường (`.task-conversation-page.is-unified-chat`)**:
  - Loại bỏ hoàn toàn thanh tiêu đề lồng ghép `.pane-heading` (`Trò chuyện | Hoàn tất · ... | Quyền | Mục tiêu | N tin nhắn`), thanh `.chat-pipeline-strip` (`Diff & Review`, `Luồng`) và hộp viền xám `.conversation-chat-pane` ở giữa màn hình để giao diện cuộc trò chuyện đồng bộ 100% với màn hình chat chính.
  - Tinh giản thanh `TopBar` phía trên chỉ giữ đường dẫn tiêu đề gọn gàng bên trái và duy nhất nút đóng/mở Sidebar phải (`◨`) ở góc trên bên phải.
- **Đưa toàn bộ các nút điều khiển & thông tin phiên vào Sidebar bên phải có thể kéo giãn (`.orca-right-dock`)**:
  - Chuyển các nút `Diff & Review`, `Luồng điều phối`, `Quyền truy cập`, `Mục tiêu & Checklist`, `Gộp vào dự án`, `Hủy worktree`, `So sánh Đa luồng`, `Mở thư mục` và thông tin trạng thái/token của phiên sang gọn trong Sidebar phải (ở cả menu `⋯`, tab `Source Control / Changes` và tab `Checklist & Công cụ phiên`).
  - Hỗ trợ kéo thanh phân cách bên trái Sidebar phải (`220px` – `620px`) để tùy chỉnh kích thước linh hoạt.

---

## [0.2.71] - 2026-10-14

### Changed & Improved (Sidebar Phải Hợp Nhất 4 Tab kiểu ORCA/Codex, Kéo Giãn Chiều Rộng & Tối Giản Khung Chính Giữa)
- **Hợp nhất thanh bên mở rộng thành 1 Sidebar Phải duy nhất toàn cục (`.orca-right-dock`)**:
  - Đưa nút đóng/mở Sidebar phải (`◨` `sidebar-right`) lên **góc trên cùng bên phải của TopBar** (và góc trên bên phải của chính Sidebar phải khi đang mở), đồng bộ hoàn toàn với thiết kế ORCA / Codex.
  - **Thanh 4 Icon Tab đa năng ở đỉnh Sidebar phải** (kèm vạch gạch chân trắng sắc nét dưới tab đang chọn):
    1. **Cây thư mục & Tệp (`files`)**: Cây thư mục phân cấp đóng/mở (`> 📄 .github`, `v 📄 src`, `📄 package.json`) tự động thích ứng theo ngữ cảnh trang (Tệp dự án trên Chat/Dự án, Ghi chú Markdown trên Tri thức, Nhóm kỹ năng trên Kỹ năng, Phạm vi bộ nhớ trên Bộ nhớ, Mục lục cấu hình trên Cài đặt).
    2. **Tìm kiếm nhanh (`search`)**: Lọc tức thì tệp dự án, ghi chú `#tag` hoặc kỹ năng.
    3. **Source Control & Liên kết (`git-branch`)**: Hiển thị nút `Gộp Worktree vào dự án`, danh sách `CHANGES (N)` và các nhánh Worktree cô lập khi làm việc với dự án, hoặc **Liên kết hai chiều (`[[WikiLink]]`) & `#tags`** khi ở trang Tri thức.
    4. **Checklist & Mục lục (`list-checks`)**: Quản lý Checklist mục tiêu của Task hoặc tự động trích xuất Mục lục (`# H1`, `## H2`) của tài liệu Markdown đang đọc.
- **Tối giản hóa khung nội dung chính ở giữa (`#content`)**:
  - Loại bỏ toàn bộ các sidebar lồng ghép dư thừa bên trong khung giữa của các trang Chat, Dự án, Tri thức, Kỹ năng, Bộ nhớ và Cài đặt để nhường trọn không gian cho nội dung chính (trình đọc/sửa tài liệu, hội thoại, hoặc đồ thị nơ-ron).
- **Hỗ trợ kéo giãn chiều rộng Sidebar bên phải (`220px` – `620px`)**:
  - Bổ sung thanh nắm kéo (`.orca-dock-resizer`) dọc mép trái của Sidebar phải (tự động lưu kích thước vào `localStorage`), đồng thời giữ cố định chiều rộng của Sidebar điều hướng bên trái theo đúng yêu cầu.

---

## [0.2.70] - 2026-10-14

### Fixed & Improved (Sửa lỗi Dropdown bị cắt & Kiến trúc Tri thức 3 Ngăn kiểu Codex / ORCA)
- **Khắc phục triệt để lỗi menu Dropdown (`⋯`) bung ngược lên trên và bị cắt khuất**:
  - Tách riêng hướng bung của menu ngữ cảnh (`.is-down`, `.vault-head-menu`, `.vault-action-menu`) để luôn mở **xuống dưới** (`top: calc(100% + 6px)`), tự động đảo chiều thông minh cho các dòng cuối danh sách và đặt `z-index: 260` để không bao giờ bị mép khung trên che khuất.
- **Tái cấu trúc trang Tri thức theo bố cục 3 ngăn thông minh kiểu Codex / ORCA (`.knowledge-orca-shell`)**:
  - **Sidebar Trái (`Cây ghi chú Vault` — bật/tắt linh hoạt ở cả 2 chế độ)**: Duyệt thư mục, tìm kiếm nhanh theo tên hoặc `#tag`, hiển thị huy hiệu số lượng liên kết trên từng tệp `.md` và giữ nguyên danh sách tệp ngay cả khi đang khám phá Đồ thị.
  - **Khung Chính Giữa (`Ghi chú` / `Đồ thị` tràn viền)**: Thanh công cụ hợp nhất `44px` với nút đóng/mở 2 sidebar trái/phải, bộ chuyển chế độ `Ghi chú` | `Đồ thị`, trình đọc/soạn thảo Markdown tập trung ở chế độ Ghi chú và bảng Đồ thị nơ-ron kèm HUD nổi ở chế độ Đồ thị.
  - **Sidebar Phải (`Liên kết & Ngữ cảnh` — hoạt động ở cả 2 chế độ)**: Hiển thị liên kết hai chiều (`→ Đi` / `← Đến`), các ghi chú liên quan theo `#tag` & thư mục, tự động trích xuất **Mục lục (Outline H1–H4)** kèm thống kê từ/dòng khi đọc ghi chú, hoặc hiển thị **Xem trước nội dung** trực tiếp khi đang duyệt Đồ thị.

---

## [0.2.69] - 2026-10-14

### Changed & Improved (Bộ Icon Lucide-Animated, Menu 3 Chấm File `.md` & Tinh Gọn Giao Diện Tri Thức)
- **Thay thế bộ icon bằng chuẩn Lucide-Animated (`https://lucide-animated.com`)**:
  - Chuyển toàn bộ hệ thống icon từ Hugeicons sang hình học chuẩn Lucide 24×24 sắc nét kèm hiệu ứng chuyển động vi mô (micro-animations) mượt mà trên từng thành phần SVG khi di chuột, đồng thời căn chỉnh lại huy hiệu số lượng (`.wb-rail-count`) ở thanh điều hướng trái để không đè lên nét icon.
- **Menu 3 chấm (`⋯`) mở rộng tùy chọn cho tệp `.md`**:
  - Gộp các thao tác (`Chỉnh sửa ghi chú`, `Xem trên đồ thị`, `Mở trong Obsidian`, `Xóa ghi chú`) vào menu 3 chấm (`⋯`) gọn gàng cả ở từng dòng tệp `.md` trong danh sách bên trái lẫn trên thanh tiêu đề khung xem và bảng chi tiết đồ thị.
- **Làm lại thanh công cụ phía trên và thu gọn bố cục trang Tri thức**:
  - Tinh giản thanh công cụ đầu trang Tri thức chỉ còn 3 cụm đồng bộ chiều cao: Bộ chuyển chế độ (`Ghi chú` / `Đồ thị`), nút `+ Ghi chú mới` và menu `⋯` quản lý Vault (`Mở trong Obsidian`, `Làm mới dữ liệu`, `Đổi thư mục Vault…`, `Ngắt kết nối Vault`).
  - Thu gọn chiều cao khung làm việc Tri thức & Đồ thị vừa khít khung nhìn, loại bỏ các huy hiệu nổi rườm rà và đồng bộ bảng Đồ thị theo đúng chuẩn thiết kế tối giản của hệ thống.

---

## [0.2.68] - 2026-10-14

### Changed (Tinh chỉnh thuật ngữ giao diện: Đổi "Đấu trường" thành "Đa luồng")
- **Đổi tên chế độ "Đấu trường" sang "Đa luồng"**:
  - Cập nhật nhãn nút chuyển chế độ trên thanh công cụ khung chat, tiêu đề khay cấu hình Worktree song song, banner trạng thái trong cuộc hội thoại, hộp thoại so sánh Diff và thông báo hệ thống từ `Đấu trường` sang `Đa luồng` để phản ánh đúng bản chất chạy đa luồng song song trên các nhánh Git worktree cô lập.

---

## [0.2.67] - 2026-10-14

### Added & Fixed (Tri thức Obsidian Vault & Biểu đồ Mạng Nơ-ron Tri thức)
- **Khắc phục lỗi nút "Mở trong Obsidian" không hoạt động**:
  - Bổ sung giao thức `obsidian:` vào danh sách cho phép của Electron (`desktop/main.cjs`) và thêm endpoint `POST /api/vault/open-obsidian` gọi trực tiếp `obsidian://open?path=...` qua trình xử lý giao thức của hệ điều hành để mở đúng vault hoặc tệp ghi chú ngay trong ứng dụng Obsidian.
- **Tạo mới, chỉnh sửa trực tiếp (Inline Editor) và xóa tệp tri thức Markdown**:
  - Hỗ trợ tạo ghi chú `.md` mới (`POST /api/vault/file`), chỉnh sửa trực tiếp nội dung Markdown ngay trong khung xem (`PUT /api/vault/file`, hỗ trợ phím tắt `Ctrl+S` / `Cmd+S`) và xóa tệp ghi chú khỏi vault (`DELETE /api/vault/file`).
  - Hỗ trợ nhấp trực tiếp vào chip liên kết `[[WikiLink]]` trong bài viết để nhảy sang ghi chú liên quan (hoặc tự tạo mới nếu ghi chú đích chưa tồn tại).
- **Biểu đồ Mạng Nơ-ron Tri thức (Neural Knowledge Graph — `GET /api/vault/graph`)**:
  - Tự động phân tích toàn bộ các tệp `.md` trong vault cùng hệ thống liên kết hai chiều `[[WikiLinks]]`, liên kết Markdown nội bộ, thẻ `#tag` chung và cấu trúc thư mục.
  - Trực quan hóa dưới dạng mạng lưới nơ-ron tương tác vật lý lực đẩy/lực hút trên Canvas 2D với hiệu ứng xung tín hiệu synapse chạy dọc các liên kết, hỗ trợ kéo thả nút, phóng to/thu nhỏ, lọc vùng lân cận và bảng Inspector xem/sửa nhanh nút đang chọn.

---

## [0.2.66] - 2026-10-14

### Fixed & Improved (Đồng nhất nút màu trắng, Hiệu ứng Hover, Dọn dẹp & Hotfix đóng gói)
- **Khắc phục lỗi thiếu `src/domain/agent-roles.js` khi khởi động Desktop (`app.asar`)**:
  - Giữ đầy đủ `src/**/*` trong cấu hình `build.files` của `package.json` để `server.mjs` luôn nạp được các module dùng chung tại `src/domain/` và `src/server/`.
- **Thống nhất màu trắng đơn sắc cho toàn bộ nút hành động chính**:
  - Chuyển tất cả các nút chính (`.button.primary`, nút gửi tin nhắn tròn `.home-submit` / `.chat-send-button`, `.arena-preset-btn.is-primary`, `.wb-chrome-pill.is-ready`) sang tông trắng sáng (`#f4f4f5` → `#ffffff` khi hover, chữ đen `#09090b`), loại bỏ hoàn toàn các nút màu xanh rời rạc.
- **Hiệu ứng Hover đổi màu nhẹ, không nảy/bay lên**:
  - Loại bỏ toàn bộ hiệu ứng `transform: translateY(...)` và `transform: scale(...)` khi di chuột qua nút bấm hoặc thẻ trên toàn hệ thống; chỉ chuyển màu nền và viền nhẹ nhàng, đằm mắt.
- **Loại bỏ nốt `scrollbar-color` và `scrollbar-width` còn sót**:
  - Xóa `scrollbar-color: #545454 #2b2c2e` tại `#overlay .modal-body` (`legacy-dark-theme.css`) và `scrollbar-width: thin` tại `.workflow-lane` (`feature-views.css`) để thanh cuộn mảnh 5px hoạt động đồng nhất 100%.
- **Dọn dẹp tệp công cụ dư thừa & các bản cài đặt cũ**:
  - Xóa các tệp không còn sử dụng trong mã nguồn (`public/lucide-icons.js`, `lucide-icons.LICENSE`, `scripts/generate-icons.mjs`) và dọn sạch các bộ cài `.exe` / `.blockmap` cũ trong thư mục `release/` (giải phóng hơn 415 MB dung lượng ổ đĩa).

---

## [0.2.64] - 2026-10-14

### Fixed & Improved (Chuẩn hóa Modal, Nút bấm & Thanh cuộn)
- **Thu gọn & cân đối kích thước các hộp thoại Modal**:
  - Giới hạn kích thước chuẩn cho toàn bộ hộp thoại (`#overlay .modal`, `.composer-config-dialog`, `.desktop-setup-dialog`) ở mức `max-width: 520px` và `max-height: min(600px, calc(100dvh - 88px))` kèm khoảng đệm ngoài thoáng đãng, không còn bị tràn sát mép trên/dưới cửa sổ ứng dụng.
  - Sắp xếp lại biểu mẫu trong modal **"Thêm nguồn AI"** và **"Task mới"** theo bố cục lưới 2 cột (`.modal-grid-2`), rút gọn khoảng cách và số dòng `textarea` để hiển thị gọn gàng trong một khung nhìn.
- **Loại bỏ thanh cuộn Windows cổ điển thô kệch**:
  - Xóa thuộc tính `scrollbar-color` trên `body` và `.app-dialog-content` vốn khiến Chromium/Electron vô hiệu hóa `::-webkit-scrollbar` và quay về thanh cuộn Windows mặc định có nút mũi tên `▲`/`▼` và nền xám dày.
  - Áp dụng thanh cuộn nổi siêu mảnh (`5px`, nền trong suốt, bo tròn dạng viên thuốc, ẩn hoàn toàn mũi tên hai đầu) đồng nhất trên mọi trang và hộp thoại.
- **Đồng bộ hóa hệ thống nút bấm (`.button`, `.icon-button`) và ô nhập liệu**:
  - Chuẩn hóa chiều cao, độ bo góc, viền kính mờ, hiệu ứng hover/focus và màu nút chính (`#2563eb`) giữa tất cả các modal, thẻ cài đặt (`.settings-card`) và thanh công cụ.

---

## [0.2.63] - 2026-10-14

### Fixed & Improved (Giao diện & Tài liệu)
- **Menu Quyền thực thi của Agent (Agent Execution Permissions)**:
  - Loại bỏ nút *"Tìm hiểu thêm"* thừa ở góc phải tiêu đề popover.
  - Chuẩn hóa lại tên gọi và mô tả 3 mức quyền riêng biệt của OpenSybau:
    1. **Chỉ đọc an toàn** (`read-only`): *Chỉ phân tích mã nguồn và trả lời, không tự ý sửa tệp trong dự án.*
    2. **Đọc & sửa trong dự án** (`workspace-write`): *Cho phép đọc, chỉnh sửa tệp và chạy công cụ trong phạm vi workspace.*
    3. **Toàn quyền thực thi** (`full-access`): *Tự động chạy lệnh, cài gói và thao tác tệp trên máy không giới hạn.*
  - Khắc phục triệt để lỗi CSS khiến chữ tiêu đề (`<strong>`) và mô tả phụ (`<small>`) bị dính liền trên cùng một dòng; tách thành 2 dòng rõ ràng, dễ đọc.
- **Tài liệu & Giấy phép**:
  - Viết lại toàn bộ `README.md` (Tiếng Anh) và `README.vi.md` (Tiếng Việt) phản ánh kiến trúc giao diện kính mờ mới, Đấu trường song song đa nhánh (2–8 Git worktrees), cơ chế bảo mật và hiệu năng mới.
  - Bổ sung tệp `CHANGELOG.md` chính thức và giấy phép nguồn mở `LICENSE` (MIT).

---

## [0.2.62] - 2026-10-14

### Added & Changed (UI/UX)
- **Popover chọn quyền thực thi ngay dưới khung chat**:
  - Thay thế nút bấm xoay vòng quyền thủ công bằng menu popover mở hướng lên (`.codex-perm-menu`) ở cả màn hình Home và màn hình Hội thoại Task.
- **Hạ thấp vị trí khung nhập liệu (Bottom-Docked Composer)**:
  - Loại bỏ khoảng đệm đáy dư thừa trong `.command-stage` và ẩn thanh trạng thái tĩnh ở trang Home để khung chat bám sát cạnh dưới cửa sổ một cách cân đối.

---

## [0.2.61] - 2026-10-14

### Security (Bảo mật hệ thống)
- **Chống CSRF đa tầng trên `/api/*`**: Kiểm tra nghiêm ngặt header `Sec-Fetch-Site` (chặn mọi request `cross-site`) kết hợp xác thực `Origin` đối với mọi phương thức thay đổi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Security Headers toàn cục**: Bổ sung `Content-Security-Policy` (CSP), `X-Frame-Options: DENY` và `Referrer-Policy: no-referrer` trên toàn bộ phản hồi HTTP.
- **Ràng buộc tệp thực thi CLI**: Kiểm tra định dạng phần mở rộng (`.exe`, `.cmd`, `.bat`, `.ps1`, `.mjs`, `.js`, `.cjs`) khi cấu hình đường dẫn thủ công tại `/api/connectors/claude/path` và `/api/connectors/antigravity/path`.
- **Cô lập biến môi trường `ELECTRON_RUN_AS_NODE`**: Xóa bỏ thiết lập toàn cục trên tiến trình chính Electron (`desktop/main.cjs`), tránh làm ảnh hưởng các ứng dụng con như VS Code hoặc trình duyệt khi mở từ OpenSybau; chỉ truyền biến này khi gọi trực tiếp binary Node đi kèm.
- **Chống SSRF mở rộng**: Chặn thêm dải địa chỉ link-local/cloud metadata (`169.254.x.x`, `fe80::/10`, `0.0.0.0`, `metadata.google.internal`) đối với các API provider từ xa.
- **Chống XSS**: Escape đầy đủ thuộc tính `workspace.id` trong modal và siết biểu thức chính quy liên kết Markdown trong `renderMarkdown()`.

### Performance (Chống lag & Tối ưu tốc độ)
- **Bộ nhớ đệm (TTL Cache 60s) cho dò tìm CLI & Windows Registry**: Loại bỏ tình trạng gọi đồng bộ `reg.exe` và `where.exe` liên tục làm nghẽn Event Loop trên Windows.
- **Gom nhóm ghi đĩa (Coalesced Persistence)**: Thay thế `persist()` ghi đĩa tức thời trên mỗi dòng log `record()` bằng `schedulePersist(60)` và lược bỏ nội dung thô của tệp đính kèm (`attachments[].content`) khỏi gói tin SSE `publicState()`.
- **Quét Workspace & File song song**: Chạy `Promise.all` khi kiểm tra Git workspace lúc khởi động và khi `fs.stat` danh sách tệp; bổ sung bỏ qua các thư mục nặng (`release`, `out`, `target`, `.venv`, `venv`, `.cache`, `.turbo`).
- **Tối ưu DOM Render & Giữ trạng thái Popover/Con trỏ**: Bỏ qua bước quét dịch DOM (`localizeDom`) khi ngôn ngữ đang là Tiếng Việt gốc (`0ms`); bảo toàn các menu popover đang mở và vị trí con trỏ khung chat khi nhận dữ liệu thời gian thực qua SSE.

---

## [0.2.55 - 0.2.60] - 2026-10-14

### Added & Changed
- **Đồng bộ nhận diện thương hiệu OpenSybau**: Thay thế biểu tượng tại màn hình chính bằng emblem hai nút kết nối đặc trưng của OpenSybau; khắc phục lỗi biến chiếu trong `desktop/main.cjs`.
- **Menu chọn Agent/Model & Mức suy luận (Reasoning Effort) tự chế**:
  - Thay thế thẻ `<select>` mặc định của hệ điều hành bằng menu kính mờ mở hướng lên (`.codex-pop-menu`), có thanh cuộn mảnh gọn và không bao giờ tràn khỏi đáy cửa sổ.
- **Tinh gọn thanh bên trái (Sidebar)**:
  - Loại bỏ các mục điều hướng trùng lặp, giữ lại hệ thống điều hướng tối giản, danh sách dự án theo nhóm và bộ lọc trạng thái tác vụ.
- **Khung ứng dụng Kính mờ (Frosted Glass Shell) & Khung nhập liệu 2 tầng**:
  - Tích hợp hiệu ứng kính mờ (`backdrop-filter` + Windows Mica/Acrylic) cho thanh bên trái và bo góc nổi cho khung nội dung chính.
  - Thiết kế khung nhập liệu thông minh 2 tầng: Thanh ngữ cảnh phía trên (Chọn dự án, Môi trường `Máy tính này` / `Git Worktree`, Chế độ `Chat` / `Code` / `Kế hoạch` / `Đấu trường`) gắn liền với thẻ nhập liệu bo tròn phía dưới.
- **Đấu trường Đa nhánh Song song (Multi-Slot Worktree Arena)**:
  - Hỗ trợ chạy song song từ **2 đến 8 nhánh Git Worktree cô lập** cho cùng một yêu cầu, cho phép chạy **nhiều bản của cùng 1 model** (`2× Cùng model`, `3× Cùng model`) hoặc phối hợp **đa hãng** (Codex, Claude Code, Antigravity, API) tương tự Orca.
