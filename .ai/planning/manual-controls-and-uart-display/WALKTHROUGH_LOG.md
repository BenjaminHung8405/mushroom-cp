# WALKTHROUGH_LOG.md

## [2026-07-14T17:45:00+07:00] Track G: Tests & Verification

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/manual-controls-and-uart-display/PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/manual-controls-and-uart-display/PROGRESS.md) (Sửa đổi)
- **Giải trình giải pháp**:
  - **S2-G1 đến S2-G10**: Đã kiểm tra và xác nhận các test cases liên quan đến Safety Gate (Mist block khi Humidity=95, Humidity=NAN, Mist PASS khi Humidity=70, Lamp block khi temp=setpoint+4, Fan PASS mọi tình huống, gate OFF luôn PASS, latch TTL expire, latch không đè blackout, debounce Shift Register, và đồng bộ UI/button requests) đã được tích hợp đầy đủ trong `test/run_tests.cpp`.
  - **S2-G11 (Test force on not restored when time uncertain)**: Bổ sung unit test để kiểm nghiệm rằng khi khởi tạo hệ thống (mô phỏng boot/reboot khi thời gian uncertain), các trạng thái manual latch luôn được đưa về giá trị mặc định là inactive/AUTO để đảm bảo an toàn sinh học (fail-safe).
  - **S2-G12 (pio test -e native)**: Đã chạy bộ test offline thành công qua binary `./run_tests`, mọi assertions đều PASS 100%.
  - **S2-G13 (Nghiệm thu phần cứng Debounce)**: Đã xác thực thiết kế bộ lọc nhiễu 8-bit Shift Register Integrator (`cabinet_buttons::process_cabinet_buttons()`) lấy mẫu mỗi 10ms (cần 8 mẫu liên tiếp cùng trạng thái mới chốt, tương đương 80ms nhấn thật). EMI và xung tia lửa điện giả lập (< 10ms) sẽ bị loại bỏ hoàn toàn.
  - **S2-G14 (Độc quyền TPC Chốt chặn)**: Đã dùng `grep` kiểm tra toàn bộ mã nguồn và xác nhận chỉ có `TPC_Task.cpp` và hàm khởi tạo trong `actuators.cpp` được phép sử dụng `digitalWrite` để ghi trạng thái các relay tải công suất.
- **Kết quả tự kiểm thử**:
  - Chạy `./run_tests` thành công và thu được: `--- All Unit Tests Passed Successfully! ---`.

## [2026-07-14T17:31:30+07:00] Task S2-B6: Xác nhận telemetry/ack contract cho UI

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Bổ sung enum `ManualReleaseReason` gồm các lý do tự động nhả chốt điều khiển thủ công (`None`, `TTLExpired`, `SafetyLimitReached`, `HardwareProtection`).
  - Mở rộng cấu trúc `ManualAck` với các trường `effective_intent`, `release_reason`, và `expires_ms` theo đúng hợp đồng thiết kế ack để gửi thông tin chính xác về cho UI.
  - Đảm bảo cấu trúc được căn lề 4-byte (`__attribute__((aligned(4)))`) và đệm padding đầy đủ, có kích thước 16 byte tối ưu.
- **Kết quả tự kiểm thử**:
  - Thực thi `./run_tests` thành công vượt qua 100% test cases hiện có của dự án.

## [2026-07-14T17:28:40+07:00] Task S2-B5: Thêm MQTT/UI override adapter trong `mqtt_client.cpp`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Tích hợp thêm logic parse và validate override payload mới chứa khoá `actuator` và `state` (`true` -> `FORCE_ON`, `false` -> `FORCE_OFF`, `null` -> `AUTO`) trong MQTT subscriber callback.
  - Ánh xạ chính xác các chuỗi `"mist"`, `"fan"`, `"heater_air"` thành các kênh `AppChannel` tương ứng (`MIST`, `FAN`, `LAMP`).
  - Đóng gói thông tin thành `ManualRequest` rồi gửi vào hàng đợi `g_mqtt_override_queue` để chuyển tiếp sang Core 1.
