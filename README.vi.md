# OpenSybau

**Trung tâm điều khiển các AI coding agent, chạy trên máy của bạn.** OpenSybau giúp quản lý nhiều workspace, cuộc trò chuyện, luồng agent và hoạt động thực thi qua giao diện trình duyệt. Task được chạy trên chính máy chủ OpenSybau bằng Codex CLI và Antigravity CLI đã cài trên máy đó.

**Documentation:** [English](README.md)

> OpenSybau phù hợp cho một người vận hành hoặc một mạng riêng nhỏ. Đây không phải dịch vụ nhiều người dùng. Không đưa ứng dụng ra Internet nếu chưa có HTTPS và lớp kiểm soát truy cập.

## Tính năng

- Quản lý nhiều workspace và các cuộc trò chuyện trong một giao diện.
- Mở chat với Codex, lập kế hoạch hoặc chạy luồng Codex → Antigravity → Codex.
- Theo dõi các stage, hoạt động agent, đầu ra và thay đổi workspace theo thời gian thực.
- Ghim, lưu trữ chat; tùy chọn tách task bằng Git worktree.
- Xem skill và tri thức cục bộ, lưu ghi chú để dùng cho task sau.
- Giao diện tự điều chỉnh cho điện thoại; có thể thêm lên màn hình chính như web app khi chạy qua HTTPS.
- CLI, thông tin đăng nhập, tệp workspace và lịch sử task được giữ trên máy chủ.

## Yêu cầu

- Node.js **20.19 trở lên** và npm.
- Git để kiểm tra workspace và tạo worktree riêng khi cần.
- Cài và đăng nhập Codex CLI trên máy chủ. Antigravity CLI là tùy chọn, chỉ cần cho các luồng sử dụng nó.
- Các thư mục workspace phải có trên máy chủ chạy OpenSybau.

Có thể chạy máy chủ trên Windows, macOS hoặc Linux. Hãy cài và đăng nhập từng CLI bằng cùng tài khoản hệ điều hành sẽ chạy server.

## Cài đặt nhanh

```sh
git clone <repository-url>
cd opensybau
npm ci
npm run dev
```

Mở <http://127.0.0.1:4173>. Chế độ phát triển chỉ nghe trên máy hiện tại và tự cập nhật giao diện khi sửa mã. Trên Windows, có thể chạy nhanh bằng [`start-workbench.bat`](start-workbench.bat).

Để chạy bản production đã tối ưu:

```sh
npm ci
npm run build
npm start
```

Production mặc định cũng chỉ cho truy cập trên máy chủ. Muốn truy cập qua mạng, cần cấu hình host cho phép và mật khẩu.

## Kết nối điện thoại cùng Wi-Fi

Máy tính đang chạy OpenSybau sẽ là máy chủ. Hãy để máy tính bật và kết nối mạng trong lúc điều khiển bằng điện thoại.

### 1. Build ứng dụng trên máy chủ

```sh
npm ci
npm run build
```

### 2. Tìm địa chỉ IP nội bộ của máy chủ

Trên Windows, mở PowerShell hoặc Command Prompt rồi chạy:

```powershell
ipconfig
```

Trong phần **Wi-Fi adapter** đang dùng, tìm **IPv4 Address**, ví dụ `192.168.1.20`. Trên macOS, xem địa chỉ Wi-Fi trong System Settings → Network. Trên Linux, chạy `ip addr` và xem card mạng đang hoạt động.

### 3. Bật truy cập qua LAN

Trong thư mục dự án trên máy chủ, sao chép cấu hình mẫu rồi mở để sửa:

```powershell
Copy-Item .env.example .env
notepad .env
```

Nếu dùng macOS/Linux, chạy `cp .env.example .env` rồi mở `.env` bằng trình soạn thảo văn bản. Điền các giá trị dưới đây; thay IP mẫu bằng IPv4 vừa tìm và đặt mật khẩu riêng dài ít nhất 16 ký tự:

```dotenv
WORKBENCH_HOST=0.0.0.0
WORKBENCH_PORT=4173
WORKBENCH_ALLOWED_HOSTS=192.168.1.20:4173
WORKBENCH_ACCESS_USERNAME=opensybau
WORKBENCH_ACCESS_PASSWORD=thay-bang-mat-khau-ngau-nhien-dai-cua-ban
```

