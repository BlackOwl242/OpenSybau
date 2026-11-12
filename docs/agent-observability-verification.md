# Kiểm chứng agent observability — 2026-11-12

## Phạm vi đã triển khai

Tổng quan phiên, nhật ký subagent, tương quan lệnh cha/con, danh mục artifact, hủy tin nhắn chờ, Codex App Server và gửi vào lượt chạy, duyệt lệnh/tệp, dừng QA/terminal, kiểm kê Customizations, khôi phục sau ngắt kết nối/restart, kiểm tra workspace/worktree và giao diện sáng/tối.

Không thay lịch sử người dùng bằng dữ liệu mẫu. Bản production frontend nằm ở `dist/`; Electron chạy trực tiếp từ repository dùng frontend này và backend mới.

## Ma trận provider

| Provider / phiên bản đã kiểm tra | Quan sát | Gửi vào lượt đang chạy | Duyệt RPC | Kiểm chứng live |
| --- | --- | --- | --- | --- |
| Codex CLI 0.166.0-alpha.6 | CLI JSON và App Server v2; thread/turn/item IDs, command, exit code, output, usage | Có, khi chọn App Server; kiểm tra đúng turn và request ID | Có, commandExecution/fileChange; tương quan cha/con | App Server, exec fallback, terminal command, steer, accept/decline và HTTP run đã qua |
| Claude Code 2.1.322 | Tool-use/result; system task_started/task_progress/task_notification/task_updated theo schema chính thức | Chưa bật, dùng hàng đợi | Chưa bật trong bộ chạy CLI hiện tại | Bị chặn: `claude auth status` trả `loggedIn:false`; fixture được đánh dấu schema-derived |
| Antigravity CLI 1.5.6 | Không mở rộng adapter stream hiện có bằng giả định từ giao diện App | Chưa bật, dùng hàng đợi | Chưa bật | Không chạy kiểm chứng bọc CLI consumer trong app bên thứ ba do chính sách Google |

Codex App Server được bật theo từng task khi phiên nghỉ. Mặc định vẫn là `exec`; có thể đổi lại ở Tổng quan hoặc Cấu hình lượt chat. Không tự retry lệnh hoặc tin nhắn có kết quả gửi chưa xác nhận. Mất kết nối stdio kết thúc phiên; lịch sử và nội dung chat đã lưu phục vụ chạy lại có chủ đích. SSE của giao diện kết nối lại bằng snapshot có process identity mới sau restart.

## Kiểm thử đã chạy

| Lệnh | Kết quả và giới hạn của bằng chứng |
| --- | --- |
| `npm test` | Qua. Có 200 probe cũ, trong đó nhiều probe kiểm tra nguồn; không xem chúng là 200 phiên CLI thật. Các suite bổ sung chạy assertion hành vi cho quota, installer env, đổi tài khoản, subagent, queue, terminal, RPC, inventory, approval, artifact, persistence và scheduler. |
| `npm run test:long-task` | 12/12 kịch bản qua. Stage AI được mô phỏng; Git/worktree và lệnh QA trong bài kiểm tra chạy thật. Bao gồm plan gate, nhiều vòng sửa, queue drain, compact và output lớn. |
| `npm run test:live` | Qua bằng Codex đang cài: App Server + exec; terminal thật + turn/steer; hai quyết định approval thật; HTTP đăng ký workspace → tạo task → chạy CLI → xem tệp → restart và phục hồi. |
| Bài HTTP trong `test:live` | Kiểm tra 401 thiếu Basic Auth, 403 host ngoài allowlist, 403 origin khác, từ chối mật khẩu yếu/host wildcard, SSE mở lại, chặn path traversal, dừng cây tiến trình QA thật và chạy lệnh tiếp theo sau khi nhả khóa. Fixture crash chỉ được ghi trong data directory riêng của test. |
| `npm run test:ui` | 156 layout qua: 13 theme × 1280/375 px × Overview/Subagents/Customizations/Docs/Terminal/Settings. Đo tràn ngang, độ rộng dock/nhãn lệnh và tương phản ≥ 4,5:1 cho các nhãn theo dõi được chọn. Đây không phải tuyên bố audit accessibility toàn bộ app. |
| `npm run build` | Qua, Vite production bundle. |
| `git diff --check` | Qua. |