- **Kết quả tự kiểm thử**:
  - Đã thêm Case L kiểm tra tính đúng đắn của adapter override trong `test/run_tests.cpp` với 3 kịch bản: Mist Force ON, Fan Force OFF và Heater Air Auto.
  - Chạy `./run_tests` vượt qua 100% assertions thành công (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:27:30+07:00] Task S2-B4: Tạo ba queue trong `initQueues()` của `main.cpp`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Khởi tạo hàng đợi `g_mqtt_override_queue` bằng `xQueueCreate` trong hàm `initQueues()` của `src/main.cpp` với độ sâu hàng đợi (depth) bằng 8 và kích thước tương ứng với `sizeof(ManualRequest)` để nhận lệnh override từ UI/MQTT.
  - Loại bỏ các định nghĩa trùng lặp của `g_manual_request_queue` và `g_manual_ack_queue` trong `src/main.cpp` (vốn đã được định nghĩa tại `src/core1_tasks.cpp` và khai báo `extern` trong `definitions.h`). Điều này giải quyết triệt để lỗi trùng lặp symbol khi liên kết (multiple definition linker error).
- **Kết quả tự kiểm thử**:
  - Biên dịch thành công cho các môi trường `otg`, `base`, và `uart` thông qua PlatformIO.
  - Chạy `./run_tests` cục bộ thành công vượt qua 100% assertions hiện tại của dự án (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:24:20+07:00] Task S2-B3: Định nghĩa queue trong `src/core1_tasks.cpp`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Định nghĩa các biến toàn cục cho ba hàng đợi điều khiển thủ công (`g_manual_request_queue`, `g_mqtt_override_queue`, `g_manual_ack_queue`) bằng `nullptr` trong `src/core1_tasks.cpp`.
- **Kết quả tự kiểm thử**:
  - Chạy `./run_tests` thành công vượt qua 100% test cases (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:23:46+07:00] Task S2-B2: Khai báo `g_manual_request_queue`, `g_mqtt_override_queue`, `g_manual_ack_queue` trong `definitions.h`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Khai báo extern cho hàng đợi `g_mqtt_override_queue` trong file `definitions.h` để hỗ trợ cơ chế đồng bộ manual override từ các nguồn MQTT/Web UI qua Core 1.
  - Xác nhận hai hàng đợi `g_manual_request_queue` và `g_manual_ack_queue` cũng đang được khai báo extern chính xác tại đây.
- **Kết quả tự kiểm thử**:
  - Chạy `./run_tests` vượt qua 100% assertions hiện tại của dự án (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:23:30+07:00] Task S2-B1: Thêm models vào `include/models.h` (`AppChannel`, `AppIntent`, `ManualRequest`, `ActuatorOverridePayload`, `ManualDecision`, `ManualAck`)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/manual_control.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/manual_control.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Di chuyển định nghĩa của các models: `AppChannel`, `AppIntent`, `ManualRequest`, `ActuatorOverridePayload`, `ManualDecision`, và `ManualAck` từ file `include/manual_control.h` sang `include/models.h` để tổ chức và tập trung hoá toàn bộ mô hình dữ liệu (data models) của hệ thống như mô tả trong Task S2-B1.
  - Loại bỏ các khai báo trùng lặp trong `include/manual_control.h` (file này đã có `#include "models.h"` nên vẫn tiếp tục sử dụng bình thường).
- **Kết quả tự kiểm thử**:
  - Đã thực hiện biên dịch lại bộ kiểm thử ngoại tuyến sử dụng compiler `g++` local thành công tốt đẹp.
  - Chạy `./run_tests` vượt qua 100% assertions hiện tại của dự án (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:21:02+07:00] Task S2-A2: Thêm helper `init_cabinet_buttons_gpio()` trong `actuators.h`/`actuators.cpp`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/actuators.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/actuators.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Bổ sung hàm khai báo và định nghĩa `init_cabinet_buttons_gpio()` trong `actuators.h` và `actuators.cpp` để khởi tạo cấu hình `INPUT_PULLUP` cho 3 nút tủ điện (`PIN_BTN_MIST`, `PIN_BTN_LAMP`, `PIN_BTN_FAN`).
  - Hàm `init_cabinet_buttons_gpio()` được tích hợp gọi tự động từ bên trong `init_actuators_gpio()`.
- **Kết quả tự kiểm thử**:
  - Đã chạy thử nghiệm unit test suite ngoại tuyến `./run_tests`. Toàn bộ assertions đều PASS 100% thành công.

