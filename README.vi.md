# OpenSybau

**Trung tâm điều khiển các AI coding agent, chạy trên máy của bạn.** OpenSybau giúp quản lý nhiều workspace, cuộc trò chuyện, luồng agent và hoạt động thực thi qua giao diện trình duyệt. Task chạy trên máy chủ OpenSybau bằng các CLI và API provider bạn đã cấu hình.

**Documentation:** [English](README.md)

**Ứng dụng Windows:** OpenSybau có thể đóng gói thành bộ cài Windows cho tài khoản người dùng hiện tại. App tự chạy runtime đi kèm, chỉ mở server trên `127.0.0.1`, và lưu cấu hình cùng dữ liệu riêng trong hồ sơ Windows của bạn.

> OpenSybau phù hợp cho một người vận hành hoặc một mạng riêng nhỏ. Đây không phải dịch vụ nhiều người dùng. Không đưa ứng dụng ra Internet nếu chưa có HTTPS và lớp kiểm soát truy cập.

## Tính năng

- Quản lý nhiều workspace và các cuộc trò chuyện trong một giao diện.
- Tự chọn provider riêng cho lập kế hoạch, triển khai và review giữa các CLI Codex, Antigravity và Claude Code đã cài.
- Thêm API Anthropic/OpenAI-compatible trong Cài đặt, kể cả endpoint local của Ollama, LM Studio và LocalAI.
- Theo dõi các stage, hoạt động agent, đầu ra và thay đổi workspace theo thời gian thực.
- Đổi tên chat, gửi nhiều tin nhắn theo hàng đợi tuần tự, fork từ lượt đã hoàn tất, ghim, lưu trữ và khôi phục chat; tùy chọn tách task bằng Git worktree.
- Lưu mục tiêu dài hạn và checklist nghiệm thu cho các lượt chat tiếp theo; chọn preset chỉ đọc hoặc cho phép sửa workspace.
- Lưu mẫu tác vụ có phiên bản cho luồng, quyền và lựa chọn agent/model; chạy lại pipeline đã hoàn tất hoặc thất bại từ Plan, Build hay Review, đồng thời giữ đầu ra trước đó trong lịch sử task.
- Fork chỉ tạo nhánh hội thoại; các nhánh vẫn dùng chung workspace. Preset chỉ đọc dùng sandbox read-only cho Codex, plan mode cho Claude, chặn ghi qua API và chặn Antigravity CLI vì CLI chưa có chế độ chỉ đọc riêng cho lần chạy nền.
- Sắp xếp dự án theo section, ghim dự án và mở thư mục dự án trên máy chủ.
- Xem skill và tri thức cục bộ, lưu ghi chú để dùng cho task sau.
- Giao diện tự điều chỉnh cho điện thoại; có thể thêm lên màn hình chính như web app khi chạy qua HTTPS.
- CLI, thông tin đăng nhập, tệp workspace và lịch sử task được giữ trên máy chủ.

## Yêu cầu

- Người cài bản desktop không cần tự cài Node.js hoặc npm.
- Cần Node.js **20.19 trở lên** và npm nếu chạy từ mã nguồn hoặc tự build bộ cài.
- Git để kiểm tra workspace và tạo worktree riêng khi cần.
- Cài và cấu hình ít nhất một provider muốn sử dụng trên máy chủ. Codex CLI, Antigravity CLI và Claude Code đều là các agent cục bộ tùy chọn.
- Có thể cấu hình API provider trong Cài đặt hoặc bằng biến môi trường. Chúng có thể chat, lập kế hoạch, review hoặc triển khai thay đổi có giới hạn trên các tệp văn bản từ ngữ cảnh được gửi kèm; chúng không chạy được công cụ trong workspace.
- Các thư mục workspace phải có trên máy chủ chạy OpenSybau.

Có thể chạy máy chủ trên Windows, macOS hoặc Linux. Hãy cài và đăng nhập từng CLI bằng cùng tài khoản hệ điều hành sẽ chạy server.

