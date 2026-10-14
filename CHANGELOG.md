# Changelog

Tất cả những thay đổi đáng chú ý của dự án **OpenSybau** sẽ được ghi lại tại tệp này.  
All notable changes to **OpenSybau** are documented in this file.

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
