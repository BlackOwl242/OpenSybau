# <img src="public/opensybau.svg" alt="OpenSybau Logo" width="36" height="36" align="top" /> OpenSybau

**Trung tâm điều phối AI Coding Agent & Thực thi Đa luồng Git Worktree chạy trực tiếp trên máy của bạn.**  
OpenSybau kết hợp **Codex CLI**, **Claude Code**, **Antigravity CLI** cùng các nguồn **API tương thích Anthropic / OpenAI** (bao gồm cả Ollama, LM Studio, LocalAI) trong một giao diện Desktop kính mờ hiện đại. Mọi tác vụ, cuộc trò chuyện và nhánh Git worktree đều thực thi trực tiếp trên máy tính của bạn — minh bạch, tốc độ cao và toàn quyền kiểm soát dữ liệu.

**Tài liệu:** [English](README.md) · **Nhật ký thay đổi:** [CHANGELOG.md](CHANGELOG.md) · **Giấy phép:** [MIT License](LICENSE)

---

## 🖼️ Giao diện Hệ thống (System Screenshots)

### 1. Màn hình Chính & Khung nhập liệu thông minh 2 tầng
![Màn hình Chính & Khung nhập liệu](docs/screenshots/home-composer-workbench.png)

### 2. Hệ thống 13 Chủ đề Giao diện (Tối nguyên bản, Đa sắc Antigravity & Sáng thanh lịch)
| **Antigravity Cosmic (kèm Menu chuyển nhanh Theme)** | **Synthwave Pulse (Đa sắc Cyberpunk)** |
| :---: | :---: |
| ![Antigravity Cosmic Theme](docs/screenshots/theme-antigravity-cosmic.png) | ![Synthwave Pulse Theme](docs/screenshots/theme-synthwave-pulse.png) |
| **Daylight Frost (Sáng chuẩn tinh khiết)** | **Editorial Stone (Kem giấy ấm Bauhaus)** |
| ![Daylight Frost Theme](docs/screenshots/theme-daylight-frost.png) | ![Editorial Stone Theme](docs/screenshots/theme-editorial-stone.png) |

### 3. Thư viện Chủ đề (Theme Gallery) & Khung Preview Cửa sổ thu nhỏ
![Thư viện Chủ đề trong Cài đặt](docs/screenshots/theme-gallery-settings.png)

### 4. Luồng Trò chuyện Đồng nhất, Bảng Markdown & Xem Mã nguồn Chia đôi (Split View)
![Trò chuyện & Xem tệp chia đôi](docs/screenshots/chat-split-review.png)

### 5. Kho Tri thức Markdown & Đồ thị Liên kết (Neural Graph)
![Kho Tri thức & Đồ thị Liên kết](docs/screenshots/knowledge-vault.png)

### 6. Thư viện Kỹ năng Agent & Sidebar Ngữ cảnh
![Thư viện Kỹ năng Agent](docs/screenshots/skills-library.png)

---

## ✨ Điểm nổi bật mới nhất

### 1. Giao diện Kính mờ (Frosted-Glass), Hệ thống 13 Theme & Khung nhập liệu thông minh 2 tầng
- **Khung ứng dụng Windows Mica / Kính mờ & 13 Chủ đề Màu sắc:** Chuyển đổi tức thì ngay trên thanh tiêu đề hoặc trong **Cài đặt → Giao diện** giữa 3 nhóm: **Tối nguyên bản** (`Obsidian Dark`, `Carbon OLED`), **Đa sắc Antigravity** (`Antigravity Cosmic`, `Tokyo Night`, `Synthwave Pulse`, `Catppuccin Mocha`, `Emerald Matrix`, `Rosé Pine`, `Amber Forge`, `Nordic Aurora`), và **Sáng thanh lịch** (`Daylight Frost`, `Editorial Stone`, `Sakura Daylight`).
- **Khung nhập liệu 2 tầng bám sát cạnh dưới (Bottom-Docked Two-Tier Composer):**
  - **Thanh ngữ cảnh tầng trên:** Chọn nhanh **Dự án (Workspace)**, chuyển đổi môi trường thực thi giữa **Máy tính này** (chạy trực tiếp trên nhánh hiện tại) và **Git Worktree** (tách nhánh cô lập an toàn), cùng 4 chế độ làm việc: **Chat**, **Code**, **Kế hoạch**, **Đa luồng**.
  - **Thanh điều khiển tầng dưới với Popover mở hướng lên:** Chọn nhanh **Agent & Model**, **Mức suy luận (Reasoning Effort)** (`Low` / `Medium` / `High` / `Max`), đính kèm tệp/ảnh (`+`), và **Popover Quyền thực thi của Agent**:
    - 🛡️ **Chỉ đọc an toàn (`read-only`):** Chỉ phân tích mã nguồn và trả lời, không tự ý sửa tệp trong dự án.
    - 🧑‍💻 **Đọc & sửa dự án (`workspace-write`):** Cho phép đọc, chỉnh sửa tệp và chạy công cụ trong phạm vi workspace.
    - ⚡ **Toàn quyền (`full-access`):** Tự động chạy lệnh, cài gói và thao tác tệp trên máy không giới hạn.

