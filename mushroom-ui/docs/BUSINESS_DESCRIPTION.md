# TÀI LIỆU MÔ TẢ NGHIỆP VỤ - MUSHROOM UI

Tài liệu này mô tả chi tiết các nghiệp vụ cốt lõi, ngưỡng sinh học, quy tắc kiểm soát thiết bị, và các cơ chế bảo vệ tự động được triển khai trong ứng dụng giám sát và điều khiển nhà trồng nấm rơm thông minh (**Mushroom UI**).

---

## 1. Tổng Quan Hệ Thống

Ứng dụng **Mushroom UI** là giao diện điều hành thuộc hệ thống nông nghiệp thông minh, được tối ưu hóa đặc biệt cho quy trình nuôi trồng nấm rơm nhiệt đới (*Volvariella volvacea*) tại khu vực Đồng bằng sông Cửu Long (như An Giang, Đồng Tháp, Cần Thơ).

*   **Quy mô thiết kế**: Nhà nấm dạng trụ đứng tiêu chuẩn với chính xác **35 trụ trồng**.
*   **Không gian lắp đặt**: Diện tích phòng nuôi trồng cố định **4m x 6m**.
*   **Mục tiêu**: Tối ưu hóa chu kỳ sinh trưởng của nấm thông qua hệ thống điều khiển thông minh (Logic mờ - Fuzzy Logic), bảo vệ cây trồng trước thời tiết khắc nghiệt bằng các rào cản sinh học (Biological Guardrails) và đảm bảo an toàn phần cứng.

---

## 2. Ngưỡng Môi Trường Sinh Học (Biological Guardrails)

Hệ thống theo dõi các chỉ số môi trường từ 3 cảm biến chuyên dụng có độ bền cao trong môi trường ẩm. Giao diện hiển thị trạng thái theo các dải màu trực quan: **Tối ưu (Emerald - Xanh lục)**, **Cảnh báo (Amber - Hổ phách)**, và **Nguy hiểm (Crimson - Đỏ)**.

### A. Nhiệt độ cơ chất (Cảm biến nhiệt DS18B20 chống nước)
*   **Giai đoạn nuôi tơ (Mycelial Growth - Ngày 1-8)**: Nhiệt độ tối ưu dao động nghiêm ngặt từ **30°C đến 35°C**.
*   **Giai đoạn ra quả thể (Fruiting Body - Ngày 9-21)**: Nhiệt độ tối ưu giảm nhẹ, duy trì từ **28°C đến 30°C**.
*   **Dải hiển thị tuyệt đối trên giao diện**: 20°C đến 40°C.
*   **Quy tắc phân loại trạng thái trên UI**:
    *   **Tối ưu (Emerald)**: 28°C - 35°C.
    *   **Cảnh báo (Amber)**: 20°C - 27°C (chậm phát triển tơ) hoặc 36°C - 38°C (sốc nhiệt nóng).
    *   **Nguy hiểm (Crimson)**: `< 20°C` (nguy cơ chết tơ nấm vĩnh viễn) hoặc `> 38°C` (suy giảm lứa trồng nghiêm trọng).

### B. Độ ẩm không khí tương đối (Cảm biến không khí SHT30)
*   **Ngưỡng tối ưu**: Phải được duy trì chặt chẽ trong khoảng **70% đến 90%** trong suốt toàn bộ chu kỳ sinh trưởng để nấm đạt chất lượng cao nhất.
*   **Dải hiển thị tuyệt đối trên giao diện**: 50% đến 100%.
*   **Quy tắc phân loại trạng thái trên UI**:
    *   **Tối ưu (Emerald)**: 70% - 90%.
    *   **Cảnh báo (Amber)**: 60% - 69% (nguy cơ khô hạn bề mặt) hoặc 91% - 95% (nguy cơ quá bão hòa nước).
    *   **Nguy hiểm (Crimson)**: `< 60%` hoặc `> 95%` (gây rụng đầu kim nấm hoặc bùng phát dịch bệnh nhiễm tạp).

### C. Nồng độ CO2 (Cảm biến SCD30)
*   **Ngưỡng tối ưu**: **800 ppm đến 1200 ppm** nhằm đảm bảo lưu thông khí tươi mà không làm mất độ ẩm cục bộ.
*   **Quy tắc phân loại trạng thái trên UI**:
    *   **Tối ưu (Emerald)**: 800 - 1200 ppm.
    *   **Cảnh báo (Amber)**: 1201 - 1500 ppm (lưu thông không khí không đủ).
    *   **Nguy hiểm (Crimson)**: `> 1500 ppm` (gây biến dạng thân nấm, nấm bị dài và nhỏ mũ).

