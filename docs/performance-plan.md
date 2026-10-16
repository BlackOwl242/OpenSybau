# Kế hoạch ổn định cập nhật và tối ưu hiệu năng OpenSybau

Ngày: 2026-10-17. Phạm vi: web, Windows và Linux; giữ nguyên giao diện và dữ liệu đã lưu.

## Nguyên nhân và thay đổi trong 0.2.88

1. Mỗi sự kiện task trước đây tải toàn bộ `/api/state` rồi thay `innerHTML` của vùng chat và dock. Cách này có thể tạo lại iframe, mất trạng thái form/menu và cuộn khung chat, khiến người dùng thấy như ứng dụng tải lại. Bản mới cập nhật các nút DOM hiện có theo định danh, giữ preview, bản nháp, vị trí nhập và trạng thái mở của dropdown. Mỗi khung chat giữ vị trí cuộn riêng; thao tác gửi vẫn xóa nội dung đã gửi.
2. Vite trước đây theo dõi cả thư mục runtime/worktree và đầu ra đóng gói. HTML do agent sinh ra trong những thư mục đó có thể đi vào luồng reload của môi trường phát triển. Bản mới bỏ qua `.runtime`, `release`, `dist` và thư mục dữ liệu cấu hình riêng; thay đổi mã nguồn thật vẫn được theo dõi. Bản desktop dùng production build, không chạy Vite.
3. Kiểm tra trạng thái định kỳ trước đây luôn trả cả lịch sử task. Snapshot mới được tuần tự hóa một lần cho mỗi revision và trả ETag. Khi dữ liệu không đổi, server trả HTTP 304 không có body; trình duyệt giữ trạng thái đang có và bỏ lần render đó. Snapshot được làm mới tối đa mỗi phút khi không có thao tác để thống kê theo thời gian không bị cũ. Định danh của mỗi lần khởi động server bảo đảm dữ liệu được lấy lại đúng khi kết nối trở lại.
4. Log dồn dập được gộp trước khi phát sự kiện; cập nhật nền ở client cách nhau ít nhất 600 ms. Sự kiện khi tab bị ẩn không khởi tạo lượt tải nền mới; khi quay lại tab, client đồng bộ ngay. SSE có heartbeat 20 giây, khoảng thử nối lại 3 giây và xử lý backpressure để tránh tích lũy buffer cho client chậm. Có kiểm tra dự phòng khi mất kết nối hoặc trạng thái quá 60 giây chưa được kiểm tra.
5. Việc ghi snapshot cho log được gộp với cửa sổ 750 ms; các mốc chuyển trạng thái vẫn ghi ngay và shutdown vẫn flush dữ liệu. Các câu trả lời Markdown được cache có giới hạn 128 mục và 2 triệu ký tự cả nguồn/kết quả. Bộ dịch DOM chỉ xử lý nhánh thay đổi, bỏ qua nội dung hội thoại/mã nguồn. Canvas đồ thị được giữ khi dữ liệu đồ thị không đổi.

## Kiểm tra hồi quy

- `npm test`: chức năng task, worktree, dữ liệu lưu, quyền truy cập, phát hiện CLI và bản dịch. Bổ sung kiểm tra 304 không có body, invalidation sau thay đổi task và cập nhật qua cùng kết nối SSE.
- `npm run test:performance`: kiểm tra snapshot chỉ tạo một lần trong 100 lượt đọc không đổi; thay revision, hết hạn, khởi động lại và phục hồi sau lỗi mạng; kiểm tra DOM bằng Electron với 50 lượt cập nhật, đảo thứ tự khung, bản nháp, caret/focus, dropdown, vị trí cuộn riêng và iframe không reload; kiểm tra Vite theo dõi mã nguồn và bỏ qua tệp HTML sinh ra.
- Tất cả fixture nằm trong kiểm thử riêng, không thêm task/memory mẫu vào UI vận hành. CSS và nội dung thiết kế không thay đổi.

## Các bước tối ưu tiếp theo theo số liệu thực tế

| Ưu tiên | Khi nào thực hiện | Phương án | Tiêu chí đánh giá |
| --- | --- | --- | --- |
| 1 | Snapshot thực tế vượt 5 MB hoặc phân tích JSON/render thường xuyên vượt 50 ms | Tách danh sách task dạng tóm tắt và tải lịch sử đầy đủ theo khung đang mở; đồng bộ từng task theo revision. Giữ toàn bộ lịch sử trên máy. | Đổi trạng thái một task không truyền lại nội dung các task còn lại; luồng chat/khung và thao tác hiện có giữ nguyên. |
| 2 | Quét CLI là phần chiếm thời gian khởi động chính | Tải trạng thái workspace trước, quét catalog CLI theo kênh riêng và cập nhật sau khi quét xong. Không dùng model giả hoặc danh sách đóng cứng. | Có thể đọc hội thoại trước khi CLI phản hồi; lựa chọn model vẫn đến từ catalog runtime. |
| 3 | Ghi JSON trên dữ liệu thực tế thường chặn event loop trên 20 ms | Chuyển việc ghi sang hàng đợi bất đồng bộ tuần tự với atomic rename, kiểm thử phục hồi sau crash và flush khi tắt; cân nhắc SQLite cục bộ nếu lịch sử tăng lớn. | Không ghi đè snapshot mới bằng snapshot cũ; task/event đã xác nhận được khôi phục sau khi mở lại. |
| 4 | Danh sách hàng nghìn chat hoặc hội thoại rất dài gây long task | Chỉ dựng các hàng/lượt trả lời trong vùng nhìn thấy, vẫn hỗ trợ tìm kiếm và nhảy đến lượt trả lời ngoài vùng nhìn thấy. | Cuộn và nhập liệu ổn định với dữ liệu lớn, không mất khả năng xem lịch sử. |

Theo dõi thời gian phản hồi `/api/state`, số byte truyền, số lượt render, long task trên renderer và thời gian ghi đĩa khi đo. Không bật ghi nội dung prompt hay thông tin xác thực để đo hiệu năng. Những ngưỡng trên là điều kiện lựa chọn bước tiếp theo, không phải cam kết hiệu năng trên mọi cấu hình máy. Kiến trúc vẫn local-first, không bổ sung service stack hoặc orchestration framework.