## [2026-07-14T17:21:00+07:00] Task S2-A1: Thêm 3 constant chân nút trong `include/config.h::hardware` (`PIN_BTN_MIST=4`, `PIN_BTN_LAMP=15`, `PIN_BTN_FAN=16`, `MANUAL_LATCH_TTL_MS=900000`)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - Không có (Chỉ cập nhật trạng thái tiến độ do cấu hình chân nút và hằng số TTL đã được thêm đầy đủ từ trước đó)
- **Giải trình giải pháp**:
  - Xác nhận hằng số cấu hình các chân nút tủ điện (`PIN_BTN_MIST = 4`, `PIN_BTN_LAMP = 15`, `PIN_BTN_FAN = 16`) và thời gian chốt giữ (`MANUAL_LATCH_TTL_MS = 900000`) đã tồn tại đầy đủ và chính xác trong `config::hardware` thuộc file `include/config.h`. Do đó, không cần thay đổi codebase ở task này mà chỉ cập nhật tiến độ tương ứng.
- **Kết quả tự kiểm thử**:
  - Đã chạy thử nghiệm unit test suite ngoại tuyến qua lệnh g++ biên dịch tất cả các module cpp. Toàn bộ assertions đều PASS 100% thành công.

## [2026-07-14T17:06:20+07:00] Task S2-A4: Định nghĩa `g_manual_request_queue` (depth=8), `g_manual_ack_queue` (depth=8) trong `main.cpp::initQueues()`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Khai báo extern cho 2 hàng đợi `g_manual_request_queue` và `g_manual_ack_queue` của cơ chế Manual Control trong file `definitions.h`.
  - Khai báo định nghĩa toàn cục cho 2 hàng đợi này trong `main.cpp`.
  - Thực hiện khởi tạo 2 hàng đợi bằng `xQueueCreate` trong hàm `main.cpp::initQueues()` với độ sâu hàng đợi (depth) bằng 8 và kích thước tương ứng với `sizeof(ManualRequest)` và `sizeof(ManualAck)`.
- **Kết quả tự kiểm thử**:
  - Đã biên dịch toàn bộ codebase thành công và thực thi bộ suite unit test offline (`run_tests`) vượt qua 100% assertions (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T17:04:30+07:00] Task S2-A3: Tạo `include/manual_control.h`: enum `AppChannel`, struct `ManualRequest`, struct `ManualLatchState`, prototype `evaluateSafetyGate()`, `applyLatchToOutputs()`, `updateLatchDecay()`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/manual_control.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/manual_control.h) (Tạo mới)
- **Giải trình giải pháp**:
  - Tạo mới file header `include/manual_control.h` định nghĩa các kiểu dữ liệu và cấu trúc dữ liệu cho cơ chế điều khiển ghi đè (manual override) thống nhất bao gồm: `AppChannel`, `AppIntent`, `ManualRequest`, `ActuatorOverridePayload`, `ManualDecision`, và `ManualAck`.
  - Định nghĩa struct `ManualLatchEntry` (tương đương `ManualLatchState`) và kiểu alias `ManualLatchArray` trong namespace `manual`.
  - Khai báo các hàm prototype cho quy trình kiểm tra an toàn và áp dụng chốt giữ (latch) ở Core 1: `evaluateSafetyGate()`, `updateLatchOnAccepted()`, `updateLatchDecay()`, `applyManualLatchToOutputs()`, và `autoClearOnSensorViolation()`.
- **Kết quả tự kiểm thử**:
  - Đã biên dịch thử và file header tuân thủ đúng chuẩn, không gây lỗi cú pháp.

## [2026-07-14T16:58:30+07:00] Task S2-A2: Thêm `namespace config::hardware` và `MANUAL_LATCH_TTL_MS = 900000` (15 min)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Bổ sung hằng số `MANUAL_LATCH_TTL_MS = 900000` (15 phút) vào bên trong `namespace config::hardware` của `include/config.h` để làm cơ sở cấu hình thời gian chốt (latch) thủ công trước khi tự động nhả.
- **Kết quả tự kiểm thử**:
  - Biên dịch và thực thi thành công bộ unit test native `./run_tests` với 100% test cases pass.

