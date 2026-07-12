# Sprint 3: Offline Setpoint Persistence & Rotary Encoder Override

## Summary

Khi mất WiFi/MQTT, Core 1 hiện dùng trajectory Day 0 cố định thay vì nhiệt độ/độ ẩm backend gửi cuối cùng. Sprint này lưu snapshot backend hợp lệ vào NVS và phân phối setpoint runtime từ Core 0 sang Core 1 bằng FreeRTOS Queue. Core 1 tuyệt đối không đọc/ghi Flash khi đang chạy vòng TPC/fuzzy.

Thêm rotary encoder KY-040 để người vận hành đặt override cả nhiệt độ và độ ẩm. Thứ tự nguồn setpoint là bất biến: **Hardware Override > Backend snapshot/NVS > Trajectory Day 0**. Display được tách khỏi Sprint này.

## Architecture Changes

- Thay event-bit/NVS reload bằng IPC có kiểu dữ liệu:
  - Thêm POD `ControlSetpointCommand` với `temperature`, `humidity`, `co2`, `source` (`BackendBaseline`, `HardwareOverride`, `ClearHardwareOverride`) và `valid`.
  - Tạo hai queue độ sâu 1, theo semantics *latest state wins*: `xBackendSetpointQueue` và `xHardwareOverrideQueue`. Sender dùng `xQueueOverwrite`; Core 1 drain cả hai queue không-blocking ở đầu tick 50 ms.
  - Core 0 MQTT: parse/validate → persist backend snapshot nếu cần → `xQueueOverwrite(xBackendSetpointQueue, ...)`. Không gửi JSON, `String`, hoặc handle NVS sang Core 1.
  - Startup: `setup()` đọc hai snapshot NVS trước khi khởi tạo task, đưa baseline và manual override (nếu có) vào queue. Vì vậy Core 1 không truy cập Flash, kể cả runtime; nó chỉ nhận POD từ queue.
  - Core 1 giữ hai state độc lập: `backendBaseline` và `hardwareOverride`. MQTT mới luôn cập nhật baseline nhưng không được đè manual override đang active. Lệnh clear chỉ bỏ overlay và Core 1 quay về baseline mới nhất, hoặc trajectory Day 0 khi baseline không tồn tại.

- NVS persistence:
  - Key `last_sp` lưu snapshot backend cuối cùng; thêm key `hw_ovr` lưu manual override active qua reboot/mất điện. Cả key tối đa 15 ký tự.
  - `StorageManager` expose API typed cho `BackendSetpointSnapshot` và `HardwareOverrideSnapshot`; không persist JSON raw trong hot path.
  - Trước ghi NVS, đọc snapshot cũ và so sánh từng trường float bằng `fabs(newValue - oldValue) >= 0.1f`. Các trường boolean/source thay đổi vẫn được ghi. Không dùng so sánh float `!=`.
  - Backend snapshot chỉ cần nhiệt độ/độ ẩm hợp lệ; CO2 dùng giá trị trước đó hoặc default 1000 ppm nếu payload không mang CO2. Validation: backend T `10–45°C`, RH `30–95%`, CO2 `400–10,000 ppm`; manual T `20–40°C`, RH `50–95%`.

- Dọn dead code:
  - Xóa `include/local_control.h` và `src/local_control.cpp`.
  - Bỏ include/call `local_control` trong MQTT client và cập nhật/loại unit tests legacy liên quan.
  - Sửa comment ở sensor và các tài liệu để chỉ Core 1 TPC/fuzzy là control path duy nhất. Không giữ compatibility shim.

## Rotary Encoder Override

