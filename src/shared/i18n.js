const LANGUAGE_KEY = "opensybau.language";

const english = {
  "OpenSybau · Chat": "OpenSybau · Chat",
  "Điều hướng OpenSybau": "OpenSybau navigation",
  "Mở workspace và cuộc trò chuyện": "Open workspaces and chats",
  "Workspace và chat": "Workspaces and chats",
  "Bản ghi điều phối": "Orchestration log",
  "Mở bản ghi điều phối": "Open orchestration log",
  "Mở thư mục workspace": "Open workspace folder",
  "Làm mới dữ liệu": "Refresh data",
  "Công việc": "Tasks",
  "Luồng": "Flows",
  "Dự án": "Projects",
  "Tri thức": "Knowledge",
  "Kỹ năng": "Skills",
  "Bộ nhớ": "Memory",
  "Cài đặt": "Settings",
  "Thêm": "More",
  "Gần đây": "Recent",
  "Đã lưu trữ": "Archived",
  "Workspace": "Workspace",
  "Tìm cuộc trò chuyện": "Search chats",
  "Tìm task, chat hoặc workspace": "Search tasks, chats, or workspaces",
  "Cuộc trò chuyện mới": "New chat",
  "Đang đọc dữ liệu…": "Loading data…",
  "OpenSybau · đang khởi động…": "OpenSybau · starting…",
  "Đóng danh sách workspace": "Close workspace list",
  "Đang đọc trạng thái Codex, Antigravity và workspace trên máy…": "Loading Codex, Antigravity, and local workspace status…",
  "Chưa có workspace": "No workspaces yet",
  "Thêm workspace": "Add workspace",
  "Chưa có cuộc trò chuyện": "No chats yet",
  "Thao tác với": "Actions for",
  "Bỏ ghim": "Unpin",
  "Ghim": "Pin",
  "Sửa dự án": "Edit project",
  "Section": "Section",
  "Mở trong Explorer": "Open in Explorer",
  "Lưu trữ chat": "Archive chats",
  "Gỡ dự án": "Remove project",
  "Thao tác dự án": "Project actions",
  "Đóng danh sách": "Close list",
  "Bỏ ghim chat": "Unpin chat",
  "Ghim chat": "Pin chat",
  "Khôi phục chat": "Restore chat",
  "Cấu hình tác vụ": "Task configuration",
  "Đóng": "Close",
  "Hủy": "Cancel",
  "Xong": "Done",
  "Thêm nguồn": "Add source",
  "Thêm nguồn AI": "Add AI source",
  "Thêm / kết nối CLI agent": "Add / connect a CLI agent",
  "Kết nối CLI agent": "Connect CLI agent",
  "Thêm Codex, Antigravity hoặc Claude CLI": "Add Codex, Antigravity, or Claude CLI",
  "Thêm / kết nối CLI": "Add / connect CLI",
  "OpenSybau tự dò CLI trên máy chủ": "OpenSybau automatically detects CLIs on the host",
  "OpenSybau tự dò công cụ đã cài. Nếu chưa đăng nhập, ứng dụng mở terminal giúp bạn; không cần API key hay endpoint.": "OpenSybau detects installed tools. If a CLI needs authentication, it opens a terminal for you. No API key or endpoint is required.",
  "CLI đã cài và đăng nhập sẽ tự xuất hiện trong danh sách nguồn AI, không cần thêm endpoint. Nếu chưa cài, mở hướng dẫn của hãng rồi quét lại; nếu chưa đăng nhập, bấm Bắt đầu đăng nhập để mở terminal.": "Installed and authenticated CLIs appear automatically in the AI source list; no endpoint is needed. If one is missing, follow the vendor's install guide and scan again. If it needs authentication, choose Start sign-in to open a terminal.",
  "CLI dùng tài khoản riêng, không cần API key. Nếu bạn dùng OpenSybau từ điện thoại, terminal sẽ mở trên máy chủ; hoàn tất đăng nhập tại máy đó rồi bấm Quét lại.": "CLIs use their own accounts and do not need API keys. When using OpenSybau from a phone, the terminal opens on the host computer. Finish signing in there, then select Scan again.",
  "Quét lại": "Scan again",
  "Hướng dẫn cài": "Installation guide",
  "Tài liệu chính thức": "Official documentation",
  "Cách đăng nhập": "How to sign in",
  "Cách kết nối": "How to connect",
  "Sẵn sàng": "Ready",
  "Chưa cài": "Not installed",
  "Cần đăng nhập": "Sign-in required",
  "Cần kiểm tra": "Needs attention",
  "Bắt đầu đăng nhập": "Start sign-in",
  "Mở terminal đăng nhập": "Open sign-in terminal",
  "Mở CLI để kiểm tra": "Open CLI to check",
  "Terminal được mở trên máy đang chạy OpenSybau. Hoàn tất OAuth hoặc đăng nhập ở đó rồi chọn Quét lại; CLI không cần khai báo API key riêng.": "The terminal opens on the computer running OpenSybau. Complete OAuth or sign in there, then scan again. CLI providers do not need a separate API key.",
  "Chưa kết nối nguồn AI nào": "No AI source connected",
  "Thêm API/model local hoặc cài, đăng nhập CLI. Sau đó bạn có thể gán riêng model lập kế hoạch, triển khai và review.": "Add an API or local model, or install and sign in to a CLI. Then assign separate models for planning, implementation, and review.",
  "Kết nối API / model local": "Connect API / local model",
  "Ai ra lệnh, ai thực hiện": "Choose who plans and who implements",
  "Chọn model lập kế hoạch (ra lệnh), model triển khai (thực hiện) và model review. Mỗi task vẫn có thể dùng bộ model khác.": "Choose models for planning, implementation, and review. Each task can still use its own model setup.",
  "Lập kế hoạch": "Plan",
  "Triển khai": "Implementation",
  "Review": "Review",
  "Agent cục bộ": "Local agent",
  "Agent hội thoại": "Chat agent",
  "Agent": "Agent",
  "Model": "Model",
  "Mức suy nghĩ": "Reasoning effort",
  "Chưa có provider sẵn sàng": "No provider is ready",
  "Chưa có agent khả dụng": "No agent available",
  "Chưa có model": "No model available",
  "Không áp dụng": "Not applicable",
  "API ngoài · trả nội dung tệp": "External API · returns file content",
  "API ngoài · gửi ngữ cảnh": "External API · receives context",
  "API bên ngoài · không có quyền workspace": "External API · no workspace access",
  "Khi chọn model API, yêu cầu và ngữ cảnh dự án tương ứng sẽ được gửi tới dịch vụ đó. Model CLI chạy cục bộ theo quyền của CLI.": "When you choose an API model, the request and relevant project context are sent to that service. CLI models run locally with the permissions of their CLI.",
  "Lưu định tuyến agent mặc định": "Save default agent routing",
  "PREFERENCES & MODELS": "PREFERENCES & MODELS",
  "Chọn model mặc định cho từng vai trò và kết nối nguồn AI dùng chung cho các task.": "Choose default models for each role and connect shared AI sources for tasks.",
  "Nguồn API và model local": "API and local model sources",
  "Kết nối OpenAI/ChatGPT API, Google Gemini API, Claude API, Ollama, LM Studio hoặc endpoint tương thích.": "Connect the OpenAI/ChatGPT API, Google Gemini API, Claude API, Ollama, LM Studio, or a compatible endpoint.",
  "Chưa có API hoặc model local": "No API or local model connected",
  "Chọn cấu hình nhanh để nhập API key và model, hoặc kết nối Ollama/LM Studio. Bạn không cần API nếu dùng CLI.": "Choose a preset to enter an API key and models, or connect Ollama/LM Studio. You do not need an API to use a CLI.",
  "Thêm API hoặc model local": "Add API or local model",
  "Hướng dẫn kết nối cloud và model local": "Cloud and local model setup guide",
  "Tác vụ chạy đồng thời": "Concurrent tasks",
  "Giới hạn số task có thể chạy cùng lúc trên các workspace.": "Limit how many tasks can run at the same time across workspaces.",
  "Giới hạn hiện tại": "Current limit",
  "Giảm task chạy đồng thời": "Decrease concurrent tasks",
  "Tăng task chạy đồng thời": "Increase concurrent tasks",
  "Tạo việc thật trong repository bạn chọn, xem tiến độ và đầu ra trực tiếp.": "Run real work in a repository you choose and follow progress and output.",
  "Tạo task": "Create task",
  "Thêm dự án": "Add project",
  "Đang chạy": "Running",
  "Đang chờ": "Queued",
  "Hoàn tất": "Completed",
  "Tất cả": "All",
  "Chờ": "Queued",
  "Lỗi": "Error",
  "Đã dừng": "Stopped",
  "Dữ liệu lấy từ task đã chạy trong OpenSybau này.": "Data from tasks run in this OpenSybau instance.",
  "Hoạt động · 24 giờ": "Activity · 24 hours",
  "Đang nhận cập nhật": "Live updates connected",
  "Đang kết nối lại": "Reconnecting",
  "Cập nhật": "Updates",
  "Cảnh báo / lỗi": "Warnings / errors",
  "Di chuột vào cột để xem số liệu theo giờ": "Hover over a bar to see hourly details",
  "Chưa có sự kiện task trong 24 giờ qua.": "No task events in the last 24 hours.",
  "Không có task trong bộ lọc này": "No tasks match this filter",
  "Chưa có task nào được chạy": "No tasks have run yet",
  "Thêm repository của bạn để bắt đầu": "Add a repository to get started",
  "Chọn bộ lọc khác để xem task.": "Choose another filter to see tasks.",
  "Task tiếp theo sẽ chạy trong đúng workspace đã đăng ký và lịch sử sẽ được lưu cục bộ.": "The next task will run in its registered workspace and its history will be stored locally.",
  "OpenSybau chỉ chạy trong thư mục bạn chỉ định. Hãy thêm đường dẫn repository hoặc thư mục ứng dụng trước; thư mục cài đặt ứng dụng không được tự coi là dự án của bạn.": "OpenSybau only runs in folders you select. Add a repository or project folder first; the application install folder is never treated as your project.",
  "Tạo task đầu tiên": "Create your first task",
  "Thêm đường dẫn dự án": "Add project folder",
  "Task chạy bằng provider bạn chọn; lịch sử và bản ghi được lưu cục bộ.": "Tasks use your selected provider; history and logs are stored locally.",
  "Chỉ các đường dẫn bạn thêm mới được đưa vào bộ điều phối.": "Only folders you add are available to the orchestrator.",
  "Mở dự án": "Open project",
  "Gỡ workspace": "Remove workspace",
  "Chưa có dự án": "No projects yet",
  "Thêm đường dẫn repository hoặc thư mục làm việc trên máy.": "Add a repository path or working folder on this computer.",
  "Task chạy ở đâu?": "Where do tasks run?",
  "Chế độ thường sửa trực tiếp thư mục này và chỉ cho một task chạy trong cùng workspace tại một thời điểm. Chế độ Git worktree tạo nhánh riêng; cần repository đã có commit. Task trên các workspace khác nhau có thể chạy song song.": "Standard mode edits this folder directly and runs one task per workspace at a time. Git worktree mode creates an isolated branch and requires an existing commit. Tasks in different workspaces can run in parallel.",
  "Thư mục gốc": "Root folder",
  "Không có tệp khớp bộ lọc.": "No files match this filter.",
  "Thư mục trống.": "This folder is empty.",
  "Chọn một tệp để xem": "Select a file to preview",
  "Mở trong Obsidian": "Open in Obsidian",
  "Danh sách dự án": "Project list",
  "Tệp dự án": "Project files",
  "Tải lại tệp": "Reload files",
  "Lọc tệp trong thư mục này…": "Filter files in this folder…",
  "Thư mục cha": "Parent folder",
  "Đã giới hạn 500 mục; lọc tên hoặc mở thư mục con.": "Showing up to 500 items. Filter by name or open a subfolder.",
  "Chọn tệp code hoặc Markdown để xem nội dung": "Select a code or Markdown file to preview",
  "Tệp Markdown đang trống.": "This Markdown file is empty.",
  "Tệp văn bản": "Text file",
  "Kết nối vault để duyệt và đọc ghi chú Markdown trực tiếp trên máy.": "Connect a vault to browse and read Markdown notes on this computer.",
  "Chưa kết nối Obsidian vault": "No Obsidian vault connected",
  "OpenSybau chỉ đọc thư mục bạn chỉ định; nội dung không được đưa vào prompt tự động.": "OpenSybau only reads the folder you choose. Its contents are not added to prompts automatically.",
  "Kết nối vault": "Connect vault",
  "Ngắt vault": "Disconnect vault",
  "Đổi vault": "Change vault",
  "Ghi chú": "Notes",
  "Tải lại ghi chú": "Reload notes",
  "Tìm ghi chú trong thư mục này…": "Search notes in this folder…",
  "Chọn ghi chú để đọc · không nạp tự động vào AI": "Select a note to read · not sent to AI automatically",
  "Xem, tạo và quản lý hướng dẫn cho đúng CLI; không sửa trực tiếp file do plugin sở hữu.": "Browse, create, and manage CLI instructions. Plugin-owned files are not edited directly.",
  "Tạo skill": "Create skill",
  "Có thể chỉnh sửa": "Editable",
  "Chỉ đọc từ plugin/CLI": "Read-only · managed by plugin/CLI",
  "Xem": "View",
  "Sửa": "Edit",
  "Xóa": "Delete",
  "Sao chép để sửa": "Copy to edit",
  "Chưa có skill nào": "No skills found",
  "Tìm skill…": "Search skills…",
  "Ghi chú lưu trong máy này. Task chỉ nhận tối đa ba ghi chú có từ khóa phù hợp.": "Notes stored on this computer. Each task receives at most three matching notes.",
  "Thêm ghi nhớ": "Add memory",
  "Chưa có ghi nhớ lưu": "No saved memories",
  "Dùng chung": "Shared",
  "Chế độ làm việc": "Work mode",
  "Bạn muốn làm gì?": "What would you like to do?",
  "Bắt đầu một cuộc trò chuyện hoặc giao việc cho các agent đang chạy trên máy.": "Start a chat or assign work to agents on this computer.",
  "Chưa có agent sẵn sàng": "No agents are ready",
  "Kết nối API/model local hoặc cài và đăng nhập Codex, Claude Code hay Antigravity để bắt đầu.": "Connect an API/local model, or install and sign in to Codex, Claude Code, or Antigravity to get started.",
  "Mở cài đặt": "Open settings",
  "Hướng dẫn": "Guide",
  "Cần agent có quyền làm việc trên workspace": "An agent with workspace access is required",
  "Bắt đầu một cuộc trò chuyện": "Start a chat",
  "Tự chọn skill": "Auto-select skills",
  "Cấu hình workspace, agent và model": "Configure workspace, agent, and model",
  "Workspace, agent, model và mức suy nghĩ": "Workspace, agent, model, and reasoning effort",
  "Gửi tin nhắn": "Send message",
  "Chạy task": "Run task",
  "Thêm workspace để bắt đầu": "Add a workspace to get started",
  "Skill tự chọn": "Auto-selected skills",
  "Tối đa": "Up to",
  "task song song": "parallel tasks",
  "Trò chuyện": "Chat",
  "Bạn": "You",
  "Đang xử lý…": "Working…",
  "Nhắn tiếp trong cuộc trò chuyện này…": "Continue this conversation…",
  "Đổi agent, model hoặc mức suy nghĩ": "Change agent, model, or reasoning effort",
  "Cuộc trò chuyện này chưa có nội dung hiển thị. Gửi tin nhắn để tiếp tục với agent trong workspace.": "This chat has no messages yet. Send a message to continue with an agent in this workspace.",
  "Không có task hoặc workspace phù hợp.": "No matching tasks or workspaces.",
  "Task và chat": "Tasks and chats",
  "Không có bản ghi luồng": "No flow records yet",
  "Bản ghi điều phối sẽ xuất hiện tại đây khi một cuộc trò chuyện hoặc task được tạo trong workspace.": "Orchestration records appear here when a chat or task is created in a workspace.",
  "Đầu ra agent": "Agent output",
  "Xem đầu ra đầy đủ": "View full output",
  "Xem đầu ra stage": "View stage output",
  "Xem tệp thay đổi": "View changed files",
  "Các sự kiện sẽ xuất hiện khi task được chạy.": "Events appear here when a task runs.",
  "Điều phối & hoạt động": "Orchestration & activity",
  "Chỉ hiện hoạt động, handoff, đầu ra và công cụ được CLI ghi nhận. Suy luận nội bộ của model không được cung cấp.": "Shows activity, handoffs, outputs, and tools recorded by the CLI. Private model reasoning is not exposed.",
  "Tệp thay đổi": "Changed files",
  "Skill đã chọn": "Selected skills",
  "Đã lưu": "Saved",
  "Điều phối đang hoạt động": "Orchestration is active",
  "Đang hoạt động": "Active",
  "Luồng thực thi": "Execution flow",
  "Task mới": "New task",
  "Mẫu tác vụ": "Task templates",
  "Lưu cấu hình luồng, quyền và agent/model theo từng phiên bản.": "Save workflow, permissions, and agent/model settings as versions.",
  "Mẫu đã lưu": "Saved template",
  "Không dùng mẫu": "No template",
  "Tên mẫu": "Template name",
  "Ví dụ: Review pull request": "e.g. Review a pull request",
  "Áp dụng": "Apply",
  "Lưu phiên bản": "Save version",
  "Xóa mẫu": "Delete template",
  "Không lưu yêu cầu, workspace hoặc trạng thái Git. Chọn mẫu rồi bấm Áp dụng để nạp cấu hình.": "Requests, workspaces, and Git state are not saved. Select a template and apply it to load its settings.",
  "Nguồn mẫu": "Template source",
  "Tệp từ lần chạy trước": "Files from the previous run",
  "Chạy lại từ": "Rerun from",
  "Lịch sử chạy lại": "Rerun history",
  "Kế hoạch": "Plan",
  "Chạy lại chat": "Retry chat",
  "Không có đầu ra cũ cho giai đoạn này.": "No previous output was saved for this stage.",
  "… phần cuối đã được rút gọn trong lịch sử.": "… the remainder was shortened in history.",
  "Đã áp dụng mẫu. Hãy kiểm tra cấu hình trước khi tạo task.": "Template applied. Review its settings before creating the task.",
  "Task đã vào hàng đợi từ giai đoạn đã chọn.": "Task queued from the selected stage.",
  "Mẫu tác vụ không còn khả dụng. Hãy tải lại danh sách mẫu.": "This task template is no longer available. Reload the template list.",
  "Nhập tên mẫu trước khi lưu.": "Enter a template name before saving.",
  "Chọn mẫu cần xóa trước.": "Select a template to delete first.",
  "Đã xóa mẫu tác vụ.": "Task template deleted.",
  "Tên mẫu cần từ 1 đến 80 ký tự.": "Template names must contain 1–80 characters.",
  "Cấu hình mẫu tác vụ không hợp lệ.": "Task template settings are invalid.",
  "Luồng trong mẫu tác vụ không hợp lệ.": "The workflow in this task template is invalid.",
  "Preset quyền trong mẫu không hợp lệ.": "The permission preset in this template is invalid.",
  "Mẫu tác vụ đã thay đổi hoặc bị xóa. Hãy chọn lại mẫu trước khi tạo task.": "This task template changed or was deleted. Select it again before creating the task.",
  "Gửi chỉ dẫn": "Send instructions",
  "Cuộc trò chuyện": "Chat",
  "Mở workspace": "Open workspace",
  "Task thật đã vào hàng đợi.": "Task added to the queue.",
  "Đã gửi tin nhắn cho agent.": "Message sent to the agent.",
  "Đã lưu định tuyến agent mặc định trên máy.": "Saved default agent routing on this computer.",
  "Đã lưu nguồn AI. API key chỉ được giữ trên máy này.": "AI source saved. The API key is stored only on this computer.",
  "Đã nhận tin nhắn; timeline sẽ cập nhật khi agent xử lý.": "Message received. The timeline will update as the agent responds.",
  "Đã lưu ghi nhớ trên máy.": "Memory saved on this computer.",
  "Đã tạo skill trên máy.": "Skill created on this computer.",
  "Đã cập nhật SKILL.md.": "SKILL.md updated.",
  "Đã kết nối Obsidian vault.": "Obsidian vault connected.",
  "Tên nguồn cần tạo được ID gồm chữ hoặc số.": "The source name must produce an ID containing letters or numbers.",
  "Đã kiểm tra và thêm workspace thật.": "Workspace verified and added.",
  "Đã cập nhật tên và thư mục nguồn của dự án.": "Project name and source folders updated.",
  "Đã chuyển dự án sang section.": "Project moved to the section.",
  "Task được đưa lại vào hàng đợi.": "Task added back to the queue.",
  "Đã lưu trữ chat.": "Chat archived.",
  "Đã khôi phục chat.": "Chat restored.",
  "Đổi tên": "Rename",
  "Đổi tên chat": "Rename chat",
  "Tên chat": "Chat name",
  "Lưu tên": "Save name",
  "Đã đổi tên chat.": "Chat renamed.",
  "Thao tác chat": "Chat actions",
  "Sao chép yêu cầu": "Copy request",
  "Đã sao chép yêu cầu ban đầu.": "Initial request copied.",
  "Chat này chưa có yêu cầu để sao chép.": "This chat has no request to copy.",
  "Đã chuyển": "Moved",
  "task sang Đã lưu trữ.": "tasks to Archived.",
  "Chưa có provider nào sẵn sàng": "No providers are ready",
  "Bắt đầu sử dụng": "Get started",
  "Tiếp tục thiết lập sau": "Set up later",
  "Kết nối AI cho workspace": "Connect AI to your workspace",
  "THIẾT LẬP": "SETUP",
  "OpenSybau kiểm tra các CLI trên máy đang chạy ứng dụng. Chọn một cách kết nối phù hợp; bạn không cần cài tất cả và vẫn có thể thiết lập sau.": "OpenSybau checks for CLI tools on the computer running the app. Choose one connection method; you do not need to install every tool and can set this up later.",
  "provider sẵn sàng": "provider ready",
  "Bạn có thể bắt đầu ngay. Khi cần, thêm CLI, API hoặc model local trong Cài đặt.": "You can get started now. Add CLI tools, APIs, or local models in Settings whenever you need them.",
  "Máy này chưa có kết nối sẵn. Bạn có thể cài một CLI hoặc thêm OpenAI, Gemini, Claude API hay model local trong Cài đặt.": "No AI connection is ready on this computer. Install a CLI or add an OpenAI, Gemini, Claude API, or local model in Settings.",
  "Nếu CLI chưa cài, mở hướng dẫn chính thức. Nút đăng nhập mở terminal trên máy chạy OpenSybau; sau khi đăng nhập, bấm Quét lại. CLI không cần API key riêng.": "If a CLI is missing, open its official installation guide. Sign-in opens a terminal on the computer running OpenSybau. After signing in, scan again. CLIs do not need a separate API key.",
  "Nút đăng nhập mở terminal trên máy chạy OpenSybau.": "Sign-in opens a terminal on the computer running OpenSybau.",
  "OpenSybau · thiết lập": "OpenSybau · setup",
  "Chưa có sự kiện": "No events yet",
  "Thư mục này chưa có tệp.": "This folder has no files.",
  "Tệp không tồn tại.": "File not found.",
  "Đường dẫn thư mục nguồn": "Source folder path",
  "Gỡ thư mục này": "Remove this folder",
  "Thư mục chính không thể gỡ": "The primary folder cannot be removed",
  "Thêm thư mục": "Add folder",
  "Thư mục nguồn": "Source folders",
  "Task thường có quyền đọc/ghi các thư mục nguồn. Task tách worktree chỉ dùng workspace chính.": "Standard tasks can read and write source folders. Worktree tasks use only the primary workspace.",
  "Lưu thay đổi": "Save changes",
  "Chuyển section": "Move to section",
  "Tên section": "Section name",
  "Chọn section có sẵn hoặc nhập tên mới để tạo.": "Choose an existing section or enter a new name.",
  "Lưu section": "Save section",
  "Ghi nhớ mới": "New memory",
  "Tên ghi nhớ": "Memory title",
  "Nội dung": "Content",
  "Phạm vi": "Scope",
  "Mỗi task chỉ nạp tối đa 3 ghi chú có từ khóa khớp yêu cầu.": "Each task receives at most three notes that match its keywords.",
  "Diff của task": "Task diff",
  "Không có thay đổi được Git theo dõi.": "No Git-tracked changes.",
  "Đường dẫn thư mục trên máy": "Folder path on this computer",
  "Dán đường dẫn thư mục thật từ Explorer; dấu ngoặc kép ngoài cùng sẽ được tự bỏ. Workspace được lưu cục bộ.": "Paste a folder path from Explorer. Surrounding quotes are removed automatically. Workspaces are stored locally.",
  "Kiểm tra và thêm": "Verify and add",
  "Tên dự án": "Project name",
  "Chuyển dự án sang section.": "Project moved to the section.",
  "Đang tải…": "Loading…",
  "Đang mở terminal…": "Opening terminal…",
  "Chọn dịch vụ API hoặc model local": "Choose an API service or local model",
  "OpenAI / ChatGPT": "OpenAI / ChatGPT",
  "Google Gemini": "Google Gemini",
  "Claude API": "Claude API",
  "Model local / khác": "Local / other model",
  "Tạo OpenAI key": "Create an OpenAI key",
  "Tạo Gemini key": "Create a Gemini key",
  "Tạo Claude key": "Create a Claude key",
  "Tên hiển thị": "Display name",
  "Giao thức": "Protocol",
  "OpenAI Responses API": "OpenAI Responses API",
  "Google Gemini API": "Google Gemini API",
  "Anthropic Messages API": "Anthropic Messages API",
  "OpenAI-compatible · Ollama, LM Studio…": "OpenAI-compatible · Ollama, LM Studio…",
  "API endpoint": "API endpoint",
  "Model ID": "Model IDs",
  "Tải danh sách model": "Load model list",
  "API key": "API key",
  "Mỗi dòng một ID chính xác. Danh sách chỉ gồm model được dịch vụ trả về cho key của bạn.": "Enter one exact model ID per line. The list includes only models available to your key.",
  "Đây là luồng API. CLI là kết nối riêng: OpenSybau tự dò và dùng phiên đăng nhập cục bộ của Codex, Antigravity hoặc Claude Code. API key được lưu trong thư mục dữ liệu OpenSybau; API OpenAI tính phí riêng với gói ChatGPT.": "This is the API setup flow. CLI connections are separate: OpenSybau detects Codex, Antigravity, and Claude Code and uses their local sign-in sessions. API keys are stored in OpenSybau's data folder. OpenAI API usage is billed separately from ChatGPT plans.",
  "Cấu hình nhanh": "Quick setup",
  "Chọn cấu hình sẵn": "Choose a preset",
  "Ví dụ: Ollama · Qwen local": "Example: Ollama · local Qwen",
  "Chọn dịch vụ rồi bấm tải danh sách, hoặc nhập model ID": "Choose a service and load its models, or enter model IDs",
  "Nhập key của dịch vụ; model local có thể không cần": "Enter the service key. Local models may not need one.",
  "Để trống để giữ key hiện tại": "Leave blank to keep the current key",
  "Xóa API key đã lưu": "Remove saved API key",
  "Chỉ bật nếu muốn gỡ key khỏi cấu hình cục bộ.": "Select this only to remove the key from local settings.",
  "Tất cả quyền": "Full access",
  "Đang kiểm tra kết nối…": "Checking connection…",
  "Đã kết nối": "Connected",
  "Ngôn ngữ giao diện": "Interface language",
  "Chuyển sang tiếng Anh": "Switch to English",
  "Chuyển sang tiếng Việt": "Switch to Vietnamese",
  "Đã chuyển giao diện sang tiếng Anh.": "Interface language changed to English.",
  "Đã chuyển giao diện sang tiếng Việt.": "Interface language changed to Vietnamese.",
  "Không thể tải OpenSybau": "Could not load OpenSybau",
  "Request failed": "Request failed",
  ". Thường không cần API key.": ". An API key is usually not required.",
  "API agent chỉ nhận nội dung và ngữ cảnh trong chat; agent CLI mới có thể đọc hoặc sửa workspace.": "API agents only receive chat content and context. Only CLI agents can read or edit the workspace.",
  "Chat · một agent": "Chat · one agent",
  "Chạy lại": "Run again",
  "Chỉ Antigravity": "Antigravity only",
  "Chỉ Codex": "Codex only",
  "Chỉ dẫn bổ sung": "Additional instructions",
  "Chỉ lập kế hoạch": "Planning only",
  "Chọn một luồng để xem chi tiết điều phối và đầu ra từng agent.": "Choose a flow to see orchestration details and each agent's output.",
  "Codex và Antigravity": "Codex and Antigravity",
  "Có bản ghi": "Has records",
  "Cần repo có commit. Khi bật, kết quả ở worktree và không tự nhập vào thư mục hiện tại.": "The repository needs a commit. When enabled, results go to a worktree and are not merged into the current folder automatically.",
  "Dùng cho": "Used for",
  "Không tìm thấy skill khớp nội dung tìm kiếm.": "No skills match your search.",
  "Lưu định tuyến mặc định": "Save default routing",
  "Mô tả ngắn": "Short description",
  "Mọi ghi nhớ đều bắt đầu từ nội dung bạn tự lưu. OpenSybau không bịa dữ liệu hoặc tự lấy toàn bộ vault vào prompt.": "Memories are based only on content you save. OpenSybau does not invent data or automatically add the entire vault to prompts.",
  "Nếu chọn provider API, yêu cầu và ngữ cảnh dự án tương ứng sẽ được gửi tới endpoint đã cấu hình.": "When an API provider is selected, the request and relevant project context are sent to its configured endpoint.",
  "OpenAI-compatible: URL /v1 · Gemini: v1beta · HTTP chỉ dùng với localhost.": "OpenAI-compatible: URL /v1 · Gemini: v1beta · HTTP is allowed only for localhost.",
  "OpenSybau chỉ đọc tệp Markdown bên trong thư mục này. Kết nối không tự đưa ghi chú vào ngữ cảnh task.": "OpenSybau only reads Markdown files in this folder. Connecting it does not add notes to task context automatically.",
  "OpenSybau tìm skill liên quan rồi gửi cho agent ở từng vai trò. Skill có thể được gửi tới API provider nếu bạn chọn agent API.": "OpenSybau finds relevant skills and sends them to agents for each role. Skills may be sent to an API provider when you choose an API agent.",
  "Pipeline · Kế hoạch → Triển khai → Review": "Pipeline · Plan → Implement → Review",
  "Quản lý trong app": "Manage in the app",
  "Server đang chạy phiên bản cũ. Model vẫn chọn theo từng task; hãy khởi động lại server để bật lưu model mặc định và gắn skill.": "The server is running an older version. Models can still be selected per task. Restart the server to enable saved defaults and skill assignment.",
  "Skill cá nhân cho phép sửa/xóa. Skill plugin và tích hợp sẵn có thể sao chép thành bản cá nhân.": "Personal skills can be edited or deleted. Plugin and built-in skills can be copied into a personal version.",
  "Skill được lưu thành SKILL.md trong thư mục cá nhân của CLI. OpenSybau không ghi đè skill trùng tên.": "Skills are saved as SKILL.md in the CLI's personal folder. OpenSybau does not overwrite a skill with the same name.",
  "Sửa skill": "Edit skill",
  "Cài đặt CLI": "CLI installation",
  "THƯ MỤC": "FOLDER",
  "Toàn bộ nội dung SKILL.md": "Full SKILL.md content",
  "Tách Git worktree riêng": "Use a separate Git worktree",
  "Tên skill": "Skill name",
  "Tự chọn skill phù hợp": "Automatically choose relevant skills",
  "Xem sơ đồ từng bước, log hoạt động và đầu ra được ghi nhận cho mỗi cuộc trò chuyện.": "View the step-by-step flow, activity log, and recorded output for each chat.",
  "Yêu cầu": "Request",
  "Đường dẫn thư mục Obsidian vault": "Obsidian vault folder path",
  "Thêm API key OpenAI rồi tải model.": "Add an OpenAI API key, then load the models.",
  "Thêm Claude API key rồi tải model.": "Add a Claude API key, then load the models.",
  "Chọn Claude API, nhập Anthropic key và model.": "Choose Claude API, then enter an Anthropic key and model.",
  "Chọn Google Gemini, nhập key Google AI Studio rồi tải model.": "Choose Google Gemini, then enter a Google AI Studio key and load the models.",
  "Chọn cấu hình sẵn, nhập API key OpenAI rồi tải model.": "Choose the preset, enter an OpenAI API key, then load the models.",
  "Dùng endpoint": "Use endpoint",
  "và ID từ": "and IDs from",
  "Sẽ kiểm tra khi chạy task": "Will be checked when the task runs",
  "Dừng task": "Stop task",
  "Mở bản ghi": "Open record",
  "Tệp thay đổi ·": "Changed files ·",
  "task đã ghi trên máy này": "tasks recorded on this computer",
  "sự kiện · task thật": "events · real tasks",
  "model · đã cấu hình": "models · configured",
  "Chưa có bản ghi luồng": "No flow records yet",
  "Chưa có model khả dụng": "No available models",
  "Chưa tìm thấy skill. Quét lại sau khi cài skill cá nhân.": "No skills found. Scan again after installing a personal skill.",
  "LUỒNG THỰC THI": "EXECUTION FLOW",
  "chọn Claude API, nhập Anthropic key và model.": "Choose Claude API, then enter an Anthropic key and model.",
  "chọn Google Gemini, nhập key Google AI Studio rồi tải model.": "Choose Google Gemini, then enter a Google AI Studio key and load models.",
  "chọn cấu hình sẵn, nhập API key OpenAI rồi tải model.": "Choose the preset, enter an OpenAI API key, then load models.",
  "OpenSybau tự dò Codex, Antigravity và Claude Code trên máy. Nếu CLI đã cài nhưng chưa đăng nhập, mở terminal đăng nhập ngay tại đây.": "OpenSybau detects Codex, Antigravity, and Claude Code on this computer. If a CLI is installed but not signed in, open a sign-in terminal here.",
  "Cài Claude Code theo hướng dẫn chính thức của Anthropic trên máy chạy OpenSybau, rồi quay lại đây và quét lại.": "Install Claude Code using Anthropic's official instructions on the computer running OpenSybau, then return here and scan again.",
  "Quyền thực thi của Agent": "Agent execution permissions",
  "Chỉ đọc an toàn": "Safe read-only",
  "Chỉ phân tích mã nguồn và trả lời, không tự ý sửa tệp trong dự án": "Analyze code and reply only, without modifying files in the project",
  "Đọc & sửa dự án": "Read & edit project",
  "Đọc & sửa trong dự án": "Read & edit inside project",
  "Cho phép đọc, chỉnh sửa tệp và chạy công cụ trong phạm vi workspace": "Allow reading, editing files, and running tools within the workspace",
  "Toàn quyền thực thi": "Full execution access",
  "Tự động chạy lệnh, cài gói và thao tác tệp trên máy không giới hạn": "Automatically run commands, install packages, and modify files without restrictions",
};

