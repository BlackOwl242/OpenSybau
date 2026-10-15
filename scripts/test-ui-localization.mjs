import assert from "node:assert/strict";
import { translateText } from "../src/shared/i18n.js";

// Regressions reported in the chat menu and workspace dock.
for (const [vi, en] of [
  ["Lưu trữ", "Archive"],
  ["Khôi phục", "Restore"],
  ["Chưa có dự án nào được chọn.", "No project selected."],
  ["Làm mới", "Refresh"],
  ["Tóm tắt câu trả lời", "Answer summaries"],
]) {
  assert.equal(translateText(vi, "en"), en);
  assert.equal(translateText(en, "en"), en);
  assert.equal(translateText(en, "vi"), vi);
  assert.equal(translateText(`  ${vi}  `, "en"), `  ${en}  `);
}

// Unknown sentences must stay intact rather than turning individual words into
// half-translated UI. User-provided names in known templates stay intact too.
assert.equal(translateText("Lưu một câu hoàn toàn mới", "en"), "Lưu một câu hoàn toàn mới");
assert.equal(translateText("Chưa có dự án khác để thử", "en"), "Chưa có dự án khác để thử");
assert.equal(translateText("Thao tác chat Lưu trữ tài liệu", "en"), "Chat actions Lưu trữ tài liệu");
assert.equal(translateText("Đóng tab tài liệu.md", "en"), "Close tab tài liệu.md");
assert.equal(translateText("Lưu trữ · Sẵn sàng", "en"), "Archive · Ready");
assert.equal(translateText("4 tin nhắn", "en"), "4 messages");
console.log("UI localization regressions passed.");