Lệnh `test:live` dùng tài khoản Codex có sẵn và model/effort lấy từ catalog CLI đang cài. `test:ui` cần Chrome hoặc `CHROME_PATH`. Không có suite nào cần thêm task mẫu vào dữ liệu vận hành.

Ảnh và kết quả đo browser: `.runtime/observability-ui/obsidian-1280.png`, `obsidian-375.png`, `sakura-light-1280.png`, `sakura-light-375.png`, `layout-results.json`.

Fixture: `scripts/fixtures/codex-app-server-live.json` là dữ liệu chạy thật đã thay đường dẫn/session ID; `claude-stream-schema.json` là dữ liệu theo schema, không phải phiên Claude thật.

Kiểm tra lại: Claude 2.1.322 vẫn `loggedIn:false`; thư mục phiên Claude trên máy không có transcript JSONL. `scripts/fixtures/claude-unauthenticated-live.json` chứa stream lỗi xác thực thực tế chạy với `--bare` trong thư mục tạm, chỉ giữ loại sự kiện và kết quả lỗi; parser đã được kiểm thử với fixture này. Đây không phải bằng chứng về phiên subagent thành công. Codex trên PATH hiện báo 0.162.1, còn fixture Codex được thu trước đó từ 0.166.0-alpha.6.

## Hành vi không được suy đoán

- Phiên cha hoàn tất không có nghĩa subagent đã thành công. Thiếu kết quả xác nhận được ghi unknown.
- Phản hồi đã khởi chạy nền không phải phản hồi hoàn tất. Thông báo task của Claude phải tương quan với tool-use ID trước khi tạo hoạt động.
- Lệnh do CLI báo cáo không có nút dừng riêng nếu adapter chưa có giao thức hủy được xác minh. Lệnh QA/terminal do OpenSybau quản lý có ID và nút dừng cây tiến trình thật.
- File thay đổi không có nghĩa do AI tạo; artifact giữ nguồn Git/task/workspace. Preview vẫn kiểm tra đường dẫn và realpath ở server.
- Token customization chỉ là ký tự/4; không phải ngân sách hoặc số token được provider nạp. Không tự cắt rule/skill theo ngưỡng chung.
- Ma trận quyền dùng chung với bộ chạy. Permission mode của Claude không được gọi là sandbox hệ điều hành. Plan gate của OpenSybau độc lập với approval RPC.
- Không coi QA đã đạt chỉ vì task/review hoàn tất; không tạo thời lượng hoặc phân bổ chi phí giả cho stage thiếu metric.

## Nguồn và giới hạn ngoài code

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): đối chiếu thêm JSON schema sinh từ CLI đang cài, không chỉ dựa vào ảnh giao diện.
- [Claude chạy theo chương trình](https://code.claude.com/docs/en/headless), [định nghĩa task lifecycle chính thức](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-python/main/src/claude_agent_sdk/types.py): dùng để viết parser/fixture; chưa thay được bước kiểm chứng live khi CLI chưa đăng nhập.
- [FAQ Antigravity](https://antigravity.google/docs/faq): consumer plan không hỗ trợ bọc `agy` trong ứng dụng/agent bên thứ ba hoặc tự động xoay tài khoản. Vì vậy chưa mở rộng tích hợp mới và chưa thể đánh dấu đã kiểm chứng các tính năng trong App qua CLI.

Hai đầu mục xác minh phiên thật trong kế hoạch vẫn được để mở với lý do cụ thể, thay vì đánh dấu hoàn tất bằng dữ liệu mô phỏng.