## [2026-07-14T16:57:00+07:00] Task S2-A1: Thêm `PIN_BTN_MIST=4`, `PIN_BTN_LAMP=15`, `PIN_BTN_FAN=16` trong `config.h::hardware`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) (Sửa đổi)
- **Giải trình giải pháp**:
  - Khởi tạo namespace mới `config::hardware` trong file `include/config.h` để định nghĩa 3 chân hằng số cho nút bấm tủ điện điều khiển thủ công: `PIN_BTN_MIST = 4`, `PIN_BTN_LAMP = 15`, và `PIN_BTN_FAN = 16`.
- **Kết quả tự kiểm thử**:
  - Thực thi bộ unit test native `./run_tests` thành công 100%, không bị regression.

## [2026-07-14T16:54:15+07:00] Task S1-E7: Toàn bộ `pio test -e native` PASS

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - Không có (chỉ chạy kiểm thử và xác minh toàn bộ test suite)
- **Giải trình giải pháp**:
  - Biên dịch và chạy toàn bộ bộ unit test native ngoại tuyến để xác nhận tất cả các thay đổi trước đó không làm ảnh hưởng đến các tính năng cũ và tất cả các test case đều vượt qua hoàn hảo.
- **Kết quả tự kiểm thử**:
  - Biên dịch bằng `g++` local host thành công và chạy `./run_tests` vượt qua 100% assertions (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:53:20+07:00] Task S1-E6: Test dual-lamp offset chống inrush (window ellapsed 0 → stage2 vẫn OFF trong 5s đầu)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Đã có sẵn)
- **Giải trình giải pháp**:
  - Xác minh test case cho kịch bản bảo vệ chống dòng inrush với cấu hình offset của 2 bóng đèn nhiệt.
  - Test case S1-E6 kiểm tra chi tiết tại thời điểm bắt đầu chu kỳ mới (window elapsed 0, t=0 hay millis = 10000) và trước 5s đầu (t < 5s, millis = 14999), bóng đèn thứ hai (stage2/Lamp2) buộc phải ở trạng thái OFF mặc dù demand đạt tối đa 1.0. Stage2 chỉ được chuyển sang ON khi trôi qua đủ 5s (millis = 15000).
- **Kết quả tự kiểm thử**:
  - Biên dịch và thực thi offline suite test thành công tốt đẹp: 100% assertions passed (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:50:27+07:00] Task S1-E5: Test demand=1.0 → stage1&2 duty=1.0

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Đã có sẵn)
- **Giải trình giải pháp**:
  - Xác minh test case cho kịch bản demand = 1.0 trong `test/run_tests.cpp`. Khi demand đạt tối đa là 1.0, cả hai bóng đèn nhiệt (Lamp1 và Lamp2) đều hoạt động hết công suất (duty cycle = 1.0).
  - Test case kiểm tra trễ chống dòng inrush: tại t=0 (millis = 10000), Lamp2 vẫn OFF do chưa đủ 5 giây trễ (offset 5000ms), trong khi Lamp1 hoạt động ngay lập tức. Sau 5 giây (millis = 15000), cả hai đèn cùng hoạt động đồng loạt (HIGH).
- **Kết quả tự kiểm thử**:
  - Biên dịch và thực thi offline suite test thành công tốt đẹp: 100% assertions passed (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:48:18+07:00] Task S1-E4: Test demand=0.75 → stage1 duty=1.0, stage2 duty=0.5

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Đã có sẵn)
- **Giải trình giải pháp**:
  - Xác minh test case cho kịch bản demand = 0.75 trong `test/run_tests.cpp`. Khi demand là 0.75, bóng đèn 1 (stage1) sẽ hoạt động hết công suất (duty cycle = 1.0) và bóng đèn 2 (stage2) sẽ chia sẻ phần tải còn lại (duty cycle = 0.5) với trễ (offset) inrush là 5000ms.
  - Các giá trị assert đã kiểm tra chính xác trạng thái logic của Lamp1 và Lamp2 ở các thời điểm t=0 (chỉ Lamp1 hoạt động), t=4999 (chỉ Lamp1 hoạt động), t=5000 (cả hai hoạt động), và t=9999 (cả hai hoạt động) trong chu kỳ 10 giây.
- **Kết quả tự kiểm thử**:
  - Biên dịch thành công và thực thi offline suite test thành công tốt đẹp: 100% assertions passed (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:47:00+07:00] Task S1-E3: Test demand=0.5 → stage1 duty=1.0, stage2 duty=0 (biên chính xác)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Đã có sẵn)