## Tạo bộ cài desktop Windows

Trên Windows, cài các gói dự án rồi build bộ cài NSIS:

```powershell
npm ci
npm run desktop:dist
```

Bộ cài nằm trong thư mục `release/`. App cài cho tài khoản hiện tại và tạo shortcut trong Start menu cùng Desktop. Bản EXE tự kiểm tra GitHub Releases khi khởi động, tải bản mới ở nền và hỏi bạn khởi động lại để cài. Lần mở đầu, OpenSybau kiểm tra Codex CLI, Claude Code và Antigravity CLI; chỉ cần cài những agent bạn muốn dùng rồi chọn **Quét lại**. Bạn cũng có thể cấu hình API từ hướng dẫn khởi động. OpenSybau không tự cài công cụ bên thứ ba.

Desktop app chỉ mở server trên `127.0.0.1`. Nếu muốn điều khiển bằng điện thoại hoặc máy khác trong mạng, hãy làm theo hướng dẫn chạy browser-host bên dưới.

Cấu hình, API key, hội thoại và dữ liệu task được lưu riêng tại `%APPDATA%\OpenSybau`, không nằm trong thư mục cài app.

## Cài đặt nhanh

```sh
git clone https://github.com/BlackOwl242/OpenSybau.git
cd OpenSybau
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

Trên máy chủ, mở `http://127.0.0.1:4173` không cần mật khẩu. Trên điện thoại, kết nối cùng Wi-Fi và mở `http://192.168.1.20:4173` (thay IP ví dụ bằng địa chỉ thật của máy chủ); trình duyệt sẽ hỏi thông tin đăng nhập. Username mặc định là `opensybau`, còn password là giá trị bạn đặt trong `.env`.

Nếu chưa có password, tạo một chuỗi ngẫu nhiên bằng Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Chép kết quả vào `WORKBENCH_ACCESS_PASSWORD` trong `.env`, rồi khởi động lại `npm start`. Hãy lưu lại chuỗi này để đăng nhập từ điện thoại; OpenSybau không tự đặt một mật khẩu mặc định dùng chung cho mọi người.

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
| `CLAUDE_CLI_PATH` | Tự tìm | Có thể đặt đường dẫn Claude Code, bao gồm entry point `cli.js`. |
| `ANTHROPIC_API_KEY` | Chưa đặt | Bí mật tùy chọn để bật connector Claude API tích hợp. Chỉ đọc từ môi trường máy chủ. |
| `WORKBENCH_CLAUDE_MODEL` | Chưa đặt | Model ID hiển thị trong connector Claude API. |
| `WORKBENCH_CLAUDE_MODELS` | Chưa đặt | Danh sách model Claude API tùy chọn, phân tách bằng dấu phẩy hoặc JSON array. |
| `WORKBENCH_CLAUDE_BASE_URL` | `https://api.anthropic.com/v1` | Base URL tùy chọn cho API tương thích Anthropic. Bắt buộc HTTPS, trừ localhost. |
| `WORKBENCH_API_PROVIDERS` | Chưa đặt | JSON array tùy chọn để khai báo tối đa 12 API provider bổ sung; Cài đặt còn hỗ trợ quản lý tối đa 20 provider cục bộ. |

### Định tuyến provider và cấu hình API

Mỗi task có thể chọn riêng provider, model và mức suy nghĩ cho **Lập kế hoạch**, **Triển khai** và **Review**. Ví dụ: Claude lập kế hoạch → Codex triển khai → Antigravity review, nếu các CLI tương ứng đã cài và sẵn sàng. Bạn có thể đặt mặc định trong **Cài đặt** hoặc ghi đè khi tạo từng task. Chat có lựa chọn provider riêng. Thêm endpoint API ngay trong **Cài đặt → Nguồn AI và model**, mỗi dòng nhập một model ID. Ollama, LM Studio và LocalAI có thể dùng HTTP trên `localhost` mà không cần API key; endpoint cloud phải dùng HTTPS.

