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
- **Yêu cầu phát sinh (2026-07-11)**: Áp dụng **TPC (Time-Proportional Control)** cho SSR: chuyển demand mờ chuẩn hóa `[0.0, 1.0]` thành tỷ lệ thời gian ON/OFF trong cửa sổ TPC để điều khiển máy siêu âm, sấy khí và quạt hút.
- **Chốt kiến trúc Phase 1 (2026-07-11)**: Giữ TPC (không Macro Interval / PWM). Tune window/min ON-OFF, staggered startup, fuzzy sample 5 s, và bắt buộc NTP cho blackout 11:00–13:30.

## ⚠️ Lưu ý Phần cứng Quan trọng — SSR + TPC
> **Hệ thống dùng SSR và áp dụng TPC, không dùng PWM tần số cao.**
> - Tất cả output fuzzy (`HAir`, `HWat`, `Mist`, `ExhTH`, `ExhCO2`) là **demand chuẩn hóa** `[0.0, 1.0]`, trong đó `0.0` = luôn OFF và `1.0` = luôn ON trong cửa sổ TPC.
> - `TPC_Task` chuyển demand thành khoảng ON/OFF bằng `digitalWrite(pin, HIGH/LOW)` và timer non-blocking; tuyệt đối không dùng `analogWrite()`, `ledcWrite()` hoặc PWM tần số cao.
> - Mỗi thiết bị SSR phải có cửa sổ TPC và thời gian ON/OFF tối thiểu cấu hình được; không được đóng cắt nhanh hoặc đảo trạng thái liên tục theo từng tick 50 ms.
> - `arbitrateOutputs()` (B3) trả demand liên tục đã clamp `[0.0, 1.0]`; `hardwareProtectionOverride()` (B4) ép duty của HWat/Mist về `0.0` trước khi TPC quyết định mức GPIO.
> - `Core1_ControlTask()` (B5) phải gọi `hardwareProtectionOverride()` ở bước cuối trước TPC/GPIO và chỉ xuất mức HIGH/LOW do TPC quyết định.


## Architecture Decisions — Phase 1 (2026-07-11T18:00+07:00)
> **Decision**: Giữ kiến trúc TPC, không rewrite sang PWM hoặc Macro Interval; SSR dùng loại AC Zero-crossing.
> - **Tune TPC**: Window nâng lên 300 s (HAir/HWat/Mist), Exhaust 120 s. Min ON/OFF nâng lên 3–10 s theo tải.
> - **Staggered Startup**: Các SSR tải nặng (HAir, HWat, Mist) được khởi động lệch pha trong cửa sổ TPC (+0s, +3s, +8s) để tránh sụt áp lưới cục bộ do inrush cộng dồn.
> - **NTP Blackout**: Tích hợp `configTime` trên Core 0 khi có WiFi; Core 1 chỉ thi hành blackout 11:00–13:30 nếu NTP đánh dấu valid, nếu không sẽ fail-safe ép OFF (Dead code hiện tại phải được xử lý).
> - **Tick Scheduler**: TPC vẫn chạy 50 ms tick, nhưng chu kỳ nội suy và thích nghi (`dtSeconds`) chạy ở 5 s để giảm tải, tránh cập nhật gain và fuzzy vô ích khi cảm biến chưa phản ứng.

## Tracks Progress

---

### SPRINT 1: LÕI THUẬT TOÁN MỜ, ĐỘNG HỌC & ĐIỀU KHIỂN TPC (CORE 1)