---

## 3. Quy Tắc Vận Hành Thiết Bị Chấp Hành (Actuators)

Giao diện hiển thị trực quan và đồng bộ hóa trạng thái hoạt động thực tế của các thiết bị dựa trên tính toán điều khiển logic mờ:

### A. Hệ thống phun sương di động trên đường ray (Movable Rail Misting)
*   **Cấu trúc vật lý**: Loại bỏ hoàn toàn đường ống dẫn PVC cố định thông thường. Hệ thống sử dụng một **máy tạo ẩm siêu âm 6 vỉ** lắp trên xe đẩy chạy dọc đường ray treo ở trần phòng (kích thước 4m x 6m).
*   **Cơ chế truyền động**: Động cơ đảo chiều 220V, tốc độ cố định 60 vòng/phút, kéo bằng hệ thống ròng rọc và dây cáp.
*   **Quy tắc hiển thị và kiểm soát trên UI**:
    *   **Chỉ hướng di chuyển**: Hiển thị hướng hoạt động gồm `FORWARD` (Tiến), `BACKWARD` (Lùi), hoặc `IDLE` (Dừng).
    *   **Thanh định vị (Position Slider)**: Thể hiện vị trí thực tế của xe phun sương theo dải từ 0% (Điểm đầu) đến 100% (Điểm cuối).
    *   **Công tắc giới hạn hành trình (End-Limit Switches)**: Hai công tắc cơ học đặt ở hai đầu biên đường ray. Khi cảm biến chạm biên chạm trạng thái `true`, UI sẽ hiển thị quá trình tự động đổi chiều động cơ.

### B. Quạt đối lưu không khí (Convection Fans)
*   **Mục tiêu**: Phân phối đều lượng sương mịn từ máy phun sương di động, tránh hiện tượng tụ ẩm ướt cục bộ hoặc chênh lệch nhiệt ẩm giữa các trụ nấm.
*   **Quy tắc trên UI**: Hiển thị chu kỳ nhiệm vụ PWM (0-100% công suất) nhận được từ bộ suy luận logic mờ.

### C. Đèn gia nhiệt (Heating Lamps)
*   **Số lượng**: Trang bị đúng **2 bóng đèn** nhiệt chuyên dụng.
*   **Khóa thời gian (Time-Lock)**: Chỉ được phép hoạt động trong **giai đoạn nuôi tơ (ngày 1-8)**. Khi chu kỳ sang giai đoạn quả thể (từ ngày 9 trở đi), đèn gia nhiệt bắt buộc phải **khóa tắt hoàn toàn (Forced Lockout = OFF)** trên hệ thống và hiển thị cảnh báo an toàn sinh học trên giao diện để tránh làm khô bề mặt quả thể.

---

## 4. Cơ Chế Bảo Vệ Tự Động & An Toàn Hệ Thống

Để đối phó với điều kiện thời tiết khắc nghiệt của khu vực miền Tây, phần mềm tích hợp các cơ chế bảo vệ đặc thù:

### A. Khóa bảo vệ tránh sốc nhiệt giữa trưa (Midday Thermal Shock Protection)
*   **Bối cảnh nghiệp vụ**: Vào những giờ nắng nóng cực điểm (từ 11:00 AM đến 13:30 PM), việc kích hoạt phun sương nước lạnh đột ngột sẽ tạo ra cú sốc nhiệt cực lớn đối với nấm rơm, làm hỏng tơ nấm.
*   **Quy tắc phần mềm**: Tự động kích hoạt **Khóa sương (Misting Blackout)** trong khung giờ **11:00 AM - 13:30 PM**. Toàn bộ tính năng phun sương tự động sẽ bị vô hiệu hóa, và trên màn hình Dashboard xuất hiện huy hiệu bảo vệ nổi bật: **"Midday Thermal Guard Active" (Khóa sốc nhiệt đang bật)**.

