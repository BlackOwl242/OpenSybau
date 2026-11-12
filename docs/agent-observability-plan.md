# Kế hoạch: theo dõi và điều khiển agent

Mục tiêu: hiển thị hoạt động thực tế của từng phiên, không suy đoán khả năng hoặc kết quả của CLI. Không thêm framework điều phối; giữ local-first và các ràng buộc workspace/worktree trong AGENTS.md.

## 1. Tổng quan và subagent

- [x] Thêm tab Tổng quan vào dock của từng phiên, liên kết tới review, tệp, subagent, tài liệu và QA/terminal.
- [x] Hiển thị hoạt động gần nhất, thời gian và nhật ký có sẵn của từng subagent. Khi không có dữ liệu, giải thích rõ thay vì tạo sự kiện giả.
- [x] Không để snapshot chi tiết cũ ghi đè trạng thái mới; không gán thành công chỉ vì phiên cha kết thúc.
- [x] Giữ subagent đang chạy khi vượt giới hạn lịch sử 64 mục; cắt bớt các mục đã kết thúc trước.
- [ ] Kiểm tra giao diện bằng dữ liệu phiên thực của Codex và Claude, bao gồm ngắt kết nối, nhiều subagent và theme sáng/tối. **Phần còn lại bị chặn bởi tài khoản Claude:** Codex thật đã chạy; UI/replay nhiều subagent và 13 theme đã qua; Claude CLI 2.1.322 trả `loggedIn:false` nên chưa có phiên Claude thật.
- [ ] Xác minh và ghi nhận phiên bản, nguồn và các trường thực tế trong stream; bổ sung fixture đã ẩn thông tin riêng cho từng CLI. **Đã có:** Codex 0.166.0-alpha.6 captured-live (CLI trên PATH hiện là 0.162.1); Claude 2.1.322 có stream lỗi đăng nhập thật đã ẩn thông tin và fixture subagent theo schema. Chưa có stream subagent Claude thật; Antigravity 1.5.6 chưa thu stream thật bằng ứng dụng bên thứ ba.

## 2. Tiến trình nền và artifact

- [x] Lập ma trận sự kiện/ID và khả năng hủy: Codex `commandExecution`/`command_execution`; Claude tool-use/tool-result và system task lifecycle; Antigravity chưa bật thêm khả năng chưa xác minh. Lệnh CLI chỉ quan sát, không quảng cáo nút hủy từng lệnh.
- [x] Tách lệnh OpenSybau quản lý và lệnh CLI báo cáo. Tương quan ID, nguồn, subagent cha, trạng thái và đầu ra giới hạn kích thước; không đếm subagent như tiến trình nền. Lệnh QA có nút dừng riêng, đã thử giết cây tiến trình thật và chạy lệnh kế tiếp sau khi nhả khóa.
- [x] Danh mục artifact gồm tài liệu giai đoạn, QA, diff và tệp thay đổi; có nguồn, task, workspace, origin. Chặn đường dẫn không an toàn trên UI và dùng API preview kiểm tra đường dẫn/realpath ở backend. Không suy luận tệp thay đổi là tệp AI tạo mới.

## 3. Tin nhắn đang chạy

- [x] Giữ hàng đợi làm mặc định, có trạng thái chờ/đã gửi/lỗi và hủy khi chưa gửi. Việc hủy không thu hồi được nội dung đã chuyển vào một stage trước đó.
- [x] Adapter Codex App Server theo stage, kiểm tra turn ID và tương quan thread con; lưu request ID và trạng thái trước khi gửi để chống gửi trùng cả khi tải lại UI. SSE kết nối lại lấy snapshot mới. Mất pipe CLI thì dừng phiên và giữ lịch sử; không tự phát lại thao tác chưa biết đã nhận hay chưa. Fallback `exec` vẫn chọn được và đã chạy thật.
- [x] Đối chiếu Claude/Antigravity với CLI và tài liệu chính thức. Giữ hàng đợi cho hai provider này; chỉ Codex App Server đã kiểm chứng mới có nút gửi trực tiếp. Không gọi hàng đợi là gửi tức thì.

## 4. Quyền và Customizations

- [x] Ma trận preset/stage dùng chung giữa UI và bộ chạy; kiểm thử các tổ hợp. Codex sandbox khác permission mode của Claude; Antigravity read-only được chặn. Kiểm thử thực tế sandbox/approval của Codex; xác minh live Claude/Antigravity vẫn chịu các giới hạn ở mục 1 và 5.
- [x] Luồng duyệt RPC thật cho Codex, tương quan thread/turn của cha và con; chặn yêu cầu cũ, chỉ giải quyết một lần, từ chối khi hết hạn, xóa trạng thái chờ sau ngắt kết nối/restart. Đã chạy Codex thật ở cả nhánh accept và decline.
- [x] Tab Customizations read-only rules/skills/agents/MCP ở workspace/global; nguồn, mức tin cậy, ước tính token theo ký tự. Trạng thái CLI nạp là unknown khi CLI không báo. Không trả cấu hình MCP/khóa/biến môi trường; không đọc symlink ra ngoài; giới hạn số mục, độ sâu và kích thước đọc.

## 5. Xác minh và giới hạn

- [x] Kiểm thử replay sai thứ tự, hơn 64 subagent đang chạy, stream UTF-8 bị chia chunk, pipe ngắt, timeout, tệp lớn, restart và yêu cầu gửi chưa xác nhận. Chạy live Codex trên workspace tạm; không ghi nhận Claude/Antigravity là đã chạy live.
- [x] 156 trường hợp browser: 13 theme × 2 kích thước (1280/375) × 6 màn. Không tràn ngang; nhãn theo dõi được đo tương phản tối thiểu 4,5:1. Fixture chỉ ở môi trường kiểm thử, không thêm task/token/memory mẫu vào dữ liệu người dùng.
- [x] Đã kiểm tra FAQ chính thức Google: bọc `agy` trong app/agent bên thứ ba không được hỗ trợ với consumer plan. Không mở rộng điều khiển trực tiếp hoặc tự động xoay tài khoản Antigravity; không coi tính năng App là API công khai.
- [x] Kiểm thử scheduler thật + Git thật: repo/thư mục con dùng chung checkout xếp hàng, hai worktree riêng chạy đồng thời, nhả khóa và giữ nguồn/sự kiện/đường dẫn đầu ra.

## 6. Bằng chứng và cách dùng

Xem [báo cáo kiểm chứng](agent-observability-verification.md). Các ô chưa đánh dấu ở mục 1 là giới hạn xác minh ngoài code; không được thay fixture theo schema thành tuyên bố đã chạy phiên thật.

- Trong phiên chat: mở dock bên phải → Tổng quan/Subagents/Tài liệu/Customizations/Terminal.
- Khi phiên nghỉ: Tổng quan → bật Codex App Server, hoặc Cấu hình lượt chat → Bộ chạy Codex. Lượt tiếp theo có nút gửi trực tiếp; `exec` vẫn là mặc định.
- Cấu hình quyền của task hiển thị ma trận thực tế theo provider; yêu cầu duyệt hiện ở Tổng quan.
- Kết nối LAN mặc định tắt; chỉ production, host allowlist cụ thể và mật khẩu ít nhất 16 ký tự mới mở được. QR chỉ hiện khi LAN thực sự hoạt động.