### 2. Đa cửa sổ Tab Xem tệp, Chia đôi màn hình & Sidebar Phải theo ngữ cảnh
- **Trình xem tệp đa cửa sổ kiểu Orca & Chia đôi màn hình (Split View):** Nhấp trực tiếp vào bất kỳ tệp nào ở cây thư mục bên phải hoặc chip tệp thay đổi trong đoạn chat để mở tab mới, hoặc bật **Chia đôi màn hình** để vừa đọc cuộc trò chuyện vừa kiểm tra mã nguồn.
- **Hỗ trợ xem trước đa định dạng trực tiếp:**
  - **HTML (`Xem trước` / `Mã nguồn`):** Khung chạy thử trực tiếp có thanh địa chỉ (`Quay lại`, `Tải lại`) hoặc chuyển sang xem mã nguồn có đánh số dòng.
  - **Markdown & Tài liệu Word `.docx`:** Chuyển đổi mượt mà giữa bản trình bày hoàn chỉnh và mã nguồn.
  - **PDF, Hình ảnh, Âm thanh, Video & Bảng tính CSV/TSV:** Hiển thị trực tiếp ngay trong tab mà không cần mở phần mềm bên ngoài.
- **Sidebar bên phải thông minh theo từng trang:** Tự động hiển thị đúng công cụ cần thiết (`Tệp`, `Tìm`, `Nhánh Git`, `Mục lục` ở trang Chat; `Kho ghi chú`, `Tìm`, `Đồ thị`, `Mục lục` ở trang Tri thức; `Kỹ năng`, `Tìm` ở trang Kỹ năng) và tự động thu gọn ở các trang quản trị (Quy trình, Token, Bộ nhớ, Cài đặt).

### 3. Luồng Chat Đồng nhất, Bảng Markdown & Hoạt động Công cụ gọn gàng
- **Hiển thị Bảng Markdown (GFM Tables) & Bong bóng chat tối ưu:** Hỗ trợ đầy đủ bảng dữ liệu Markdown, khối mã nguồn và bong bóng tin nhắn người dùng tinh gọn kèm nút `Tạo nhánh` (Fork) khi di chuột.
- **Luồng Hoạt động Công cụ (`Hoạt động công cụ`):** Tự động lọc bỏ các tiền tố shell rườm rà (`powershell.exe -Command`, `cmd.exe /c`), hiển thị gọn gàng số bước đã chạy và danh sách tệp đã chạm tới.
- **Thực thi Đa luồng Song song (`Đa luồng` / Parallel Worktree Arena):** Chạy song song từ 2 đến 8 nhánh Git Worktree cô lập cho cùng một yêu cầu (cùng model hoặc đa hãng) và gộp nhánh tốt nhất chỉ với 1 cú nhấp.

### 4. Kho Tri thức Markdown, Đồ thị Neural & Thư viện Kỹ năng
- **Kho Tri thức (`Tri thức`):** Kết nối trực tiếp thư mục Markdown hoặc Obsidian cục bộ, soạn thảo ghi chú với liên kết hai chiều `[[WikiLinks]]`, `#tags` và khám phá mạng lưới kiến thức qua **Đồ thị Liên kết (Neural Graph)**.
- **Kỹ năng & Bộ nhớ (`Kỹ năng` & `Bộ nhớ`):** Duyệt toàn bộ kỹ năng CLI/IDE đã cài, tạo `SKILL.md` riêng cho dự án và lọc bộ nhớ dài hạn của Agent theo từng dự án.