#### Track A: Nghiệp vụ lõi (Sprint 1 - Core Business Logic)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| A1 | Tạo file `MathEngine.h` / `MathEngine.cpp` và triển khai hàm `calculateFuzzyArea()` để giải mờ thuật toán Pascal gốc (phương trình tích phân Fz1, Fz2, Fz3 và Fu1, Fu2, Fu3). | [x] Done | - **Pure Functions**: Bắt buộc là hàm thuần túy toán học, không lưu trạng thái (stateless), không chứa biến static toàn cục và không gọi trực tiếp bất kỳ API phần cứng nào.<br>- **Kiểu dữ liệu**: Sử dụng kiểu `float` hoặc `double` có độ chính xác cao phù hợp với FPU của ESP32.<br>- **Chống nợ kỹ thuật**: Phải kiểm tra điều kiện chia cho 0 trước khi thực hiện phép chia tích phân, có fallback an toàn về giá trị mặc định để tránh lỗi nan/inf. |
| A2 | Triển khai hàm `computeMembership()` trong `MathEngine` để tính toán đường bao hình thang (`trapmf`) và tam giác (`trimf`) trả về giá trị liên thuộc (0.0 đến 1.0). | [x] Done | - **Ràng buộc đầu ra**: Bắt buộc dùng hàm `constrain(val, 0.0f, 1.0f)` hoặc cơ chế kẹp tương đương để bảo đảm kết quả trả về luôn nằm trong tập mờ `[0.0, 1.0]`.<br>- **Tối ưu hiệu năng**: Tránh tính toán trùng lặp, tối ưu các phép so sánh biên của hàm hình thang và tam giác để giảm tải CPU.<br>- **Unit Test**: Bắt buộc viết các test case kiểm thử biên tại các điểm đứt gãy của hàm hình thang/tam giác. |
| A3 | Tạo file `Trajectory.h` / `Trajectory.cpp` và triển khai hàm `interpolateSetpoints()` nhận đầu vào là `currentDay` (float), nội suy tuyến tính từ mảng Waypoints 20 ngày. | [x] Done | - **Tối ưu hóa bộ nhớ (Flash/RAM)**: Mảng Waypoints 20 ngày phải được lưu trữ trong bộ nhớ Flash (`static constexpr` hoặc `const PROGMEM`), tuyệt đối không được tải toàn bộ vào Heap RAM khi thực thi.<br>- **Bảo vệ biên**: Kiểm tra biên đầu vào chặt chẽ. Nếu `currentDay < 0.0` thì lấy ngày 0.0; nếu `currentDay > 20.0` thì lấy ngày 20.0 (không nội suy ngoại lai).<br>- **Interface**: Trả về struct setpoint dạng POD (Plain Old Data) được pass-by-value hoặc const reference, không dùng con trỏ thô để tránh rò rỉ bộ nhớ. |
| A4 | Tạo file `AdaptiveTuner.h` / `AdaptiveTuner.cpp` và triển khai hàm `updateGains()` tính toán sai số bề mặt (Integral Error) của T và H, điều chỉnh `gain_HAir`, `gain_HWat`, `gain_Mist` (chặn biên từ 0.5 đến 2.5). | [x] Done | - **Chống trôi tích phân (Anti-windup)**: Thiết kế giải thuật tích lũy sai số bề mặt phải có giới hạn tích phân tối đa để tránh hiện tượng windup khi bộ chấp hành bị bão hòa hoặc cảm biến mất tín hiệu.<br>- **Ràng buộc Gain**: Ép cứng giới hạn của Gains bằng cách clamp giá trị trả về trong khoảng `[0.5, 2.5]` để đảm bảo hệ thống không bao giờ tự điều chỉnh hệ số vượt ngưỡng an toàn phần cứng. |