### B. Sao lưu telemetry và duy trì dữ liệu khi mất kết nối (SD Card Backup & Cloud Sync)
*   **Nghiệp vụ**: Các nút IoT truy vấn cảm biến và lưu trực tiếp dữ liệu lịch sử vào thẻ nhớ SD cục bộ định kỳ **5 phút một lần** để bảo vệ dữ liệu khi mất mạng Internet/Wifi.
*   **Quy tắc trên UI**: Hiển thị trạng thái đồng bộ rõ ràng: `SD CARD: OK (LOGGING LOCAL)` và `CLOUD DATABASES: SYNCED`.

### C. Tích hợp nguồn điện dự phòng (UPS Integration)
*   **Nghiệp vụ**: Hệ thống luôn được cấp nguồn qua bộ lưu điện (UPS) để tránh gián đoạn khi lưới điện khu vực bị ngắt.
*   **Quy tắc trên UI**: Thanh điều hướng (Header) cập nhật liên tục trạng thái nguồn:
    *   **Điện lưới (Grid Power - Emerald)**: Hoạt động bình thường.
    *   **Nguồn UPS dự phòng (UPS Battery Active - Amber)**: Nhấp nháy cảnh báo đỏ/vàng khi mất điện lưới, báo hiệu các hệ thống cảm biến và bộ điều khiển thiết yếu đang chạy bằng pin để duy trì môi trường sống của nấm.

---

## 5. Các Tính Năng Trên Giao Diện Người Dùng (Mushroom UI Features)

### A. Dashboard Giám Sát Thời Gian Thực (Real-time Telemetry Dashboard)
*   Hiển thị ba chỉ số chính: Độ ẩm không khí, Nhiệt độ giá thể và Nồng độ CO2.
*   Mỗi chỉ số đi kèm các thông tin chuyên sâu:
    *   **Giá trị thực đo ($SM_{đo}$)**
    *   **Giá trị đặt mục tiêu ($SM_{set}$)** từ đường cong thiết lập sinh trưởng.
    *   **Sai số ($E = SM_{set} - SM_{đo}$)**.
    *   **Xu hướng thay đổi (Trend)** và mức công suất phát của thiết bị điều khiển tương ứng (PWM %).

### B. Bộ Cân Bằng Logic Mờ (Fuzzy Logic Equalizer)
*   Cho phép người trồng thiết lập đường cong nhiệt độ và độ ẩm mong muốn suốt chu kỳ từ **10 đến 45 ngày** (mặc định là 21 ngày).
*   **Cơ chế kéo thả điểm mốc (Drag & Drop Checkpoints)**:
    *   Các giá trị điểm mốc được làm tròn và bắt dính (snap) ở bước nhảy **0.5 đơn vị**.
    *   Nhiệt độ giới hạn kéo từ `20.0°C` đến `40.0°C`. Độ ẩm giới hạn từ `50.0%` đến `100.0%`.
    *   **Neo điểm mốc cố định (Anchor points)**: Điểm mốc của Ngày 1 và Ngày cuối cùng (ví dụ Ngày 21) bị khóa trục X (không thể thay đổi ngày hay xóa bỏ), chỉ cho phép kéo thay đổi giá trị trục Y.

### C. Lịch Trình Chiếu Sáng (Light Schedule Timeline)
*   Thiết lập dạng các khối nhị phân ON/OFF liên tục từ Ngày 1 đến Ngày cuối, không cho phép khoảng trống hoặc sự chồng lấn thời gian giữa các khối.

### D. Các Hồ Sơ Thiết Lập Sẵn (Profile Presets)
Hệ thống cung cấp 3 hồ sơ được cấu hình tối ưu sẵn theo kinh nghiệm canh tác:
1.  **Tối ưu mùa khô**: Tăng cường ẩm độ mục tiêu, giãn chu kỳ phun sương.
2.  **Tối ưu mùa mưa**: Giảm nhiệt độ thiết lập, kiểm soát tốt nồng độ ẩm cao nhằm ngăn chặn nấm mốc.
3.  **Kích quả nhanh**: Đẩy nhanh tơ phát triển sang quả thể bằng cách tối ưu hóa nhiệt độ cao trong những ngày đầu.

### E. Sandbox Giả Lập Dành Cho Nhà Phát Triển (Dev Test Sandbox)
*   Ngăn kéo ẩn (Drawer) cung cấp bảng mô phỏng IoT: Cho phép điều chỉnh giá trị ảo của cảm biến, tăng tốc độ mô phỏng thời gian (Multiplier từ 1x đến 60x) để kiểm thử phản ứng của hệ thống logic mờ và các cơ chế khóa sinh học mà không cần chờ đợi ngày thực tế.