`WORKBENCH_ALLOWED_HOSTS` phải khớp với địa chỉ (và cổng nếu có) mà bạn nhập trên trình duyệt điện thoại. Nếu IP của máy tính thay đổi, cần cập nhật dòng này.

### 4. Cho phép qua tường lửa máy chủ

Chỉ cho phép kết nối TCP cổng **4173** ở cấu hình mạng **Private**. Trên Windows, vào Windows Defender Firewall → Advanced settings → Inbound Rules để tạo luật mới. Không bật luật này cho mạng Public. Nếu đây là Wi-Fi nhà bạn đáng tin cậy nhưng Windows đang phân loại là Public, đổi profile của mạng Wi-Fi sang Private trong Settings trước; tuyệt đối không làm vậy khi dùng Wi-Fi công cộng.

### 5. Chạy OpenSybau và mở trên điện thoại

Trên máy chủ, chạy:

```sh
npm start
```

Trên điện thoại, kết nối cùng Wi-Fi, mở `http://192.168.1.20:4173` (thay IP ví dụ bằng địa chỉ thật của máy chủ), rồi nhập username và password đã đặt trong `.env` khi trình duyệt hỏi.

Giao diện điện thoại có thanh điều hướng dưới cùng và danh sách workspace/chat dạng trượt từ cạnh bên. Bạn có thể dùng trực tiếp trong trình duyệt. Nếu chạy qua HTTPS, mở menu trình duyệt và chọn **Add to Home Screen / Thêm vào màn hình chính** để tạo biểu tượng mở như app. Shortcut này vẫn cần kết nối mạng tới máy chủ.

### Nếu điện thoại không kết nối được

1. Kiểm tra điện thoại và máy chủ ở cùng Wi-Fi không phải mạng Guest. Một số router chặn thiết bị Guest truy cập lẫn nhau.
2. Đảm bảo cửa sổ chạy `npm start` vẫn đang mở trên máy chủ.
3. Kiểm tra URL có đúng IPv4 hiện tại và cổng `4173` không.
4. Kiểm tra `WORKBENCH_ALLOWED_HOSTS` có đúng host bạn đang mở, ví dụ `192.168.1.20:4173`.
5. Kiểm tra tường lửa đã cho phép cổng `4173` trong profile Private.

## Truy cập từ Internet

Để dùng ngoài mạng nội bộ, đặt OpenSybau sau hosting platform, HTTPS tunnel hoặc reverse proxy có TLS. Cấu hình `WORKBENCH_HOST=0.0.0.0`, cổng theo yêu cầu của host, `WORKBENCH_ALLOWED_HOSTS` khớp chính xác với public `Host` header, và `WORKBENCH_ACCESS_PASSWORD` đủ mạnh. Reverse proxy cần giữ nguyên Host header ban đầu. Vẫn bật xác thực OpenSybau ngay cả khi nền tảng host có trang đăng nhập riêng.

Không công khai ứng dụng qua HTTP thường và không chuyển tiếp cổng router tới server chưa xác thực. Đầu truy cập public phải dùng HTTPS và nên giới hạn người được phép truy cập. Basic Auth của OpenSybau dùng chung một tài khoản; ứng dụng chưa có tài khoản riêng hoặc phân quyền theo vai trò.

Máy chủ cần chạy được tiến trình Node.js lâu dài và truy cập được CLI cùng thư mục workspace. Nhiều nền tảng serverless hoặc tiến trình ngắn hạn không phù hợp. OpenSybau chạy task trên máy host; ứng dụng không tự sao chép repo hoặc phiên đăng nhập CLI từ máy cá nhân lên host. Mỗi bản cài có dữ liệu riêng trừ khi bạn chủ động cấu hình lưu trữ dùng chung.

HTTP chỉ nên dùng trong mạng LAN riêng đáng tin cậy vì thông tin đăng nhập và nội dung task không được mã hóa khi truyền. Nếu mạng LAN có người lạ hoặc không đáng tin, hãy bật HTTPS trực tiếp bằng cả `WORKBENCH_TLS_CERT` và `WORKBENCH_TLS_KEY`, hoặc đặt server sau proxy hỗ trợ TLS.

## Cấu hình