const vietnamese = new Map(Object.entries(english).map(([vi, en]) => [en, vi]));
const englishDictionary = new Map(Object.entries(english));
const englishPhrases = [...Object.entries(english)].filter(([vi, en]) => vi !== en).sort((a, b) => b[0].length - a[0].length);
const vietnamesePhrases = [...vietnamese.entries()].filter(([en, vi]) => en !== vi).sort((a, b) => b[0].length - a[0].length);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const englishPhraseLookup = new Map(englishPhrases.map(([vi, en]) => [vi.toLocaleLowerCase(), en]));
const vietnamesePhraseLookup = new Map(vietnamesePhrases.map(([en, vi]) => [en.toLocaleLowerCase(), vi]));
const phrasePattern = (phrases) => new RegExp(`(^|[^\\p{L}\\p{N}])(${phrases.map(([phrase]) => escapeRegex(phrase)).join("|")})(?=$|[^\\p{L}\\p{N}])`, "giu");
const englishPhrasePattern = phrasePattern(englishPhrases);
const vietnamesePhrasePattern = phrasePattern(vietnamesePhrases);

export function getLanguage() {
  try { return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "vi"; }
  catch { return "vi"; }
}

export function setLanguage(language) {
  const next = language === "en" ? "en" : "vi";
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  return next;
}

