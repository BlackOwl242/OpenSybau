import assert from "node:assert/strict";
import { translateText } from "../src/shared/i18n.js";

// Regressions reported in the chat menu, workspace dock, 6-station pipeline, and 3-role settings.
for (const [vi, en] of [
  ["Lưu trữ", "Archive"],
  ["Khôi phục", "Restore"],
  ["Chưa có dự án nào được chọn.", "No project selected."],
  ["Làm mới", "Refresh"],
  ["Tóm tắt câu trả lời", "Answer summaries"],
  ["1. Lập kế hoạch", "1. Plan"],
  ["2. Duyệt kế hoạch", "2. Plan Gate"],
  ["3. Triển khai", "3. Implement"],
  ["4. Đánh giá", "4. Review"],
  ["5. Kiểm thử QA", "5. QA Runner"],
  ["6. Tích hợp", "6. Integrate"],
  ["Trạm 1/6 · AI Lập kế hoạch", "Station 1/6 · Planning AI"],
  ["Trạm 3/6 · AI Triển khai", "Station 3/6 · Implementation AI"],
  ["Trạm 4/6 · AI Đánh giá", "Station 4/6 · Review AI"],
  ["Trung bình", "Medium"],
  ["Cao", "High"],
  ["Thấp", "Low"],
  ["Hiển thị:", "Show:"],
  ["Cần chú ý", "Needs attention"],
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
assert.equal(translateText("4 tin nhắn", "en"), "4 messages");
console.log("UI localization regressions passed.");
