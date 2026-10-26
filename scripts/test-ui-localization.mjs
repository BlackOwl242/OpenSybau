import assert from "node:assert/strict";
import { translateText } from "../src/shared/i18n.js";

// Regressions reported in the chat menu, workspace dock, 6-station pipeline, and 3-role settings.
for (const [vi, en] of [
  ["Lưu trữ", "Archive"],
  ["Khôi phục", "Restore"],
  ["Chưa có dự án nào được chọn.", "No project selected."],
  ["Làm mới", "Refresh"],
  ["Tóm tắt câu trả lời", "Answer summaries"],
  ["1. Lên kế hoạch", "1. Plan"],
  ["2. Duyệt kế hoạch", "2. Approve Plan"],
  ["3. Viết code", "3. Write Code"],
  ["4. Kiểm tra code", "4. Review Code"],
  ["5. Chạy thử", "5. Run Tests"],
  ["6. Gộp vào dự án", "6. Merge to Project"],
  ["Bước 1/6 · AI Lên kế hoạch", "Step 1/6 · Planning AI"],
  ["Bước 3/6 · AI Viết code", "Step 3/6 · Coding AI"],
  ["Bước 4/6 · AI Kiểm tra code", "Step 4/6 · Review AI"],
  ["Giao việc theo đợt", "Batch Tasks"],
  ["Giao việc mới", "New Task"],
  ["Tiến trình công việc", "Work Progress"],
  ["Trung bình", "Medium"],
  ["Cao", "High"],
  ["Thấp", "Low"],
  ["Hiển thị:", "Show:"],
  ["Cần chú ý", "Needs attention"],
  ["Mã nguồn & Cấu trúc thư mục", "Source Code & Directory Tree"],
  ["Khởi tạo nhanh cho dự án này", "Quick Start for This Project"],
  ["Mở không gian dự án", "Open project workspace"],
  ["Cài đặt hệ thống", "System Settings"],
  ["Danh mục", "Categories"],
  ["Tất cả cài đặt", "All settings"],
  ["Giao diện & Chủ đề màu", "Appearance & Color Themes"],
  ["Chọn model AI cho từng việc", "Choose AI Models by Role"],
  ["Công cụ CLI trên máy", "Local CLI Tools"],
  ["Kết nối API & Model cục bộ", "API & Local Models"],
  ["Số công việc chạy cùng lúc", "Concurrent Tasks"],
  ["1. Tạo mật khẩu kết nối", "1. Create connection password"],
  ["2. Quét mã QR hoặc sao chép mã sang điện thoại", "2. Scan QR code or copy pairing code to your phone"],
  ["OpenSybau tự dò Codex CLI. Đăng nhập bằng tài khoản ChatGPT trong cửa sổ terminal; không cần OpenAI API key.", "OpenSybau auto-detects Codex CLI. Sign in with your ChatGPT account in the terminal window; no OpenAI API key required."],
  ["Công cụ CLI & Hạn mức", "CLI Tools & Quotas"],
  ["Cập nhật hạn mức", "Update quotas"],
  ["Làm mới hạn mức", "Refresh quotas"],
  ["Hạn mức Agent", "Agent Quotas"],
  ["Tất cả thay đổi", "All changes"],
  ["Tệp đã sửa", "Changed files"],
  ["Tất cả tệp", "All files"],
  ["Xem thay đổi", "Show changes"],
  ["Xem mã nguồn", "View source"],
  ["Xem bản dựng", "View preview"],
  ["2g 6p", "2h 6m"],
  ["6n 21g", "6d 21h"],
]) {
  assert.equal(translateText(vi, "en"), en);
  assert.equal(translateText(en, "en"), en);
  assert.equal(translateText(en, "vi"), vi);
  assert.equal(translateText(`  ${vi}  `, "en"), `  ${en}  `);
}

assert.equal(translateText("Đợt 1", "en"), "Wave 1");
assert.equal(translateText("Wave 1", "vi"), "Đợt 1");
assert.equal(translateText("Vòng 1/2", "en"), "Round 1/2");
assert.equal(translateText("Round 1/2", "vi"), "Vòng 1/2");
assert.equal(translateText("2 lỗi chặn", "en"), "2 blocking");
assert.equal(translateText("3 góp ý", "en"), "3 advisory");

// Unknown sentences must stay intact rather than turning individual words into
// half-translated UI. User-provided names in known templates stay intact too.
assert.equal(translateText("Lưu một câu hoàn toàn mới", "en"), "Lưu một câu hoàn toàn mới");
assert.equal(translateText("Chưa có dự án khác để thử", "en"), "Chưa có dự án khác để thử");
assert.equal(translateText("Thao tác chat Lưu trữ tài liệu", "en"), "Chat actions Lưu trữ tài liệu");
assert.equal(translateText("Đóng tab tài liệu.md", "en"), "Close tab tài liệu.md");
assert.equal(translateText("Lưu trữ · Sẵn sàng", "en"), "Archive · Ready");
assert.equal(translateText("4 model · sẵn sàng · đã lưu khóa API", "en"), "4 models · ready · API key saved");
assert.equal(translateText("4 tin nhắn", "en"), "4 messages");
console.log("UI localization regressions passed.");