#### Track B: Điều khiển & Chấp hành (Sprint 1 - Hardware & Control Logic)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| B1 | Rà soát/điều chỉnh `executeDualHeaterRules()` trong `FuzzyController` để trả demand TPC thô cho HAir, HWat, Mist, ExhTH từ `errorTemp`, `errorHumid`. | [ ] QA Review | - **Fuzzy Rules Invariants**: Phân nhánh "Lạnh & Khô" vs "Lạnh & Ẩm ướt" phải được kiểm thử độc lập; không tạo demand cao đồng thời cho thiết bị triệt tiêu nhau trừ cấu hình đặc biệt.<br>- **TPC Semantics**: Mỗi output là duty demand `[0.0, 1.0]` cho TPC, **chưa** được threshold/map thành relay boolean trong FuzzyController. |
| B2 | Rà soát/điều chỉnh `executeCO2Rules()` trong `FuzzyController` để tạo demand xả `ExhCO2` tương thích TPC từ `errorCO2`. | [ ] QA Review | - **Hysteresis Control**: Áp dụng hysteresis/deadband quanh setpoint để chống chattering; state latch phải tường minh/caller-owned.<br>- **TPC Semantics**: Latch có thể yêu cầu duty `1.0`, nhưng không được gọi GPIO hay tự tạo xung; TPC Task là nơi duy nhất quyết định pha ON/OFF SSR. |
| B3 | Rà soát/điều chỉnh `arbitrateOutputs()` trong `FuzzyController`: trộn `ExhTH`/`ExhCO2` bằng `std::max`, nhân HAir/HWat/Mist với Gains từ `AdaptiveTuner`, trả duty demand TPC. | [ ] QA Review | - **Decoupled Arbitrator Pattern**: Dùng `std::max` cho demand exhaust để CO2 cao được ưu tiên độc lập.<br>- **Post-arbitration Clamp**: Kết quả sau gain/arbitration phải clamp `[0.0, 1.0]`; **cấm** threshold/map sang `0.0/1.0` relay tại B3. |
| B4 | Tạo file `TPC_Task.h` / `TPC_Task.cpp`; triển khai `hardwareProtectionOverride()` và lõi chuyển duty TPC sang trạng thái SSR. | [ ] QA Review | - **Biosafety / Hardware Hard-rule**: Trước pha TPC/GPIO, ép duty `out_HWat = 0.0` và `out_Mist = 0.0` trong 11:00–13:30; không logic mờ/tuning nào được bypass.<br>- **RTC Fail-safe**: RTC/NTP không hợp lệ hoặc dữ liệu lỗi phải ép duty HWat/Mist về `0.0`.<br>- **TPC Scheduler**: Dùng `millis()` non-blocking; cấu hình Phase 1: HAir/HWat `300/10/10 s`, Mist `300/5/10 s`, Exhaust `120/3/3 s`; hỗ trợ startup offset `0/3/8/0 s`; output luôn `digitalWrite(HIGH/LOW)`, không PWM. |
| B5 | Triển khai `Core1_ControlTask()` — FreeRTOS loop ghim Core 1, chạy fuzzy → arbitration → protection → TPC → GPIO SSR và gọi `vTaskDelay(50)`. | [ ] QA Review | - **Chống treo Watchdog (TWDT)**: Gọi `vTaskDelay(pdMS_TO_TICKS(50))` mỗi chu kỳ; cấm `delay()`.<br>- **Bộ nhớ Heap**: Cấm `malloc`, `new`, `String` trong loop vô tận.<br>- **Thứ tự bắt buộc**: `hardwareProtectionOverride()` phải chạy sau fuzzy/arbitration và ngay trước khi TPC quyết định HIGH/LOW xuất GPIO.<br>- **TPC/SSR**: Không PWM/analogWrite; chỉ `digitalWrite`. TPC tick 50 ms; fuzzy/gain/arbitration sample 5 s với `dtSeconds` đo thực tế; staggered startup theo config Phase 1. |

---

### SPRINT 2: HẠ TẦNG IOT, DELTA MQTT BASE64 VÀ WEB DASHBOARD (CORE 0)

#### Track C: Giao thức dữ liệu (Sprint 2 - Data Protocol)
| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
C1 | Tạo file `CryptoUtils.h` / `CryptoUtils.cpp` và triển khai hàm `encodeBase64String()` dùng API `mbedtls_base64_encode`. | [ ] QA Review | - **Thư viện chuẩn**: Bắt buộc sử dụng API native `mbedtls/base64.h` được tích hợp sẵn trong ESP-IDF để tối ưu hóa tốc độ mã hóa phần cứng.<br>- **Quản lý Buffer**: Các mảng đệm (buffers) phục vụ cho quá trình mã hóa phải được cấp phát tĩnh hoặc cấp phát cục bộ trên Stack và giải phóng ngay khi ra khỏi hàm. Tránh rò rỉ Heap. |
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
| E1 | Sửa file `main.cpp` — triển khai hàm `setup()` khởi tạo I2C, kích hoạt WiFi, tạo task chạy trên Core 1. | [ ] Pending | - **Quy trình khởi tạo Fail-Safe**: Bắt buộc khởi tạo GPIO cho các Relay ở mức an toàn (`LOW` hoặc `OFF`) đầu tiên, sau đó mới đến các thiết bị ngoại vi I2C/Mạng. Việc này đảm bảo thiết bị không tự kích hoạt relay khi ESP32 reboot.<br>- **FreeRTOS Task Allocation**: Phân bổ stack size hợp lý cho từng Task (Core 1 Task: 4096 bytes; Core 0 Task: 8192 bytes do gánh tác vụ mạng/JSON).<br>- **NTP Provider**: Sau khi WiFi Station kết nối, gọi `configTime(7*3600, 0, ...)` và chỉ công bố giờ hợp lệ cho Core 1 khi NTP đã sync; chưa sync => `RtcTimePod.valid=false`. |
| E2 | Cập nhật hàm `loop()` trong `main.cpp` — duy trì HTTP client Webserver, duy trì kết nối MQTT và chu kỳ quét delta mỗi 5000ms. | [ ] Pending | - **Non-blocking Loop**: Hàm `loop()` trên Core 0 chỉ đóng vai trò bộ điều phối không chặn. Mọi chu kỳ quét định kỳ (ví dụ: 5000ms để kiểm tra delta) phải sử dụng bộ định thời dựa trên so sánh `millis()`, tuyệt đối cấm dùng `delay()`. |