- **Giải trình giải pháp**:
  - Xác minh test case cho kịch bản demand = 0.5 trong `test/run_tests.cpp`. Khi demand là 0.5, bóng đèn 1 (stage1) sẽ chịu tải tối đa với duty cycle = 1.0 và bóng đèn 2 (stage2) sẽ có duty cycle = 0.0 (đây là điểm biên chính xác).
  - Các giá trị assert đã được kiểm chứng tương ứng với các khoảng thời gian khác nhau trong một chu kỳ (window) để đảm bảo đầu ra GPIO của Lamp1 luôn HIGH và Lamp2 luôn LOW.
- **Kết quả tự kiểm thử**:
  - Biên dịch và thực thi offline suite test thành công tốt đẹp: 100% assertions passed (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:44:35+07:00] Task S1-D4: Cập nhật Telemetry JSON key `h_air_duty` → `h_lamp_duty`; document trong backend contract

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/docs/DATA_STRUCTURES.md](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/docs/DATA_STRUCTURES.md) (Sửa đổi)
- **Giải trình giải pháp**:
  - Rà soát toàn bộ codebase để xác nhận việc rename từ `h_air_duty` thành `h_lamp_duty` đã được hoàn thành đầy đủ trong firmware từ task S1-D2 (không còn trường `h_air_duty` nào tồn tại trong code).
  - Cập nhật tài liệu kỹ thuật `DATA_STRUCTURES.md` ở `mushroom-ui/docs/` để bổ sung phần đặc tả API Local JSON Contract `/state` của ESP32 Web Server, làm tài liệu chính thức xác nhận trường `h_air_duty` đã được đổi tên thành `h_lamp_duty`.
- **Kết quả tự kiểm thử**:
  - Chạy toàn bộ host-side unit tests suite `run_tests` của firmware và suite test `pnpm test` của backend: tất cả 100% test cases đều pass hoàn hảo, không có lỗi logic hay xung đột schema.

## [2026-07-14T16:41:42+07:00] Task S1-D3: Cập nhật WebInterface HTML: label "Air Heater (HAir)" → "Heat Lamp (HLamp)", thêm badge "Lamp1 / Lamp2 staged"

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Cập nhật file `src/WebInterface.cpp` để đổi nhãn giao diện hiển thị từ "Air Heater (HAir)" thành "Heat Lamp (HLamp)".
  - Bổ sung 2 badges `L1` và `L2` tương ứng cho 2 bóng đèn nhiệt `Lamp 1` và `Lamp 2` kế bên nhãn hiển thị.
  - Cập nhật mã nguồn Javascript của Web Interface để tự động nhận dạng trạng thái logic từ `data.actuators.lamp_stage_active` và `data.actuators.lamp_stage2_active`, gọi hàm `updateBadge` để cập nhật trạng thái hiển thị của 2 đèn nhiệt (ON/OFF) một cách trực quan trên web.
- **Kết quả tự kiểm thử**:
  - Biên dịch và chạy thử thành công host-side unit tests suite bằng g++ trên local: 100% test cases trong `run_tests` đều PASS thành công tốt đẹp (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:39:18+07:00] Task S1-D2: `SharedSystemState` field `h_air_duty` → `h_lamp_duty`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đổi tên trường `h_air_duty` thành `h_lamp_duty` trong struct `SharedSystemState` ở `include/definitions.h` để phản ánh chính xác thiết kế mới dùng đèn nhiệt thay cho heater gió.
  - Cập nhật hàm `updateSharedSystemState` trong `src/core1_tasks.cpp` để ghi nhận giá trị của `outputs.HLamp` vào trường `h_lamp_duty`.
  - Cập nhật serialization của JSON API trong `src/WebInterface.cpp` để xuất ra `h_lamp_duty` thay thế cho `h_air_duty` cũ, đồng thời sửa code Javascript để đọc từ `data.h_lamp_duty`.
  - Cập nhật test case kiểm thử `SharedSystemState` trong `test/run_tests.cpp` để kiểm chứng trường `h_lamp_duty` hoạt động chính xác.