- Phần cứng đã chốt: KY-040 cấp **3.3 V**, `CLK=GPIO5`, `DT=GPIO6`, `SW=GPIO7`, tất cả `INPUT_PULLUP`. Các chân không xung đột GPIO0 (BOOT), I2C GPIO8/9 hoặc relay GPIO10–13. Không được cấp 5 V vào ba chân logic.
- Tạo `encoder.h/.cpp`, chạy input task riêng trên **Core 0**, priority thấp hơn task network; task không được gọi I2C/SPI/display và không chặn MQTT. Display là sprint khác.
  - ISR trên cạnh CLK thực hiện quadrature decode bằng DT, cộng/trừ encoder delta trong biến `volatile` bảo vệ `portMUX`; reject edge dưới 2 ms để lọc bounce quay.
  - Encoder task đọc/clear delta và scan SW mỗi 10 ms. SW yêu cầu stable 30 ms trước khi đổi trạng thái. Click được xác nhận khi đã nhả nút; double-click cần hai click trong cửa sổ 300 ms; long-press là ≥3 s và chỉ fire một lần mỗi lần giữ.
  - `UiMode`: `MONITOR_MODE`, `EDIT_TEMP_MODE`, `EDIT_HUMI_MODE`. Buffer edit khởi tạo từ **effective target** hiện tại (override nếu active, ngược lại baseline/trajectory), nhưng không có tác động control/NVS trong khi xoay.
  - Gesture:
    - Monitor double-click → `EDIT_TEMP_MODE`.
    - Trong Edit, single-click → chuyển Temp ↔ Humi.
    - Trong Edit, long-press ≥3 s → clamp buffer, persist `hw_ovr`, `xQueueOverwrite(xHardwareOverrideQueue, active command)`, trở về Monitor.
    - Trong Monitor khi manual override active, long-press ≥3 s → xóa `hw_ovr`, queue `ClearHardwareOverride`, trở về baseline. Khi không active, long-press không làm gì.
  - Mỗi detent: Temp ±`0.5°C`, RH ±`1%`; clamp cứng Temp `20–40°C`, RH `50–95%`.

- MQTT clear:
  - Payload trên topic setpoint hiện có được mở rộng bằng `{"clearHardwareOverride": true}`.
  - Chỉ xử lý sau MQTT authentication/ACL hiện có. Khi nhận flag true, Core 0 xóa key `hw_ovr` và overwrite `xHardwareOverrideQueue` bằng `ClearHardwareOverride`; các trường backend cùng payload vẫn cập nhật baseline theo validation.

## Core 1 Control Behavior

- Ở đầu mỗi tick 50 ms, drain `xBackendSetpointQueue` trước, rồi `xHardwareOverrideQueue`; validate finite/bounds một lần nữa trước khi mutate state. Command lỗi bị reject/log, không đổi target hiện tại.
- Xác định effective setpoint ngay trước fuzzy error: manual active → manual values; else valid baseline → baseline values; else `Trajectory::interpolateSetpoints(0.0f)`.
- Fuzzy/adaptive/TPC pipeline vẫn giữ nguyên: `effective setpoint → fuzzy → arbitration → hardwareProtectionOverride → TPC → GPIO`.
- Override không bypass hard safety: sensor invalid, RTC/NTP blackout, duty clamp và TPC min ON/OFF vẫn có ưu tiên cao hơn.

## Test Plan

- NVS: save/load backend snapshot; NVS trống/corrupt/out-of-bound → trajectory Day 0; manual snapshot restore sau reboot; backend snapshot không xóa manual snapshot.
- Wear: `30.00000 → 30.00001` và `30.00 → 30.09` không ghi; `30.00 → 30.10` ghi; thay đổi RH/CO2/flag cũng được đánh giá riêng theo epsilon hoặc exact semantic field.
- IPC: MQTT command được typed/queued; Core 1 nhận backend update; manual active thắng backend update; clear command trả về baseline đã nhận mới nhất; queue overwrite chỉ giữ command cuối.
- Encoder: quadrature theo hai chiều; edge bounce bị bỏ; SW debounce; single/double/long press đúng timeout; edit buffer không đổi effective target trước save; clamp step/bounds; local clear và MQTT `clearHardwareOverride` đều clear overlay.
- Regression: xóa module `local_control` không còn reference/link error; Core 1 50 ms TPC vẫn không truy cập NVS; SSR safety interlock còn hiệu lực khi override active.

## Assumptions

- `setup()` hoàn thành NVS hydration và queue creation trước khi khởi tạo Core 0/Core 1 tasks.
- Queue depth 1 là chủ đích vì setpoint là state snapshot, không phải event history.
- Backend không thể xóa manual override trừ payload xác thực có `clearHardwareOverride:true`; backend update thông thường chỉ thay baseline.
- Manual override tồn tại đến khi clear cục bộ/MQTT hoặc factory reset.
- Màn hình/display manager không nằm trong Sprint 3.