---

### SPRINT 3: OFFLINE SETPOINT PERSISTENCE & ROTARY ENCODER OVERRIDE

#### Track F: Persistency & Queue IPC (Sprint 3 - NVS + Core 1)

| Task ID | Mô tả Task | Status | Note (Technical Directives) |
| :--- | :--- | :--- | :--- |
| F1 | Thêm snapshot POD typed, key NVS `last_sp`/`hw_ovr`, và API save/load/clear trong `StorageManager`. | [ ] Pending | - Core 0 persist; Core 1 tuyệt đối không đọc/ghi Flash runtime.<br>- Backend T:[10,45], H:[30,95], CO2:[400,10000]; manual T:[20,40], H:[50,95].<br>- Mỗi float chỉ ghi khi `fabs(new-old) >= 0.1f`; field boolean/source đổi thì ghi ngay.<br>- NVS corrupt/empty → trajectory Day 0. |
| F2 | Thêm `ControlSetpointCommand` và hai FreeRTOS Queue depth 1: baseline backend + hardware override. | [ ] Pending | - Sender dùng `xQueueOverwrite`, Core 1 non-blocking drain ở đầu tick 50 ms.<br>- Không EventBit, không JSON/String/NVS handle truyền qua IPC.<br>- Core 1 giữ baseline và overlay tách riêng để MQTT không đè manual override. |
| F3 | Cập nhật MQTT callback: validate → persist baseline → queue typed baseline; hỗ trợ `clearHardwareOverride:true`. | [ ] Pending | - MQTT clear xóa key `hw_ovr` rồi queue command clear; payload backend còn lại vẫn cập nhật baseline.<br>- Chỉ ACL/auth MQTT hiện có mới phát được lệnh.<br>- Không lưu raw JSON, không gọi `local_control`. |
| F4 | Hydrate NVS trong `setup()` trước khi start task và đẩy snapshot vào queue. | [ ] Pending | - Startup queue creation + NVS hydration phải xong trước Core 0/Core 1.<br>- Core 1 nhận POD duy nhất qua queue, fallback trajectory khi không có baseline. |
| F5 | Cập nhật `task_core1_control()` với priority `manual override > backend baseline > trajectory Day 0`. | [ ] Pending | - Validate lại command trước mutate state; command lỗi reject/log.<br>- Clear chỉ bỏ overlay và quay về baseline mới nhất.<br>- Interlock sensor/blackout/TPC vẫn ưu tiên trên setpoint. |
| F6 | Tạo `encoder.h/.cpp` + Core 0 encoder input task cho KY-040 GPIO5/6/7. | [ ] Pending | - KY-040 bắt buộc cấp 3.3V, `INPUT_PULLUP`.<br>- CLK ISR + DT quadrature, reject edge <2ms; SW stable 30ms, double click 300ms, long-press ≥3s.<br>- Monitor double-click → Edit Temp; Edit click đổi Temp/Humi; Edit long-press save; Monitor long-press khi override active → clear.<br>- Step T 0.5°C/RH 1%, clamp T:[20,40] H:[50,95]. |
| F7 | Xóa hoàn toàn `local_control` legacy module và mọi reference/test/comment liên quan. | [ ] Pending | - Không compatibility shim.<br>- Core 1 TPC/fuzzy là control path duy nhất. |
| F8 | Unit/integration tests cho NVS epsilon, Queue priority, encoder gestures và regression TPC. | [ ] Pending | - Test 30.00000→30.00001/30.09 không ghi, →30.10 ghi.<br>- Manual thắng MQTT baseline; local/MQTT clear trả về latest baseline.<br>- Verify Core 1 runtime không NVS access; SSR safety vẫn giữ khi override active. |

## Addition Plan — Sprint 3 (2026-07-12)

- **Yêu cầu phát sinh**: Khi rớt mạng, ESP32 sử dụng setpoint cuối backend thay vì hardcode; người vận hành có thể override cả nhiệt độ/độ ẩm bằng rotary encoder.
- **Quyết định kiến trúc**:
  - NVS snapshot ở Core 0/startup; Queue POD là IPC runtime duy nhất tới Core 1.
  - Priority: Hardware Override > Backend/NVS > Trajectory Day 0.
  - Rotary KY-040: 3.3V, CLK=GPIO5, DT=GPIO6, SW=GPIO7; display tách Sprint khác.
  - Manual override giữ đến local long-press hoặc MQTT `clearHardwareOverride:true` clear.
  - NVS epsilon `0.1f`; xóa `local_control` dead code.