CLI cục bộ có thể xem workspace đã đăng ký và dùng công cụ của chính CLI đó. Claude Code là tùy chọn; hãy cài và đăng nhập trên máy chủ, hoặc đặt `CLAUDE_CLI_PATH` nếu hệ thống không tự tìm thấy.

Để bật connector Claude API tích hợp, điền key và model vào `.env`:

```dotenv
ANTHROPIC_API_KEY=your-key
WORKBENCH_CLAUDE_MODEL=your-model-id
```

Để thêm endpoint khác, đặt key trong một biến riêng rồi khai báo provider bằng JSON trên một dòng. Ví dụ:

```dotenv
EXAMPLE_API_KEY=your-key
WORKBENCH_API_PROVIDERS='[{"id":"example-api","name":"Example API","protocol":"openai-compatible","baseUrl":"https://api.example.com/v1","apiKeyEnv":"EXAMPLE_API_KEY","models":["your-model-id"]}]'
```

Dùng `protocol: "anthropic"` cho endpoint tương thích Anthropic Messages hoặc `protocol: "openai-compatible"` cho endpoint tương thích Chat Completions. Mỗi provider cần ID chữ thường duy nhất, `baseUrl` dùng HTTPS (HTTP chỉ được phép cho localhost), và ít nhất một model ID. API key từ môi trường chỉ đọc tại máy chủ. Key nhập trong Cài đặt được lưu riêng trong `WORKBENCH_DATA_DIR`; chúng không được trả về trình duyệt hoặc lưu trong cài đặt task. Chỉ nhập key từ localhost hoặc qua HTTPS. Khởi động lại OpenSybau sau khi sửa `.env`.

API provider có thể chat, lập kế hoạch, review và triển khai. Chúng nhận yêu cầu cùng ngữ cảnh do OpenSybau chuẩn bị; khi lập kế hoạch/review, ngữ cảnh có thể gồm đường dẫn, manifest, diff hoặc một số tệp mã nguồn. Khi triển khai, model trả về danh sách có cấu trúc gồm nội dung đầy đủ của các tệp văn bản; OpenSybau kiểm tra rồi ghi các tệp đó bên trong workspace đã chọn. Mỗi task API được giới hạn tối đa 40 tệp và 1 MB nội dung; model không chạy lệnh hoặc đọc thêm tệp ngoài ngữ cảnh đã gửi. **Ngữ cảnh này được gửi khỏi máy chủ tới API provider đã cấu hình.** Chọn CLI cục bộ nếu task cần tự đọc workspace, chạy công cụ, hiểu repo rộng hơn hoặc chỉnh sửa lặp nhiều lần.

Chỉ cấu hình API bạn tin cậy. Chi phí, thời gian lưu và chính sách dữ liệu do dịch vụ provider kiểm soát.

Khi đặt password, tất cả route, tài nguyên tĩnh, API và luồng sự kiện đều yêu cầu xác thực. Server cũng kiểm tra Host và origin của các request từ trình duyệt. Chế độ development chỉ hoạt động trên loopback.

## Dữ liệu và cách chạy task

- Node.js server quản lý hàng đợi task, lưu dữ liệu, tiến trình CLI và cập nhật trực tiếp; frontend Preact/Vite được phục vụ từ cùng server.
- Lịch sử task, cài đặt, ghi chú, event, cấu hình provider, API key và đầu ra được lưu tại `WORKBENCH_DATA_DIR` (mặc định `.runtime`). Hãy sao lưu và bảo vệ thư mục này như các thông tin đăng nhập cục bộ khác.
- Chế độ thường sửa workspace đã chọn và xếp tuần tự các task dùng chung workspace. Chế độ Git worktree tạo thư mục làm việc riêng nếu repo có ít nhất một commit; kết quả không tự merge.
- Task lưu provider/model riêng cho mỗi vai trò. CLI làm việc trong workspace theo cơ chế quyền riêng; API provider triển khai thay đổi tệp văn bản có giới hạn từ ngữ cảnh được gửi kèm nhưng không chạy công cụ trong workspace.
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