function dynamicTranslation(value, language) {
  if (language === "en") {
    let match = value.match(/^(\d+) task$/i); if (match) return `${match[1]} tasks`;
    match = value.match(/^(\d+) skill$/i); if (match) return `${match[1]} skills`;
    match = value.match(/^(\d+) task đã ghi trên máy này$/i); if (match) return `${match[1]} tasks recorded on this computer`;
    match = value.match(/^(\d+) sự kiện · task thật$/i); if (match) return `${match[1]} events · real tasks`;
    match = value.match(/^(\d+) tệp thay đổi$/i); if (match) return `${match[1]} changed files`;
    match = value.match(/^(\d+) sự kiện$/i); if (match) return `${match[1]} events`;
    match = value.match(/^(\d+) tin nhắn$/i); if (match) return `${match[1]} messages`;
    match = value.match(/^(\d+) model khả dụng(.*)$/i); if (match) return `${match[1]} models available${match[2]}`;
    match = value.match(/^(\d+) model( · .*)?$/i); if (match) return `${match[1]} models${match[2] || ""}`;
    match = value.match(/^(\d+) skill · (\d+) nguồn$/i); if (match) return `${match[1]} skills · ${match[2]} sources`;
    match = value.match(/^Bạn muốn làm gì trong (.+)\?$/); if (match) return `What would you like to do in ${match[1]}?`;
    match = value.match(/^Nhắn (.+)…$/); if (match) return `Message ${match[1]}…`;
    match = value.match(/^Mở dự án (.+)$/); if (match) return `Open project ${match[1]}`;
    match = value.match(/^Mở (.+)$/); if (match) return `Open ${match[1]}`;
    match = value.match(/^Skill tự chọn · (\d+) · Tối đa (\d+) task song song$/); if (match) return `Auto-selected skills · ${match[1]} · Up to ${match[2]} parallel tasks`;
    match = value.match(/^(\d+) sự kiện · (\d+) node$/); if (match) return `${match[1]} events · ${match[2]} nodes`;
    match = value.match(/^(\d+) sự kiện công cụ quan sát được$/); if (match) return `${match[1]} observed tool events`;
    match = value.match(/^Xem (\d+) tệp thay đổi$/); if (match) return `View ${match[1]} changed files`;
    match = value.match(/^(.+) đang (lập kế hoạch|triển khai|review)$/); if (match) return `${match[1]} ${({ "lập kế hoạch": "is planning", "triển khai": "is implementing", review: "is reviewing" })[match[2]]}`;
  } else {
    let match = value.match(/^(\d+) tasks$/i); if (match) return `${match[1]} task`;
    match = value.match(/^(\d+) skills$/i); if (match) return `${match[1]} skill`;
    match = value.match(/^(\d+) tasks recorded on this computer$/i); if (match) return `${match[1]} task đã ghi trên máy này`;
    match = value.match(/^(\d+) events · real tasks$/i); if (match) return `${match[1]} sự kiện · task thật`;
    match = value.match(/^(\d+) changed files$/i); if (match) return `${match[1]} tệp thay đổi`;
    match = value.match(/^(\d+) events$/i); if (match) return `${match[1]} sự kiện`;
    match = value.match(/^(\d+) messages$/i); if (match) return `${match[1]} tin nhắn`;
    match = value.match(/^(\d+) models available(.*)$/i); if (match) return `${match[1]} model khả dụng${match[2]}`;
    match = value.match(/^(\d+) models( · .*)?$/i); if (match) return `${match[1]} model${match[2] || ""}`;
    match = value.match(/^(\d+) skills · (\d+) sources$/i); if (match) return `${match[1]} skill · ${match[2]} nguồn`;
    match = value.match(/^What would you like to do in (.+)\?$/); if (match) return `Bạn muốn làm gì trong ${match[1]}?`;
    match = value.match(/^Message (.+)…$/); if (match) return `Nhắn ${match[1]}…`;
    match = value.match(/^Open project (.+)$/); if (match) return `Mở dự án ${match[1]}`;
    match = value.match(/^Open (.+)$/); if (match) return `Mở ${match[1]}`;
    match = value.match(/^Auto-selected skills · (\d+) · Up to (\d+) parallel tasks$/); if (match) return `Skill tự chọn · ${match[1]} · Tối đa ${match[2]} task song song`;
    match = value.match(/^(\d+) events · (\d+) nodes$/); if (match) return `${match[1]} sự kiện · ${match[2]} node`;
    match = value.match(/^(\d+) observed tool events$/); if (match) return `${match[1]} sự kiện công cụ quan sát được`;
    match = value.match(/^View (\d+) changed files$/); if (match) return `Xem ${match[1]} tệp thay đổi`;
  }
  return value;
}