### 5. Bảo mật Đa tầng & Kiến trúc Chống Lag
- **Local-First & Mặc định Loopback (`127.0.0.1`):** Chỉ cho phép kết nối qua mạng LAN/Internet khi chạy ở chế độ Production kèm danh sách `WORKBENCH_ALLOWED_HOSTS` tường minh và mật khẩu Basic Auth tối thiểu 16 ký tự.
- **Lá chắn bảo mật API & Desktop:** Kiểm tra `Sec-Fetch-Site` + `Origin` chống CSRF, gắn header `Content-Security-Policy` (CSP), gọi CLI qua mảng tham số chống Command Injection và chặn SSRF.

---

## 📦 Yêu cầu hệ thống

- **Người dùng bộ cài Windows Desktop (`.exe`):** Không cần cài đặt Node.js hay npm (runtime đã được đóng gói sẵn).
- **Chạy từ mã nguồn hoặc tự đóng gói bộ cài:** Node.js **20.19 trở lên** và npm.
- **Git:** Dùng để kiểm tra trạng thái nhánh và tạo các nhánh Git worktree cô lập.
- **Agent (cài đặt bất kỳ công cụ nào bạn muốn sử dụng):**
  - CLI cục bộ: **Codex CLI**, **Claude Code**, hoặc **Antigravity CLI** (tự động nhận diện khi bật ứng dụng).
  - Nguồn API: **OpenAI**, **Anthropic Claude**, **Google Gemini**, **Ollama**, **LM Studio**, **LocalAI**, hoặc bất kỳ endpoint tương thích nào trong phần **Cài đặt**.

---

## 🚀 Cài đặt & Chạy nhanh từ mã nguồn

```sh
git clone https://github.com/BlackOwl242/OpenSybau.git
cd OpenSybau
npm ci
npm run dev
```

Mở <http://127.0.0.1:4173> trên trình duyệt. Trên Windows, bạn cũng có thể chạy nhanh bằng tệp [`start-workbench.bat`](start-workbench.bat).

Để chạy bản Production đã tối ưu:

```sh
npm ci
npm run build
npm start
```

---

## 🖥️ Đóng gói bộ cài đặt Windows Desktop (`.exe`)

```powershell
npm ci
npm run desktop:dist
```

- Tạo bộ cài đặt NSIS (`release/OpenSybau-Setup-<version>-x64.exe`) và bản giải nén chạy ngay (`release/win-unpacked/`).
- Tự tạo biểu tượng trên Desktop và Start Menu, giữ server cục bộ tại `127.0.0.1`, và lưu toàn bộ dữ liệu người dùng tách biệt tại `%APPDATA%\OpenSybau`.
- Hỗ trợ tự động kiểm tra bản cập nhật mới từ GitHub Releases.

---

## 📱 Điều khiển qua Điện thoại trong cùng mạng Wi-Fi (LAN)

1. **Biên dịch bản giao diện tối ưu trên máy tính chủ:**
   ```sh
   npm ci
   npm run build
   ```
2. **Xem địa chỉ IPv4 của máy chủ** (ví dụ `192.168.1.20` bằng lệnh `ipconfig` trên Windows).
3. **Sao chép `.env.example` thành `.env` và cấu hình:**
   ```dotenv
   WORKBENCH_HOST=0.0.0.0
   WORKBENCH_PORT=4173
   WORKBENCH_ALLOWED_HOSTS=192.168.1.20:4173
   WORKBENCH_ACCESS_USERNAME=opensybau
   WORKBENCH_ACCESS_PASSWORD=mat-khau-ngau-nhien-toi-thieu-16-ky-tu
   ```
   *(Mẹo tạo nhanh mật khẩu ngẫu nhiên: `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"`)*
4. **Mở cổng TCP `4173` trên tường lửa cho mạng Private**, sau đó khởi chạy:
   ```sh
   npm start
   ```
5. Mở `http://192.168.1.20:4173` trên trình duyệt điện thoại và đăng nhập.

---

