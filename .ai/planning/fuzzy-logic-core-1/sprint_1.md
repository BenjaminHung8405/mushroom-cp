# SPRINT 1: LÕI THUẬT TOÁN MỜ, ĐỘNG HỌC & ĐIỀU KHIỂN TPC (CORE 1)

> **⚠️ LƯU Ý QUAN TRỌNG — SSR + TPC:**
> Hệ thống điều khiển SSR bằng **TPC (Time-Proportional Control)**, không dùng PWM tần số cao. Demand mờ `[0.0, 1.0]` được chuyển thành tỷ lệ thời gian ON/OFF trong cửa sổ TPC bằng `digitalWrite()`.
> `0.0` nghĩa là SSR luôn OFF, `1.0` nghĩa là SSR luôn ON; các giá trị giữa hai biên là ON trong một phần cửa sổ. Cửa sổ TPC và thời gian ON/OFF tối thiểu phải cấu hình được theo thiết bị để ngăn đóng cắt nhanh.
> TPC Task là nơi duy nhất tạo pha ON/OFF; FuzzyController chỉ tạo/arbiter demand đã clamp `[0.0, 1.0]`. Không dùng `analogWrite()`, `ledcWrite()` hoặc PWM tần số cao.

## 1. PHẠM VI & MỤC TIÊU
Xây dựng toàn bộ não bộ nội tại của hệ thống điều khiển mờ (Fuzzy Logic Controller). Phạm vi bao gồm: Các hàm thuộc tính toán học, Thuật toán nội suy lộ trình (Trajectory), Cơ chế Tự thích nghi (Adaptive AI Tuning), Phân rã luật mờ Kép (Dual-Heater & CO2), và Động cơ băm xung thời gian thực (TPC Engine). Toàn bộ khối này bị cô lập vật lý trên Core 1 của ESP32.

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU
[Core 0 Shared Variables] -> (Thread-safe Read) -> [Trajectory Interpolator] -> Xác định Target_Setpoints -> [Error Calculator: eT, eH, eCO2] -> [Adaptive AI Tuner] -> Cập nhật Gains -> [Fuzzy Math Engine (TH + CO2)] -> [Arbitrator (Max Function)] -> [Demand TPC 0.0..1.0] -> Hardware Protection Override -> [TPC Window + Minimum ON/OFF] -> [GPIO Registers (SSR Relays)]

> ⚠️ TPC tạo đóng/cắt SSR theo cửa sổ thời gian dài bằng `digitalWrite()`, không phải PWM tần số cao.

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

### TRACK NGHIỆP VỤ LÕI (CORE BUSINESS LOGIC)
- **Tạo file:** `MathEngine.h` / `MathEngine.cpp`
  - *Hàm `calculateFuzzyArea()`*: Triển khai các phương trình tích phân Fz1, Fz2, Fz3 và Fu1, Fu2, Fu3 để giải mờ thuật toán Pascal gốc.
  - *Hàm `computeMembership()`*: Tính toán đường bao hình thang (`trapmf`) và tam giác (`trimf`) trả về giá trị liên thuộc (0.0 đến 1.0).
- **Tạo file:** `Trajectory.h` / `Trajectory.cpp`
  - *Hàm `interpolateSetpoints()`*: Nhận đầu vào là `currentDay` (float), duyệt mảng Waypoints 20 ngày và nội suy tuyến tính trả về struct chứa T_target, H_target, CO2_target.
- **Tạo file:** `AdaptiveTuner.h` / `AdaptiveTuner.cpp`
  - *Hàm `updateGains()`*: Tính toán sai số bề mặt (Integral Error) của T và H. Điều chỉnh `gain_HAir`, `gain_HWat`, `gain_Mist` (chặn biên độ từ 0.5 đến 2.5). Trả về struct Gains mới nhất.

### TRACK ĐIỀU KHIỂN & CHẤP HÀNH (HARDWARE & CONTROL LOGIC)
- **Tạo file:** `FuzzyController.h` / `FuzzyController.cpp`
  - *Hàm `executeDualHeaterRules()`*: Nạp `errorTemp`, `errorHumid`. Phân nhánh logic "Lạnh & Khô" vs "Lạnh & Ẩm ướt". Trả về công suất thô cho HAir, HWat, Mist, ExhTH.
  - *Hàm `executeCO2Rules()`*: Nạp `errorCO2`. Trả về công suất xả khí ExhCO2.
  - *Hàm `arbitrateOutputs()`*: Trộn `ExhTH` và `ExhCO2` bằng `std::max`, nhân HAir/HWat/Mist với Gains từ `AdaptiveTuner`, và trả demand TPC liên tục `[0.0, 1.0]` (không threshold thành boolean).
- **Tạo file:** `TPC_Task.h` / `TPC_Task.cpp`
  - *Hàm `hardwareProtectionOverride()`*: Đọc thời gian RTC hiện tại. Ép duty `out_HWat = 0.0` và `out_Mist = 0.0` nếu nằm trong khoảng 11:00 AM - 13:30 PM; RTC lỗi cũng phải fail-safe về hai duty bằng 0.
  - *TPC scheduler*: Chuyển mỗi duty demand thành HIGH/LOW SSR trong cửa sổ TPC non-blocking (`millis()`), có thời gian ON/OFF tối thiểu configurable theo thiết bị.
  - *Hàm `Core1_ControlTask()`*: Task loop FreeRTOS: fuzzy → arbitration → protection → TPC → `digitalWrite()`, gọi `vTaskDelay(50)` để chống Watchdog; không dùng PWM/`analogWrite()`.

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG
1. **Hiệu năng:** Tốc độ thực thi một vòng lặp toàn bộ giải thuật toán mờ trong `Core1_ControlTask` không được vượt quá 10ms.
2. **Bảo mật sinh học (Luật cứng phần cứng):** Hàm `hardwareProtectionOverride()` bắt buộc được đặt ở dòng cuối cùng trước lệnh xuất GPIO, không thể bị qua mặt bởi bất kỳ kết quả suy luận AI nào.
3. **Quản lý bộ nhớ:** Cấm hoàn toàn việc cấp phát bộ nhớ động (`malloc`, `new`, `String`) bên trong vòng lặp vô tận của `Core1_ControlTask` để tránh phân mảnh Heap dẫn đến crash sau nhiều ngày hoạt động.