export function translateText(input, language = getLanguage()) {
  const value = String(input ?? "");
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const core = value.slice(leading.length, value.length - trailing.length || undefined);
  if (!core) return value;
  const dictionary = language === "en" ? englishDictionary : vietnamese;
  const exact = dictionary.get(core);
  if (exact) return `${leading}${exact}${trailing}`;
  const dynamic = dynamicTranslation(core, language);
  if (dynamic !== core) return `${leading}${dynamic}${trailing}`;
  const lookup = language === "en" ? englishPhraseLookup : vietnamesePhraseLookup;
  const pattern = language === "en" ? englishPhrasePattern : vietnamesePhrasePattern;
  const translated = core.replace(pattern, (match, boundary, phrase) => boundary + (lookup.get(phrase.toLocaleLowerCase()) || phrase));
  return `${leading}${translated}${trailing}`;
}

const translatableAttributes = ["aria-label", "aria-description", "title", "placeholder", "alt"];
const dynamicContentSelector = [
  "code", "pre", "textarea", ".chat-message-content", ".markdown-preview", ".code-preview", ".diff-content",
  ".orchestration-event p", ".orchestration-node-details p", ".orchestration-node-details pre",
  ".task-primary strong", ".task-title", ".wb-task-copy strong", ".wb-project-toggle strong", ".wb-project-preview strong",
  ".wb-project-preview li span", ".file-row strong", ".file-preview-head strong", ".source-folder-row input",
  ".chat-home-card strong", ".workflow-task-title strong", ".workspace-card-main strong", ".wb-task-heading strong",
].join(",");

export function localizeDom(root, language = getLanguage()) {
  if (!root || typeof document === "undefined") return;
  if (language === "vi" && root.dataset?.localizedLang !== "en") return;
  if (root.dataset) root.dataset.localizedLang = language;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest(dynamicContentSelector)) continue;
    const translated = translateText(node.nodeValue, language);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  const elements = root.querySelectorAll?.("*") || [];
  for (const element of elements) {
    if (element.matches("[data-task], [data-workspace], .wb-task-heading")) continue;
    for (const attribute of translatableAttributes) {
      const value = element.getAttribute(attribute);
      if (value == null) continue;
      const translated = translateText(value, language);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }
}

export function formatNumber(value, language = getLanguage()) {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN").format(value);
}
