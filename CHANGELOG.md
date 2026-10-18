# Changelog

Tất cả những thay đổi đáng chú ý của dự án **OpenSybau** sẽ được ghi lại tại tệp này.  
All notable changes to **OpenSybau** are documented in this file.

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
