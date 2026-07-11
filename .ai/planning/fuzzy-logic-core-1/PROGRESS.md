# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-11T15:53:13+07:00
- **Agent thực thi**: Gemini
- **Agent rà soát / khởi tạo PROGRESS**: Claude (Senior Solution Architect)

## Reference Plan
- **Thư mục kế hoạch**: [.ai/planning/fuzzy-logic-core-1/](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/)
- **Sprints tham chiếu**:
  1. [sprint_1.md (Lõi thuật toán mờ, động học & điều khiển TPC - Core 1)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/sprint_1.md)
  2. [sprint_2.md (Hạ tầng IoT, Delta MQTT Base64 và Web Dashboard - Core 0)](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/sprint_2.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có

## Tracks Progress

---

### SPRINT 1: LÕI THUẬT TOÁN MỜ, ĐỘNG HỌC & ĐIỀU KHIỂN TPC (CORE 1)

#### Track A: Nghiệp vụ lõi (Sprint 1 - Core Business Logic)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| A1 | Tạo file `MathEngine.h` / `MathEngine.cpp` và triển khai hàm `calculateFuzzyArea()` để giải mờ thuật toán Pascal gốc (phương trình tích phân Fz1, Fz2, Fz3 và Fu1, Fu2, Fu3). | [ ] QA Review | - **Pure Functions**: Bắt buộc là hàm thuần túy toán học, không lưu trạng thái (stateless), không chứa biến static toàn cục và không gọi trực tiếp bất kỳ API phần cứng nào.<br>- **Kiểu dữ liệu**: Sử dụng kiểu `float` hoặc `double` có độ chính xác cao phù hợp với FPU của ESP32.<br>- **Chống nợ kỹ thuật**: Phải kiểm tra điều kiện chia cho 0 trước khi thực hiện phép chia tích phân, có fallback an toàn về giá trị mặc định để tránh lỗi nan/inf. |
| A2 | Triển khai hàm `computeMembership()` trong `MathEngine` để tính toán đường bao hình thang (`trapmf`) và tam giác (`trimf`) trả về giá trị liên thuộc (0.0 đến 1.0). | [ ] QA Review | - **Ràng buộc đầu ra**: Bắt buộc dùng hàm `constrain(val, 0.0f, 1.0f)` hoặc cơ chế kẹp tương đương để bảo đảm kết quả trả về luôn nằm trong tập mờ `[0.0, 1.0]`.<br>- **Tối ưu hiệu năng**: Tránh tính toán trùng lặp, tối ưu các phép so sánh biên của hàm hình thang và tam giác để giảm tải CPU.<br>- **Unit Test**: Bắt buộc viết các test case kiểm thử biên tại các điểm đứt gãy của hàm hình thang/tam giác. |
| A3 | Tạo file `Trajectory.h` / `Trajectory.cpp` và triển khai hàm `interpolateSetpoints()` nhận đầu vào là `currentDay` (float), nội suy tuyến tính từ mảng Waypoints 20 ngày. | [ ] QA Review | - **Tối ưu hóa bộ nhớ (Flash/RAM)**: Mảng Waypoints 20 ngày phải được lưu trữ trong bộ nhớ Flash (`static constexpr` hoặc `const PROGMEM`), tuyệt đối không được tải toàn bộ vào Heap RAM khi thực thi.<br>- **Bảo vệ biên**: Kiểm tra biên đầu vào chặt chẽ. Nếu `currentDay < 0.0` thì lấy ngày 0.0; nếu `currentDay > 20.0` thì lấy ngày 20.0 (không nội suy ngoại lai).<br>- **Interface**: Trả về struct setpoint dạng POD (Plain Old Data) được pass-by-value hoặc const reference, không dùng con trỏ thô để tránh rò rỉ bộ nhớ. |
| A4 | Tạo file `AdaptiveTuner.h` / `AdaptiveTuner.cpp` và triển khai hàm `updateGains()` tính toán sai số bề mặt (Integral Error) của T và H, điều chỉnh `gain_HAir`, `gain_HWat`, `gain_Mist` (chặn biên từ 0.5 đến 2.5). | [ ] Pending | - **Chống trôi tích phân (Anti-windup)**: Thiết kế giải thuật tích lũy sai số bề mặt phải có giới hạn tích phân tối đa để tránh hiện tượng windup khi bộ chấp hành bị bão hòa hoặc cảm biến mất tín hiệu.<br>- **Ràng buộc Gain**: Ép cứng giới hạn của Gains bằng cách clamp giá trị trả về trong khoảng `[0.5, 2.5]` để đảm bảo hệ thống không bao giờ tự điều chỉnh hệ số vượt ngưỡng an toàn phần cứng. |

#### Track B: Điều khiển & Chấp hành (Sprint 1 - Hardware & Control Logic)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| B1 | Tạo file `FuzzyController.h` / `FuzzyController.cpp` và triển khai hàm `executeDualHeaterRules()` nạp `errorTemp`, `errorHumid`, trả về công suất thô cho HAir, HWat, Mist, ExhTH. | [ ] Pending | - **Fuzzy Rules Invariants**: Phân nhánh logic "Lạnh & Khô" vs "Lạnh & Ẩm ướt" phải được kiểm thử độc lập. Đảm bảo luật mờ không gây ra tình trạng bật đồng thời hai thiết bị triệt tiêu nhau (vd: sấy nhiệt và phun sương đồng thời quá mức) trừ khi được cấu hình đặc biệt.<br>- **Ràng buộc Output**: Giá trị trả về cho mỗi kênh điều khiển phải là trị số thô trong khoảng `[0.0, 1.0]`. |
| B2 | Triển khai hàm `executeCO2Rules()` trong `FuzzyController` nạp `errorCO2` và trả về công suất xả khí ExhCO2. | [ ] Pending | - **Hysteresis Control**: Áp dụng cơ chế trễ (Hysteresis) hoặc khoảng chết (Deadband) xung quanh setpoint CO2 để ngăn chặn hiện tượng quạt xả đóng ngắt liên tục (Chống mòn thiết bị vật lý). |
| B3 | Triển khai hàm `arbitrateOutputs()` trong `FuzzyController` trộn `ExhTH` và `ExhCO2` bằng hàm `std::max`, nhân với tập hệ số Gains từ `AdaptiveTuner`. | [ ] Pending | - **Decoupled Arbitrator Pattern**: Trộn đầu ra xả gió giữa bài toán nhiệt-ẩm và bài toán CO2 bằng hàm toán học phi tuyến `std::max`. Đảm bảo hệ thống ưu tiên xả khi CO2 tích tụ cao.<br>- **Post-arbitration Clamp**: Kết quả sau khi nhân với Gains bắt buộc phải được clamp về `[0.0, 1.0]` một lần nữa trước khi gửi đến TPC. |
| B4 | Tạo file `TPC_Task.h` / `TPC_Task.cpp` và triển khai hàm `hardwareProtectionOverride()` ép `out_HWat = 0` và `out_Mist = 0` nếu nằm trong khoảng 11:00 AM - 13:30 PM. | [ ] Pending | - **Biosafety / Hardware Hard-rule**: Hàm này là tuyến phòng thủ tối cao, chạy ở cuối chu trình điều khiển, không được phép bị bỏ qua bởi bất kỳ logic mờ hay thuật toán thích nghi nào.<br>- **Lỗi RTC Fallback**: Nếu không thể đọc được thời gian thực từ RTC (hoặc RTC trả về dữ liệu lỗi), bắt buộc phải fallback về trạng thái an toàn: ngắt hoàn toàn bộ sấy nước (`out_HWat = 0`) và phun sương (`out_Mist = 0`). |
| B5 | Triển khai hàm `Core1_ControlTask()` — Task loop vô tận cho FreeRTOS ghim vào Core 1, quản lý cửa sổ TPC 60,000ms, điều khiển GPIO bằng `digitalWrite()`, gọi `vTaskDelay(50)`. | [ ] Pending | - **Chống treo Watchdog (TWDT)**: Bắt buộc gọi `vTaskDelay(pdMS_TO_TICKS(50))` ở mỗi chu kỳ để nhường CPU cho IDLE task chạy trên Core 1. Cấm dùng `delay()` làm đóng băng core.<br>- **Bộ nhớ Heap**: Tuyệt đối không sử dụng cấp phát động (`malloc`, `new`, `String`) bên trong vòng lặp vô tận này để phòng ngừa rò rỉ RAM gây sập hệ thống sau nhiều ngày hoạt động.<br>- **Thứ tự thực thi**: Hàm `hardwareProtectionOverride()` bắt buộc phải được gọi ở dòng cuối cùng ngay trước khi xuất tín hiệu điều khiển ra các GPIO Registers (SSR Relays). |

---

### SPRINT 2: HẠ TẦNG IOT, DELTA MQTT BASE64 VÀ WEB DASHBOARD (CORE 0)

#### Track C: Giao thức dữ liệu (Sprint 2 - Data Protocol)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| C1 | Tạo file `CryptoUtils.h` / `CryptoUtils.cpp` và triển khai hàm `encodeBase64String()` dùng API `mbedtls_base64_encode`. | [ ] Pending | - **Thư viện chuẩn**: Bắt buộc sử dụng API native `mbedtls/base64.h` được tích hợp sẵn trong ESP-IDF để tối ưu hóa tốc độ mã hóa phần cứng.<br>- **Quản lý Buffer**: Các mảng đệm (buffers) phục vụ cho quá trình mã hóa phải được cấp phát tĩnh hoặc cấp phát cục bộ trên Stack và giải phóng ngay khi ra khỏi hàm. Tránh rò rỉ Heap. |
| C2 | Tạo file `Telemetry.h` / `Telemetry.cpp` và triển khai hàm `evaluateDeltaThresholds()` so sánh dữ liệu hiện tại với `lastPubState`. | [ ] Pending | - **Delta Thresholding Pattern**: Thiết lập sai số delta tối thiểu (vd: lệch Temp > 0.2°C, Humid > 1.0%, CO2 > 10ppm) mới kích hoạt truyền thông.<br>- **Heartbeat Keepalive**: Phải thiết kế cờ `forceFullPublish` kích hoạt gửi dữ liệu đầy đủ định kỳ (vd: mỗi 5 phút) ngay cả khi không có biến động, giúp backend phát hiện tình trạng mất kết nối (LWT). |
| C3 | Triển khai hàm `buildDeltaPayload()` trong `Telemetry` để tạo `StaticJsonDocument` chỉ chèn các short-keys thay đổi. | [ ] Pending | - **Heap Protection**: Nghiêm cấm sử dụng `DynamicJsonDocument` hoặc kiểu dữ liệu `String` động liên tục. Bắt buộc dùng `StaticJsonDocument` với kích thước cố định (vd: 512 bytes) để cấp phát trên Stack.<br>- **Băng thông IoT**: Sử dụng các phím viết tắt (short-keys như `rT` cho real temp, `rH` cho real humid, `tC` cho target CO2...) để thu gọn tối đa payload mạng. |

#### Track D: Mạng & API điều khiển (Sprint 2 - Network & Web API)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| D1 | Tạo file `NetworkTask.h` / `NetworkTask.cpp` và triển khai hàm `initWiFiModes()` thiết lập AP_STA, kết nối router không chặn. | [ ] Pending | - **Non-blocking Connection**: Tiến trình đàm phán kết nối WiFi phải thiết kế dạng máy trạng thái không chặn (Non-blocking State Machine). Tuyệt đối cấm vòng lặp `while(!connected) { delay(); }` vì sẽ làm đóng băng Core 0 và gây treo dịch vụ Webserver nội bộ. |
| D2 | Triển khai hàm `handleMQTTCallback()` nhận tin nhắn MQTT, đổi trạng thái cờ `shared_forceFullPublish = true` khi nhận lệnh `full_sync`. | [ ] Pending | - **Data Sanitization**: Mọi dữ liệu nhận từ MQTT Broker phải được kiểm tra tính toàn vẹn và hợp lệ trước khi parse.<br>- **Thread-Safety**: Biến cờ chia sẻ đa nhân `shared_forceFullPublish` bắt buộc phải được khai báo là `volatile bool` và truy xuất thông qua Mutex/Flag an toàn để tránh Data Race giữa Core 0 và Core 1. |
| D3 | Triển khai hàm `maintainMQTTConnection()` quản lý tự động kết nối lại MQTT và đăng ký subscribe topic lệnh. | [ ] Pending | - **Exponential Backoff**: Áp dụng thuật toán lùi thời gian thử lại (ví dụ: 2s, 4s, 8s... tối đa 60s) khi mất kết nối MQTT để không gây quá tải broker.<br>- **Mạch bảo vệ**: Không thực hiện kết nối lại MQTT nếu kết nối WiFi (`WiFi.status() != WL_CONNECTED`) chưa sẵn sàng. |
| D4 | Tạo file `WebInterface.h` / `WebInterface.cpp` và triển khai hàm `serveDashboardHTML()` phục vụ HTTP GET `/` với HTML web cục bộ. | [ ] Pending | - **Bộ nhớ Flash**: Chuỗi HTML của giao diện dashboard cục bộ phải được lưu trữ trong bộ nhớ Flash (`const char* PROGMEM` hoặc `const char[] PROGMEM`) thay vì RAM để bảo vệ vùng nhớ Heap.<br>- **Tối ưu hóa UI**: HTML/CSS/JS phải được nén gọn nhẹ (Inline), tránh tham chiếu các thư viện CDN bên ngoài vì thiết bị có thể hoạt động trong mạng LAN không có Internet. |
| D5 | Triển khai hàm `apiGetRealtimeData()` phục vụ HTTP GET `/data` trả về JSON full dữ liệu trạng thái. | [ ] Pending | - **Rate-limiting**: Thiết kế cơ chế giới hạn thời gian tối thiểu giữa các lần gửi request (vd: tối đa 1 request mỗi 1 giây) để ngăn chặn các client gọi API liên tục làm kiệt quệ tài nguyên xử lý của ESP32. |

#### Track E: Hệ thống chính (Sprint 2 - System Main)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| E1 | Sửa file `main.cpp` — triển khai hàm `setup()` khởi tạo I2C, kích hoạt WiFi, tạo task chạy trên Core 1. | [ ] Pending | - **Quy trình khởi tạo Fail-Safe**: Bắt buộc khởi tạo GPIO cho các Relay ở mức an toàn (`LOW` hoặc `OFF`) đầu tiên, sau đó mới đến các thiết bị ngoại vi I2C/Mạng. Việc này đảm bảo thiết bị không tự kích hoạt relay khi ESP32 reboot.<br>- **FreeRTOS Task Allocation**: Phân bổ stack size hợp lý cho từng Task (Core 1 Task: 4096 bytes; Core 0 Task: 8192 bytes do gánh tác vụ mạng/JSON). |
| E2 | Cập nhật hàm `loop()` trong `main.cpp` — duy trì HTTP client Webserver, duy trì kết nối MQTT và chu kỳ quét delta mỗi 5000ms. | [ ] Pending | - **Non-blocking Loop**: Hàm `loop()` trên Core 0 chỉ đóng vai trò bộ điều phối không chặn. Mọi chu kỳ quét định kỳ (ví dụ: 5000ms để kiểm tra delta) phải sử dụng bộ định thời dựa trên so sánh `millis()`, tuyệt đối cấm dùng `delay()`. |