## ⚙️ Bảng biến môi trường cấu hình (`.env`)

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `WORKBENCH_HOST` | `127.0.0.1` | Địa chỉ lắng nghe (`127.0.0.1` cho máy cục bộ, `0.0.0.0` cho mạng LAN). |
| `WORKBENCH_PORT` | `4173` | Cổng HTTP hoặc HTTPS. |
| `WORKBENCH_ALLOWED_HOSTS` | Các alias localhost | Danh sách `Host` được phép truy cập, phân tách bằng dấu phẩy. |
| `WORKBENCH_ACCESS_USERNAME` | `opensybau` | Tên đăng nhập Basic Auth. |
| `WORKBENCH_ACCESS_PASSWORD` | Chưa đặt | Mật khẩu Basic Auth (bắt buộc tối thiểu 16 ký tự khi mở mạng LAN/Internet). |
| `WORKBENCH_DATA_DIR` | `.runtime` | Thư mục lưu cài đặt, lịch sử task, khóa API cục bộ và Git worktree. |
| `WORKBENCH_TLS_CERT` / `KEY` | Chưa đặt | Đường dẫn chứng chỉ và khóa riêng TLS nếu bật HTTPS trực tiếp. |
| `CODEX_CLI_PATH` | Tự động dò | Đường dẫn tùy chỉnh tới tệp thực thi Codex CLI. |
| `CLAUDE_CLI_PATH` | Tự động dò | Đường dẫn tùy chỉnh tới Claude Code hoặc `cli.js`. |
| `ANTIGRAVITY_CLI_PATH` | Tự động dò | Đường dẫn tùy chỉnh tới Antigravity CLI. |
| `ANTHROPIC_API_KEY` | Chưa đặt | Khóa môi trường cho kết nối Claude API tích hợp sẵn. |
| `WORKBENCH_CLAUDE_MODEL` | Chưa đặt | Model ID mặc định cho Claude API tích hợp sẵn. |
| `WORKBENCH_API_PROVIDERS` | Chưa đặt | Mảng JSON khai báo thêm các nguồn API tương thích OpenAI/Anthropic. |

---

## 🗂️ Cấu trúc thư mục dự án

```text
desktop/        Tiến trình chính Electron, preload bridge và biểu tượng ứng dụng
docs/           Hình ảnh chụp màn hình hệ thống và tư liệu hướng dẫn
src/
  domain/       Logic nghiệp vụ luồng công việc, định tuyến vai trò và mô hình dữ liệu
  features/     Bộ điều khiển Workbench, Khung nhập liệu 2 tầng, Trình xem tệp đa cửa sổ và Đấu trường
  server/       Bộ dò tìm CLI, quản lý API provider và tiện ích hệ thống
  shared/       Hệ thống biểu tượng, đa ngôn ngữ (Việt/Anh) và hàm bổ trợ
  shell/        Khung ứng dụng kính mờ, thanh điều hướng trái và sidebar ngữ cảnh
  styles/       Hệ thống biến thiết kế, giao diện kính mờ và CSS thành phần
server.mjs      Máy chủ HTTP/SSE cục bộ, hàng đợi tác vụ, quản lý Git worktree và tiến trình CLI
scripts/        Trình khởi chạy đa nền tảng và bộ kiểm thử tích hợp tự động
public/         Biểu tượng thương hiệu OpenSybau và web app manifest
CHANGELOG.md    Nhật ký thay đổi qua từng phiên bản
LICENSE         Giấy phép nguồn mở MIT
```

---

## 🧪 Các lệnh Phát triển & Kiểm thử

| Lệnh | Công dụng |
| --- | --- |
| `npm ci` | Cài đặt đầy đủ các gói phụ thuộc theo lockfile. |
| `npm run dev` | Chạy máy chủ phát triển trên loopback kèm Vite hot reload. |
| `npm test` | Chạy bộ kiểm thử tự động (dò tìm CLI, phục hồi trạng thái, worktree, đấu trường). |
| `npm run build` | Biên dịch giao diện tối ưu vào thư mục `dist/`. |
| `npm start` | Khởi chạy máy chủ chế độ Production. |
| `npm run desktop:dist` | Biên dịch giao diện và đóng gói bộ cài Windows NSIS (`release/`). |

---

## 📄 Giấy phép (License)

Dự án được phân phối theo giấy phép **[MIT License](LICENSE)** — Copyright (c) 2026 **OpenSybau (BlackOwl242)**.
