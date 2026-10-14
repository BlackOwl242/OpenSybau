# <img src="public/opensybau.svg" alt="OpenSybau Logo" width="36" height="36" align="top" /> OpenSybau

**Trung tâm điều phối AI Coding Agent & Đấu trường Git Worktree song song chạy trực tiếp trên máy của bạn.**  
OpenSybau kết hợp **Codex CLI**, **Claude Code**, **Antigravity CLI** cùng các nguồn **API tương thích Anthropic / OpenAI** (bao gồm cả Ollama, LM Studio, LocalAI) trong một giao diện Desktop kính mờ hiện đại. Mọi tác vụ, cuộc trò chuyện và nhánh Git worktree đều thực thi trực tiếp trên máy tính của bạn — minh bạch, tốc độ cao và toàn quyền kiểm soát dữ liệu.

**Tài liệu:** [English](README.md) · **Nhật ký thay đổi:** [CHANGELOG.md](CHANGELOG.md) · **Giấy phép:** [MIT License](LICENSE)

---

## ✨ Điểm nổi bật mới nhất

### 1. Giao diện Kính mờ (Frosted-Glass) & Khung nhập liệu thông minh 2 tầng
- **Khung ứng dụng Windows Mica / Kính mờ:** Thanh điều hướng bên trái hiệu ứng kính mờ trong suốt kết hợp cùng khung làm việc chính bo góc nổi tinh tế.
- **Khung nhập liệu 2 tầng bám sát cạnh dưới (Bottom-Docked Two-Tier Composer):**
  - **Thanh ngữ cảnh tầng trên:** Chọn nhanh **Dự án (Workspace)**, chuyển đổi môi trường thực thi giữa **Máy tính này** (chạy trực tiếp trên nhánh hiện tại) và **Git Worktree** (tách nhánh cô lập an toàn), cùng 4 chế độ làm việc: **Chat**, **Code**, **Kế hoạch**, **Đấu trường**.
  - **Thanh điều khiển tầng dưới với Popover mở hướng lên:** Chọn nhanh **Agent & Model**, **Mức suy luận (Reasoning Effort)** (`Low` / `Medium` / `High` / `Max`), đính kèm tệp/ảnh (`+` hoặc gõ `@tên-tệp`), và **Popover Quyền thực thi của Agent**:
    - 🛡️ **Chỉ đọc an toàn (`read-only`):** Chỉ phân tích mã nguồn và trả lời, không tự ý sửa tệp trong dự án.
    - 🧑‍💻 **Đọc & sửa trong dự án (`workspace-write`):** Cho phép đọc, chỉnh sửa tệp và chạy công cụ trong phạm vi workspace.
    - ⚡ **Toàn quyền thực thi (`full-access`):** Tự động chạy lệnh, cài gói và thao tác tệp trên máy không giới hạn.

### 2. Đấu trường Đa nhánh Song song (`Đấu trường` / Parallel Worktree Arena)
- **Chạy song song từ 2 đến 8 nhánh Git Worktree cô lập:** Giao cùng một yêu cầu cho nhiều nhánh Agent giải quyết đồng thời mà không bao giờ đụng độ mã nguồn.
- **Hỗ trợ cả Cùng Model lẫn Đa Hãng:** Chạy **2× hoặc 3× bản của cùng một model** (ví dụ 3 nhánh cùng chạy một model để chọn ra lời giải tốt nhất như Orca) hoặc cho nhiều hãng (**Codex**, **Claude Code**, **Antigravity**, **API**) thi đấu với nhau.
- **Diff Review Studio & Gộp nhánh thắng chỉ với 1 cú nhấp:** So sánh trực tiếp số tệp thay đổi, lượng token tiêu thụ, nhật ký công cụ và bảng Diff của từng nhánh trước khi bấm **Gộp vào dự án**.

### 3. Định tuyến Pipeline Đa vai trò & Quản lý Hội thoại chuyên sâu
- **Tách biệt vai trò Lập kế hoạch – Triển khai – Review:** Tự do phối hợp các hãng AI khác nhau cho từng bước (ví dụ: Claude lập kế hoạch → Codex viết code → Antigravity kiểm tra và review).
- **Hàng đợi tin nhắn & Phân nhánh hội thoại (Fork):** Gửi liên tiếp nhiều tin nhắn vào hàng đợi khi Agent đang bận; tạo nhánh hội thoại mới (Fork) từ bất kỳ câu trả lời nào; gắn **Mục tiêu dài hạn & Checklist nghiệm thu**; lưu **Mẫu tác vụ (Task Templates)** có quản lý phiên bản.
- **Chạy lại từng giai đoạn (Stage Rerun):** Chạy lại pipeline từ bước Kế hoạch, Triển khai hoặc Review bất kỳ lúc nào mà vẫn giữ nguyên lịch sử đầu ra của các lần chạy trước.

### 4. Bảo mật Đa tầng & Kiến trúc Chống Lag
- **Local-First & Mặc định Loopback (`127.0.0.1`):** Chỉ cho phép kết nối qua mạng LAN/Internet khi chạy ở chế độ Production kèm danh sách `WORKBENCH_ALLOWED_HOSTS` tường minh và mật khẩu Basic Auth tối thiểu 16 ký tự.
- **Lá chắn bảo mật API & Desktop:** Kiểm tra `Sec-Fetch-Site` + `Origin` chống CSRF, gắn header `Content-Security-Policy` (CSP) và `X-Frame-Options: DENY`, kiểm tra phần mở rộng tệp thực thi CLI, cô lập biến môi trường `ELECTRON_RUN_AS_NODE`, và chặn SSRF tới các dải IP nội bộ / link-local / cloud metadata.
- **Tối ưu hóa tốc độ phản hồi (Zero-Lag):** Bộ nhớ đệm TTL 60 giây cho quá trình dò CLI và đọc Registry trên Windows (loại bỏ hoàn toàn hiện tượng khựng giao diện do tiến trình con), gom nhóm ghi đĩa bất đồng bộ (`schedulePersist`), quét cây thư mục song song, và giữ nguyên trạng thái menu đang mở cùng vị trí con trỏ khi nhận luồng sự kiện SSE thời gian thực.

---

## 📦 Yêu cầu hệ thống

- **Người dùng bộ cài Windows Desktop (`.exe`):** Không cần cài đặt Node.js hay npm (runtime đã được đóng gói sẵn).
- **Chạy từ mã nguồn hoặc tự đóng gói bộ cài:** Node.js **20.19 trở lên** và npm.
- **Git:** Dùng để kiểm tra trạng thái nhánh, xem Diff và tạo các nhánh Git worktree cô lập.
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
src/
  domain/       Logic nghiệp vụ luồng công việc, định tuyến vai trò và mô hình dữ liệu
  features/     Bộ điều khiển Workbench, Khung nhập liệu 2 tầng, Diff Studio và Đấu trường
  server/       Bộ dò tìm CLI, quản lý API provider và tiện ích hệ thống
  shared/       Hệ thống biểu tượng, đa ngôn ngữ (Việt/Anh) và hàm bổ trợ
  shell/        Khung ứng dụng kính mờ, thanh bên trái và điều hướng di động
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