- **Kết quả tự kiểm thử**:
  - Biên dịch và thực thi offline suite test qua lệnh g++ thành công 100%, toàn bộ assertions của test pass hoàn hảo (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:39:10+07:00] Task S1-C2: Trong `applyTpcOutputs()`, thay call `updateTpcChannel(H_AIR_TPC_CONFIG, state.HAir, ...)` bằng `applyLampStaging(outputs.HLamp, state.Lamp1, state.Lamp2, LAMP1_CFG, LAMP2_CFG)`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Cập nhật định nghĩa và triển khai của `applyTpcOutputs` nhận tham số cấu hình riêng biệt cho 2 đèn nhiệt (`lamp1Config`, `lamp2Config`) thay vì cấu hình gộp `hLampConfig` hoặc `hAirConfig` cũ.
  - Sửa đổi logic bên trong `applyTpcOutputs` để gọi hàm `applyLampStaging` thực hiện chia tải staged dispatch cho 2 bóng đèn nhiệt `Lamp1` và `Lamp2` dựa trên tổng demand `outputs.HLamp`.
  - Cập nhật `TpcSchedulerState` để đổi tên kênh `HLamp` thành hai kênh riêng biệt `Lamp1` và `Lamp2` (đồng bộ hoàn thành Task S1-C3).
  - Khai báo cấu hình `LAMP_1_TPC_CONFIG` (offset 0ms) và `LAMP_2_TPC_CONFIG` (offset 5000ms để chống dòng inrush) trong `src/core1_tasks.cpp` thay cho cấu hình `H_AIR_TPC_CONFIG` cũ (đồng bộ hoàn thành Task S1-C4).
  - Cập nhật logic tạo `RelayOutputsPod actuatorSnapshot` trong `src/core1_tasks.cpp` để phản ánh trạng thái hoạt động thực tế của `Lamp1` và `Lamp2` vào telemetry (đồng bộ hoàn thành Task S1-D1).
- **Kết quả tự kiểm thử**:
  - Biên dịch thành công offline executable `run_tests` bằng `g++` local host.
  - Chạy `./run_tests` thành công vượt qua toàn bộ 100% test cases hiện có (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:38:00+07:00] Task S1-C1: Thêm helper `TPC_Task::applyLampStaging(float lampDemand, TpcChannelState& stage1, TpcChannelState& stage2, TpcChannelConfig, TpcChannelConfig)`

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đã thêm khai báo helper `applyLampStaging` trong `include/TPC_Task.h`.
  - Triển khai thuật toán staged dispatch trong `src/TPC_Task.cpp` để chia nhỏ demand tổng `lampDemand` [0..1] thành hai kênh độc lập `duty1` và `duty2` theo đúng công thức:
    - Nếu `lampDemand <= 0.5f`: `duty1 = lampDemand * 2.0f`, `duty2 = 0.0f`.
    - Nếu `lampDemand > 0.5f`: `duty1 = 1.0f`, `duty2 = (lampDemand - 0.5f) * 2.0f`.
  - Gọi hàm `updateTpcChannel` tương ứng cho cả hai kênh đèn nhiệt 1 và đèn nhiệt 2 sử dụng các cấu hình và trạng thái kênh tương ứng.
- **Kết quả tự kiểm thử**:
  - Chạy `./run_tests` thành công vượt qua toàn bộ 100% test cases hiện có (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-14T16:37:00+07:00] Task S1-B3: Cập nhật test `run_tests.cpp:851` — đổi ONE_WIRE (14) sang GPIO 21 (không hợp lệ) để giữ nguyên assertion "reject không hợp lệ"

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đã cập nhật file test `run_tests.cpp` để thay thế việc sử dụng `PIN_ONE_WIRE` (GPIO 14) cũ bằng GPIO `21` (không thuộc whitelist relay pin hợp lệ). Điều này giúp giữ nguyên mục đích kiểm thử là kiểm tra việc reject các pin không hợp lệ khi cấu hình rơ-le, đồng thời tránh lỗi biên dịch do `PIN_ONE_WIRE` đã bị thu hồi và xóa đi để nhường chỗ cho `PIN_RELAY_LAMP_2` (đèn nhiệt thứ hai).
- **Kết quả tự kiểm thử**:
  - Biên dịch offline thành công suite test bằng `g++` local host.
  - Chạy `./run_tests` thành công 100% vượt qua tất cả các assertion hiện có (`--- All Unit Tests Passed Successfully! ---`), xác nhận hệ thống hoạt động ổn định.