Sao chép `.env.example` thành `.env`. Git đã bỏ qua `.env`; không đưa file này hoặc bí mật vào repository.

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `WORKBENCH_HOST` | `127.0.0.1` | Địa chỉ bind. Dùng `0.0.0.0` cho LAN hoặc host platform. Bind ra ngoài loopback yêu cầu production, host allowlist và mật khẩu. |
| `WORKBENCH_PORT` | `4173` | Cổng HTTP hoặc HTTPS. |
| `WORKBENCH_ALLOWED_HOSTS` | Các alias localhost | Danh sách `Host` chính xác, phân tách bằng dấu phẩy; ví dụ `192.168.1.20:4173` hoặc `opensybau.example.com`. |
| `WORKBENCH_ACCESS_USERNAME` | `opensybau` | Username ở hộp thoại Basic Auth của trình duyệt. |
| `WORKBENCH_ACCESS_PASSWORD` | Chưa đặt | Bật Basic Auth. Khi truy cập qua mạng, bắt buộc dài ít nhất 16 ký tự. |
| `WORKBENCH_DATA_DIR` | `.runtime` | Nơi lưu cài đặt, lịch sử task, ghi chú, đầu ra và Git worktree. Đường dẫn tương đối tính từ thư mục dự án. |
| `WORKBENCH_TLS_CERT` | Chưa đặt | Đường dẫn certificate TLS. Phải dùng cùng `WORKBENCH_TLS_KEY`. |
| `WORKBENCH_TLS_KEY` | Chưa đặt | Đường dẫn private key TLS; giữ bí mật. |
| `CODEX_CLI_PATH` | Tự tìm | Có thể đặt đường dẫn đến Codex executable. |
| `ANTIGRAVITY_CLI_PATH` | Tự tìm | Có thể đặt đường dẫn đến Antigravity executable. |

Khi đặt password, tất cả route, tài nguyên tĩnh, API và luồng sự kiện đều yêu cầu xác thực. Server cũng kiểm tra Host và origin của các request từ trình duyệt. Chế độ development chỉ hoạt động trên loopback.

## Dữ liệu và cách chạy task

- Node.js server quản lý hàng đợi task, lưu dữ liệu, tiến trình CLI và cập nhật trực tiếp; frontend Preact/Vite được phục vụ từ cùng server.
- Lịch sử task, cài đặt, ghi chú, event và đầu ra được lưu tại `WORKBENCH_DATA_DIR` (mặc định `.runtime`). Hãy sao lưu thư mục này nếu cần giữ dữ liệu.
- Chế độ thường sửa workspace đã chọn và xếp tuần tự các task dùng chung workspace. Chế độ Git worktree tạo thư mục làm việc riêng nếu repo có ít nhất một commit; kết quả không tự merge.
- Codex lập kế hoạch và review ở chế độ chỉ đọc. Antigravity triển khai trong workspace đã chọn với sandbox của CLI.
- Task có thể sửa tệp trong workspace. Hãy xem kết quả và Git diff trước khi dùng thay đổi.
- Nút “Mở thư mục” mở file manager trên máy chủ. Trình duyệt điện thoại không thể mở file manager của máy chủ.

## Cấu trúc dự án

```text
src/
  domain/       Logic nghiệp vụ workflow và task
  features/     Các trang và thao tác Workbench
  shared/       State, helper và UI dùng chung
  shell/        Khung ứng dụng, điều hướng, sidebar và mobile nav
  styles/       Design token, shell và style từng tính năng
server.mjs      API cục bộ, runtime task, CLI và static-file server
scripts/        Launcher development/production đa nền tảng
public/         Tài nguyên tĩnh, icon và web app manifest
.runtime/       Dữ liệu cục bộ (Git bỏ qua)
```

## Lệnh phát triển

| Lệnh | Công dụng |
| --- | --- |
| `npm ci` | Cài các dependency đúng theo lockfile. |
| `npm run dev` | Chạy development trên loopback, có Vite hot reload. |
| `npm run build` | Tạo frontend tối ưu trong `dist/`. |
| `npm start` | Chạy production build và local API. |

Dừng server bằng `Ctrl+C` trong cửa sổ terminal. Nếu server dừng giữa task, hãy kiểm tra workspace trước khi chạy lại.