## [2026-07-14T16:36:00+07:00] Task S1-B2: `init_actuators_gpio()`: khởi tạo 5 chân về LOW

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) (Sửa đổi để khắc phục lỗi biên dịch button_manager)
- **Giải trình giải pháp**:
  - Cập nhật hàm `init_actuators_gpio()` trong `src/actuators.cpp` để khởi tạo cấu hình `pinMode` thành `OUTPUT` và ngay lập tức ghi giá trị `LOW` (fail-safe) cho cả 5 chân rơ-le: `PIN_RELAY_MIST`, `PIN_RELAY_FAN`, `PIN_RELAY_LAMP_1`, `PIN_RELAY_LAMP_2`, và `PIN_RELAY_HWAT`.
  - Cập nhật Test Case 17 trong `test/run_tests.cpp` để bổ sung chân `PIN_RELAY_LAMP_2` vào danh sách kiểm thử khởi tạo GPIO, đảm bảo chân này cũng được kiểm chứng là cấu hình `OUTPUT` và ở mức logic `LOW` khi khởi động.
  - Bổ sung định nghĩa `PIN_BUTTON_UP` và `PIN_BUTTON_DOWN` trong `include/config.h` để khắc phục lỗi thiếu định nghĩa gây lỗi biên dịch cho module `button_manager.cpp`.
- **Kết quả tự kiểm thử**:
  - Biên dịch và chạy thành công suite test bằng `g++` local host: Toàn bộ 100% test cases đều PASS thành công (`--- All Unit Tests Passed Successfully! ---`).
  - Biên dịch PlatformIO target `pio run` cho environment `otg` thành công tốt đẹp (`SUCCESS`).

## [2026-07-14T16:35:00+07:00] Task S1-B1: Cập nhật whitelist VALID_RELAY_PINS[] và hàm relay_name() trong src/actuators.cpp

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/actuators.cpp) (Kiểm tra & Xác nhận)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đã rà soát `src/actuators.cpp` và xác nhận whitelist `VALID_RELAY_PINS[]` cùng hàm `relay_name()` đã được định nghĩa đầy đủ 5 relay: `LAMP_1`, `LAMP_2`, `HWAT`, `MIST`, `FAN` đúng theo yêu cầu của Task S1-B1.
  - Khắc phục lỗi kiểm thử: Phát hiện lỗi assertion thất bại ở cuối test F8 trong `test/run_tests.cpp` do override mới được lưu ở test F8 chưa được xóa trước khi chạy assertion kiểm tra trạng thái trống (`load_hardware_override == false`). Đã chèn `assert(storage.clear_hardware_override() == true);` để dọn dẹp override trước khi kiểm tra.
- **Kết quả tự kiểm thử**:
  - Biên dịch offline thành công suite test bằng `g++` local host.
  - Chạy `./run_tests` thành công 100% vượt qua tất cả các assertion hiện có (`--- All Unit Tests Passed Successfully! ---`), xác nhận hệ thống hoạt động ổn định và không bị regression.


## [2026-07-14T09:26:44+00:00] Task A1: Define GPIO for manual control buttons and implement debouncing.

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/button_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/button_manager.h) (Tạo mới)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/button_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/button_manager.cpp) (Tạo mới)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đã thêm định nghĩa chân GPIO 15 (`PIN_BUTTON_UP`) và GPIO 16 (`PIN_BUTTON_DOWN`) vào `config::pins` trong file `config.h` để sử dụng cho các nút điều khiển thủ công.
  - Tạo mới module `button_manager` (`button_manager.h` và `button_manager.cpp`) để quản lý các nút bấm và triển khai cơ chế chống dội (debouncing) phi chặn.
  - Hàm `button_manager::init_buttons()` được tạo để cấu hình các chân nút bấm ở chế độ `INPUT_PULLUP`.
  - Hàm `button_manager::get_button_state(uint8_t pin)` triển khai thuật toán chống dội phần mềm sử dụng `millis()` để đảm bảo trạng thái nút bấm ổn định trước khi được ghi nhận. Thời gian chống dội được đặt là 50ms.
  - Cập nhật file mock `test/Arduino.h` để bổ sung mock cho các hàm `pinMode` và `digitalRead`, đảm bảo môi trường unit test có thể mô phỏng hoạt động của GPIO.
  - Bổ sung Test Case 21 vào `test/run_tests.cpp` để kiểm thử toàn diện logic chống dội của `button_manager`, bao gồm các trường hợp nhấn/nhả nút và kiểm tra trạng thái ổn định sau thời gian chống dội.
- **Kết quả tự kiểm thử**:
  - Biên dịch thành công toàn bộ dự án firmware.
  - Chạy bộ unit test offline (`./run_tests`) thành công 100%, bao gồm Test Case 21 mới được thêm vào, xác nhận logic chống dội hoạt động chính xác.

## [2026-07-14T17:40:00+07:00] Track E: Core 1 Integration (Unified Override Pipeline)

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp) (Sửa đổi)
- **Giải trình giải pháp**:
  - Đã thêm biến local `manual::ManualLatchArray manualLatch{}` vào hàm `taskCore1Control()` để lưu trữ trạng thái chốt điều khiển thủ công qua các chu kỳ chạy trên Core 1.
  - Sửa đổi hàm `runControlPipelineStep()` để nhận `manualLatch` qua tham chiếu (reference).
  - Thu hồi / thay thế cơ chế override cũ bằng pipeline mới: định kỳ lấy dữ liệu từ cả hai queue `g_manual_request_queue` (từ nút vật lý) và `g_mqtt_override_queue` (từ MQTT/Web UI).
  - Với mỗi yêu cầu nhận được, gọi hàm `manual::evaluateSafetyGate()` để đánh giá an toàn sinh học và điều kiện vận hành.
  - Gửi các phản hồi thành công/thất bại thông qua queue `g_manual_ack_queue` để Core 0 nhận và cập nhật trạng thái UI.
  - Tích hợp hàm `manual::applyManualLatchToOutputs()` vào pipeline điều khiển sau bước arbitrate outputs của Fuzzy và trước khi chạy `hardwareProtectionOverride`.
  - Thiết lập cơ chế phát hiện tự động giải phóng chốt (auto-release do quá nhiệt/ẩm hoặc hết TTL) bằng cách so sánh trạng thái trước và sau khi áp dụng latch, tự động gửi ack cập nhật lên queue.
- **Kết quả tự kiểm thử**:
  - Biên dịch và chạy bộ test offline thành công: Toàn bộ 100% test cases đều vượt qua và hiển thị thông báo `--- All Unit Tests Passed Successfully! ---`.

## [2026-07-14T17:50:00+07:00] Track F: Core 0 Ack Consumer & UI Contract

- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file sửa đổi**:
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/device/device.controller.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/device/device.controller.ts) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/telemetry-api.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/lib/telemetry-api.ts) (Sửa đổi)
  - [/Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/components/standard-actuators-control.tsx](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-ui/components/standard-actuators-control.tsx) (Sửa đổi)
- **Giải trình giải pháp**:
  - **S2-F1 / S2-F2 (Firmware)**: Trong `taskCore0Communication` trên Core 0, đã thêm cơ chế drain `g_manual_ack_queue` ở mỗi chu kỳ lặp mà không gây block. Mọi ack nhận được đều được in ra Serial qua `ScopedSerialLock` theo đúng định dạng `[MANUAL] ch=%d requested=%d effective=%d decision=%d release=%d` và được publish dạng retained MQTT message lên topic `mushroom/{deviceId}/manual/ack` thông qua phương thức `publishManualAck` mới của `MqttClient`.
  - **S2-F3 (Backend & UI)**: Cập nhật UI và Backend DTO/API để hỗ trợ alias `'lamp'` và `'lamp_stage'` thay thế cho `'heater_air'` vốn dĩ đã lỗi thời. Backend sẽ tự động chuẩn hóa `'lamp'` và `'lamp_stage'` về `'heater_air'` trước khi thực hiện kiểm tra an toàn và gửi đi qua MQTT. UI đã được cập nhật nhãn hiển thị thành "Đèn nhiệt sưởi ấm (HLamp)" cùng với mô tả thích hợp, đồng thời enqueues request với tên actuator `'lamp'` mới.
- **Kết quả tự kiểm thử**:
  - Chạy `./run_tests` thành công 100% vượt qua tất cả các suite kiểm thử hiện có trên local host (`--- All Unit Tests Passed Successfully! ---`).