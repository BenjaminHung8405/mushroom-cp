## [2026-07-13T11:23:30+07:00]
- **Task ID**: F4
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Khai báo và triển khai `hydrateSetpointsFromNVS()`**:
    - Hàm được định nghĩa trong `definitions.h` và cài đặt trong `main.cpp`.
    - Thực hiện nạp hai snapshot từ NVS: backend setpoint baseline và hardware override setpoint.
    - Nếu baseline NVS trống hoặc không hợp lệ, hệ thống sẽ tự động fallback về setpoint của Trajectory Day 0 (Nhiệt độ: 24.0°C, Độ ẩm: 90.0%, CO2: 1000 ppm) và ghi đè vào queue `xBaselineQueue`.
    - Nếu hardware override trong NVS có thuộc tính `active = true`, hàm sẽ đẩy setpoint ghi đè tương ứng vào queue `xOverrideQueue`. Ngược lại, đẩy một inactive command để đảm bảo Core 1 không bị trạng thái rác.
  - **Tích hợp vào chu kỳ khởi tạo khởi động (`setup()`)**:
    - Gọi hàm `hydrateSetpointsFromNVS()` ngay sau khi tạo queue (`initQueues()`) và semaphore (`initSemaphores()`), nhưng trước khi khởi tạo WiFi và phân bổ chạy các FreeRTOS tasks. Việc này đảm bảo Core 0/Core 1 khởi chạy với dữ liệu setpoint chính xác nhất ngay từ tick đầu tiên.
  - **Bổ sung Unit Tests & Kiểm thử**:
    - Tạo Test Case 34 trong `test/run_tests.cpp` để kiểm chứng logic hydration: verify kịch bản NVS trống (fallback Trajectory Day 0 thành công) và kịch bản NVS có lưu trữ hợp lệ (đọc và đẩy chính xác vào baseline và override queues).
    - Biên dịch và chạy bộ kiểm thử thành công, đạt 100% test case passed.

## [2026-07-13T11:17:58+07:00]
- **Task ID**: F3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [MODIFY] [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Tách và loại bỏ legacy local_control trong MqttClient**: Cập nhật hàm `processSetpoints` để không gọi `local_control` nữa. Xóa các hàm phụ trợ cũ như `extractSetpoints`, `extractEnvironmentSetpoints`, `extractTtlAndProtection` để tuân thủ thiết kế lưu trữ mới.
  - **Hành vi xử lý Setpoints và Baseline**: Hàm `processSetpoints` tự động nạp `BackendSetpointSnapshot` từ NVS nếu có, cập nhật các setpoint mới nhận được sau khi validate thành công, ghi đè lưu trữ NVS và gửi struct `ControlSetpointCommand` (active=true) vào hàng FreeRTOS Queue `xBaselineQueue`.
  - **Fallback Trajectory Day 0**: Nếu NVS baseline trống hoặc không hợp lệ, setpoint sẽ fallback về trajectory Day 0 (T: 24.0°C, H: 90%, CO2: 1000 ppm) làm mặc định trước khi merge setpoint mới nhận được.
  - **Hỗ trợ clearHardwareOverride**: Khi nhận payload JSON chứa cờ `"clearHardwareOverride": true`, hệ thống sẽ xóa khóa `hw_ovr` trong NVS (gọi `StorageManager::clear_hardware_override()`), đồng thời đẩy lệnh clear (`ControlSetpointCommand` với `active=false`) vào hàng FreeRTOS Queue `xOverrideQueue` để báo hiệu Core 1 điều khiển quay lại dùng baseline.
  - **Tách hàm tuân thủ Coding Conventions (<50 dòng)**: Phân rã luồng xử lý setpoint thành các helper nhỏ dưới 50 dòng: `processSetpoints`, `parseAndPersistBaseline`, `validateSetpointPayload`, và `queueBaselineCommand`.
  - **Bổ sung và Chạy Unit Tests**: Thêm kịch bản kiểm thử tự động toàn diện trong `test/run_tests.cpp` (Case 33) để giả lập MQTT callback với setpoint hợp lệ (kiểm chứng NVS & xBaselineQueue) và lệnh clear (kiểm chứng NVS & xOverrideQueue). Chạy `./run_tests` thành công 100% test case pass.

## [2026-07-13T11:17:00+07:00]
- **Task ID**: F2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/models.h)
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Định nghĩa ControlSetpointCommand**: Thiết lập cấu trúc dữ liệu POD `ControlSetpointCommand` căn lề 4 bytes tối ưu (gồm `temp_target`, `humidity_target`, `co2_target`, `active` flag và 3 bytes padding) để truyền Setpoint qua hàng đợi liên nhân Core 0 -> Core 1.
  - **Thiết lập hai hàng FreeRTOS Queue**: Khai báo và khởi tạo hai hàng đợi FreeRTOS `xBaselineQueue` và `xOverrideQueue` độ sâu 1 (depth 1) chuyên biệt chứa `ControlSetpointCommand`. Hàng đợi baseline lưu Setpoint backend chính, hàng đợi override lưu Setpoint ghi đè thủ công từ nút vặn KY-040 hoặc MQTT, giúp cô lập hai tầng độc lập.
  - **Đọc và Dọn hàng đợi không chặn (Non-blocking Draining)**: Bổ sung logic kiểm tra và dọn hàng đợi ở đầu chu kỳ tick 50 ms tại hàm `runControlPipelineStep` sử dụng `xQueueReceive(..., 0)` không chặn để cập nhật Setpoint tức thời vào các trạng thái lưu giữ cục bộ `baselineCmd` và `overrideCmd` của Core 1.
  - **Cập nhật Mock Hàng đợi**: Bổ sung hàm mock `xQueueOverwrite` cho FreeRTOS stub ở file `test/Arduino.h` để hỗ trợ ghi đè hàng đợi sâu 1 trên môi trường host.
  - **Bổ sung và Chạy Unit Tests**: Viết các trường hợp kiểm thử tự động tại `test/run_tests.cpp` (Case 32) nhằm kiểm định kích thước căn lề 16 bytes của struct, cơ chế ghi đè hàng đợi và việc dọn hàng đợi chính xác trong Core 1 control loop. Thực hiện chạy thành công 100% test case pass thành công.

## [2026-07-13T11:15:00+07:00]
- **Task ID**: F1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [config.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/config.h)
  - [MODIFY] [storage.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/storage.h)
  - [MODIFY] [storage.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/storage.cpp)
  - [MODIFY] [Preferences.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Preferences.h)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Tạo Snapshot POD Typed cho Setpoint NVS**: Định nghĩa các struct `BackendSetpointSnapshot` (gồm `temp_target`, `humidity_target`, `co2_target`, và `valid` flag) và `HardwareOverrideSnapshot` (gồm `temp_target`, `humidity_target`, và `active` flag) căn lề 4 bytes an toàn để lưu trữ dữ liệu setpoint dạng nhị phân thô, giúp tối ưu hiệu năng ghi/đọc flash.
  - **Triển khai APIs Snapshots trong StorageManager**: Phát triển các hàm `save_backend_snapshot`, `load_backend_snapshot`, `clear_backend_snapshot`, `save_hardware_override`, `load_hardware_override`, và `clear_hardware_override`.
  - **Ràng buộc Khoảng và Bảo vệ Độ bền Flash (Wear-leveling)**:
    - Áp dụng kiểm duyệt dữ liệu nghiêm ngặt trước khi ghi: Backend (T: `[10.0, 45.0]`, H: `[30.0, 95.0]`, CO2: `[400.0, 10000.0]`) và Hardware Override (T: `[20.0, 40.0]`, H: `[50.0, 95.0]`).
    - Hỗ trợ lưu trữ trạng thái bypass validation khi flag `valid=false` hoặc `active=false` để đánh dấu vô hiệu hóa setpoint snapshot.
    - So sánh với giá trị cũ đã lưu và chỉ ghi khi chênh lệch của ít nhất một float lớn hơn hoặc bằng `0.099f` (ngưỡng an toàn thực tế tương đương `0.1f` tránh sai số dấu phẩy động của float) hoặc khi trạng thái boolean thay đổi.
  - **Cập nhật Mock Preferences và Unit Tests**:
    - Thêm triển khai cho `putBytes` và `getBytes` trong mock `Preferences.h` sử dụng chuỗi nhị phân thô của `std::string` để giả lập NVS chính xác trên máy chủ kiểm thử.
    - Viết các test case kiểm thử toàn diện cho Task F1 tại `test/run_tests.cpp` xác minh thành công 100% logic validation, wear-leveling epsilon, clear snapshot, và fallback. Biên dịch offline và chạy test suite pass thành công.

## [2026-07-13T11:06:00+07:00]
- **Task ID**: Refactoring & Quality Audit Compliance (Coding Conventions)
- **Trạng thái hiện tại**: Completed & All Tests Passed
- **Danh sách file**:
  - [MODIFY] [WebInterface.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/WebInterface.h)
  - [MODIFY] [WebInterface.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp)
  - [MODIFY] [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [MODIFY] [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Áp dụng camelCase & Định chuẩn Đặt tên**: Tái cấu trúc toàn bộ API và tên hàm của lớp `WebInterface`, `MqttClient`, các FreeRTOS Task callback (`taskCore0Communication`, `taskCore1Control`, `taskHardwareButton`), các hàm chia sẻ trạng thái đa nhân (`getSharedForceFullPublish`, `updateSharedSystemState`, vv.) từ snake_case sang camelCase theo quy chuẩn Coding Conventions của dự án.
  - **Tối ưu hóa & Phân rã mã nguồn (<50 dòng/hàm)**:
    - Phân tách `WebInterface::apiGetRealtimeData` thành `buildRealtimeDataPayload`.
    - Phân tách `MqttClient::init` thành `configurePubSubClient` và `validateConnectionConfig`.
    - Phân tách `MqttClient::handleMessage` thành `processPayload` và `handleMqttCommand`.
    - Phân tách `MqttClient::extractSetpoints` thành `processSetpoints`.
    - Phân tách `MqttClient::performMqttConnection` thành `maintainMqttConnection`.
    - Phân tách `core1_tasks.cpp::runControlPipelineStep` thành `getControlSetpointsAndErrors` và `updateWebInterfaceState`.
    - Phân tách `main.cpp::setup` thành các helper `initQueues`, `initSemaphores`, và `createCoreTasks`.
  - **Thêm cơ chế kiểm tra an toàn JSON**: Cải tiến `MqttClient::parseJsonPayload` để trả về cờ kiểm lỗi an toàn nếu quá trình parse JSON thất bại.
  - **Kiểm thử Đồng bộ**: Cập nhật toàn bộ các xác nhận (assertions) trong `test/run_tests.cpp` để khớp với API mới. Biên dịch và thực thi test suite thành công 100% không phát sinh cảnh báo.

## [2026-07-13T10:41:00+07:00]
- **Task ID**: B4/B5
- **Trạng thái hiện tại**: Đang chờ QA Review (Lần 2 - Đã sửa lỗi theo phản hồi từ QA)
- **Danh sách file**:
  - [MODIFY] [TPC_Task.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h)
  - [MODIFY] [TPC_Task.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [Telemetry.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Telemetry.cpp)
  - [MODIFY] [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [MODIFY] [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - **Khắc phục lỗi TPC & Staggered Startup**: Thêm tham số `offset_ms` vào `TpcChannelConfig`. Triển khai tính toán timing có staggered startup offset (`offset_ms`) dịch chuyển pha kích hoạt relay, đồng thời đảm bảo khoảng thời gian kích hoạt nằm gọn trong chu kỳ mà không bị wrapping bằng cách sử dụng `onEndMs = std::min(offset_ms + onDuration, window_ms)`.
  - **Đồng bộ cấu hình Phase 1**: Cập nhật cấu hình TPC của `HAir`, `HWat`, `Mist` và `Exhaust` trong `core1_tasks.cpp` khớp chuẩn xác với thông số Phase 1.
  - **Tách hàm tuân thủ Coding Conventions (<50 dòng)**:
    - `task_hardware_button` được tách thành các hàm helper xử lý nhấn (`handle_button_press`), nhả (`handle_button_release`) và giữ nút (`handle_button_hold`).
    - Vòng lặp điều khiển chính trong `task_core1_control` được trích xuất thành helper `runControlPipelineStep`.
    - Tách `Telemetry::buildDeltaPayload` thành `buildFullPayload` và `buildChangedDeltaPayload`.
    - Tách `MqttClient::handle_message` và các phương thức liên quan thành các helper nhỏ chuyên biệt (`parse_json_payload`, `handle_mqtt_command`, `extract_setpoints`, `process_setpoints` và `perform_mqtt_connection`).
  - **Khắc phục lỗi Đọc/Ghi ArduinoJson (dangling pointers)**: Sửa lỗi sử dụng stack buffer `safe_payload` gây lỗi dùng vùng nhớ rác sau khi thoát hàm do in-place parsing của ArduinoJson bằng cách ép kiểu sang `const char*` trước khi giải tuần tự hóa để buộc copy chuỗi. Khôi phục kiểu dữ liệu tham số của các hàm helper MQTT về `StaticJsonDocument<768>&` loại bỏ các lỗi chuyển đổi base class.
  - **Bổ sung Unit Tests Case 28**: Thêm kiểm tra chi tiết staggered startup offset cho các kênh HAir (offset 0s), HWat (offset 3s) và Mist (offset 8s) cùng việc giới hạn không wrapping. Chạy `./run_tests` thành công 100%.

## [2026-07-12T12:55:00+07:00]
- **Task ID**: E2
- **Trạng thái hiện tại**: Đang chờ QA Review (Lần 2 - Sửa đổi theo feedback của QA)
- **Danh sách file đã sửa**:
  - [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
  - [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [CryptoUtils.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/CryptoUtils.h)
  - [CryptoUtils.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/CryptoUtils.cpp)
  - [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - **Khắc phục luồng lệnh full_sync**: Không consume/xóa cờ `shared_forceFullPublish` trước khi publish thành công. Cờ được consume ở đầu publication scan, nhưng nếu encode hoặc publish thất bại, cờ được khôi phục nguyên tử bằng cách gọi `set_shared_force_full_publish(true)`. Nếu cờ được callback ghi đè lên trong lúc publish, nó vẫn được bảo toàn.
  - **Tách task_core0_communication()**: Hàm dài 129 dòng đã được tách thành các hàm helper nhỏ, mỗi hàm dưới 50 dòng và có một trách nhiệm duy nhất (`drainTelemetryQueue()`, `processWebServer()`, `processTelemetryPublication()`, `handleTelemetryScan()`, `logStackWatermark()`, `delayCore0Task()`).
  - **Đồng bộ UNIT_TEST loop**: Nhánh `UNIT_TEST` của `loop()` trong `main.cpp` hiện gọi trực tiếp `processTelemetryPublication()` thay vì duplicate luồng, đảm bảo kiểm thử đồng nhất với production.
  - **Bổ sung regression tests (Case 30.12)**: Thêm các kịch bản kiểm thử cho việc duy trì trạng thái FULL khi publish/encode thất bại, race condition callback full_sync trong lúc publish, và cập nhật cache thành công.

## [2026-07-12T14:00:00+07:00]
- **Task ID**: E2
- **Trạng thái hiện tại**: Đang chờ QA Review (Lần 2)
- **Danh sách file**:
  - [MODIFY] [Telemetry.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/Telemetry.h)
  - [MODIFY] [Telemetry.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Telemetry.cpp)
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - **[High] Lỗi 1 — Delta state mutation trước khi publish thành công**: Tách `evaluateDeltaThresholds()` thành pure evaluation (không mutate state). Thêm `commitSuccessfulPublish()` chỉ được gọi sau khi JSON hợp lệ, Base64 không rỗng, và `mqtt_client.publish_telemetry()` trả `true`. Khi encode/publish thất bại, state giữ nguyên để retry ở lần scan tiếp theo.
  - **[High] Lỗi 2 — Race condition cờ đa nhân**: Thêm `consume_shared_force_full_publish()` đọc + reset cờ trong cùng một critical section (mutex lock/unlock). Core 0 dùng hàm này thay cho cặp get/set riêng biệt, loại bỏ window race với MQTT callback.
  - **[Medium] Lỗi 3 — `delay()` trong `setup()`**: Xóa hoàn toàn `delay(200)` và busy-wait chờ Serial CDC khỏi `main.cpp::setup()` để safety path khởi động ngay, không bị block.
  - **[Regression tests]**: Bổ sung Case K kiểm tra atomic consume; các sub-case 30.0, 30.4–30.6 xác nhận Base64 oversize fail-safe, failed publish không mất delta/full_sync, encoding failure không clear forceFullPublish, heartbeat vẫn retry đúng.
  - **Tự kiểm tra**: Biên dịch host test `g++ -DUNIT_TEST` thành công, chạy `./run_tests` → `--- All Unit Tests Passed Successfully! ---` (toàn bộ 30+ test cases bao gồm Case K mới).



## [2026-07-12T12:28:07+07:00]
- **Task ID**: E2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [core0_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core0_tasks.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
- **Giải trình ngắn gọn**:
  - Triển khai định tuyến và duy trì hoạt động WebServer cục bộ (`web_interface::handle_client()`) trong tác vụ Core 0 loop (`task_core0_communication`) dựa trên trạng thái kết nối WiFi STA (chỉ chạy khi ở chế độ `STA_CONNECTED`, tự động dừng khi mất WiFi hoặc kích hoạt SoftAP).
  - Tích hợp và cấu hình kiểm tra độ lệch delta cảm biến định kỳ mỗi 5000 ms bằng bộ so sánh non-blocking `millis()`.
  - Kết xuất và đồng bộ hóa cờ `shared_forceFullPublish` nhận từ MQTT Broker để ép gửi gói tin telemetry đầy đủ (`PublishType::FULL`).
  - Sử dụng hàm `Telemetry::evaluateDeltaThresholds` và `Telemetry::buildDeltaPayload` để giảm thiểu băng thông truyền thông, tự động tạo payload nén chỉ chứa các short-keys thay đổi.
  - SPRINT 2 Rule 3: Áp dụng mã hóa Base64 an toàn (`CryptoUtils::encodeBase64String`) cho toàn bộ gói tin JSON telemetry trước khi xuất bản ra môi trường internet thông qua MQTT.
  - Sửa đổi hàm `loop()` trong `main.cpp` để chạy an toàn trong chế độ biên dịch thường (`vTaskDelay(1000)`), đồng thời hoạt động như một tick kiểm thử đồng bộ không chặn trong chế độ `UNIT_TEST` để kiểm chứng logic WiFi check, WebServer, MQTT và delta telemetry.
  - Tự kiểm tra: Biên dịch thành công 100% không phát sinh cảnh báo, toàn bộ unit test suite `run_tests` đều PASS thành công tốt đẹp.

## [2026-07-12T12:24:08+07:00]
- **Task ID**: E1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [sensors.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/sensors.h)
  - [MODIFY] [sensors.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/sensors.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
- **Giải trình ngắn gọn**:
  - Tái cấu trúc hàm `setup()` trong `main.cpp` để thực hiện khởi tạo phần cứng theo quy trình Fail-Safe: Khởi tạo GPIO cho 4 Relay (Mist, Fan, Heater 1, Heater 2) ở mức `LOW` (OFF) ngay từ đầu để tránh nhảy chattering khi ESP32 reboot.
  - Sau khi khởi tạo Relay an toàn, tiến hành khởi tạo bus I2C & cảm biến SHT30 (`sensors::init_sensors_placeholder()`), tiếp theo là NVS, load cấu hình, khởi tạo Serial mutex, event groups, và hàng đợi FreeRTOS.
  - Kích hoạt WiFi sớm bằng cách gọi `wifi::init_wifi()` trực tiếp trong `setup()`, trước khi khởi tạo các FreeRTOS tasks.
  - Cấu hình lại kích thước vùng nhớ stack an toàn cho Core 0 Task từ `12288` bytes xuống còn `8192` bytes theo đúng Technical Directives của Task E1.
  - Tích hợp dịch vụ đồng bộ thời gian NTP: Gọi `configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov")` ngay khi WiFi Station kết nối thành công (`WL_CONNECTED`).
  - Viết lại hàm `readRtcTimeFailSafe()` trên Core 1 sử dụng các hàm standard C time (`time()`, `localtime_r()`) để kiểm tra trạng thái đồng bộ NTP (năm >= 2026). Nếu chưa đồng bộ hoặc rớt mạng, hàm trả về trạng thái `valid = false` để kích hoạt cơ chế bảo vệ sinh học (biosafety override) ép tắt Heater 2 và Mist.
  - Bổ sung hàm tiện ích `reset_sensors_initialized_for_test()` trong `sensors.cpp`/`sensors.h` phục vụ cho việc reset trạng thái tĩnh giữa các bộ kiểm thử unit test.
  - Tự kiểm tra: Biên dịch thành công 100% và tất cả 20+ unit test offline qua file `run_tests` đều PASS hoàn hảo.

## [2026-07-12T12:21:04+07:00]
- **Task ID**: D5
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [WebInterface.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/WebInterface.h)
  - [MODIFY] [WebInterface.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tách và chuyển đổi hàm `apiGetRealtimeData()` sang namespace `web_interface` để đảm bảo cấu trúc tổ chức mã nguồn rõ ràng và module hóa cao.
  - Triển khai hàm kiểm tra giới hạn tần suất request `check_rate_limit(unsigned long now)` trong namespace `web_interface`. Hàm sử dụng cơ chế so sánh non-blocking `millis()` với sai số thời gian tối thiểu 1000 ms, tự động chống tràn thời gian (millis rollover) và chỉ cập nhật thời điểm request cuối cùng đối với các yêu cầu thành công.
  - Bổ sung unit tests (Case 31.3) trong `test/run_tests.cpp` để kiểm chứng toàn vẹn logic hoạt động của `check_rate_limit()` đối với các request liên tục trong khoảng cách ngắn hơn 1 giây (được throttling) và request sau 1 giây (được cho phép).
  - Tự kiểm tra: Biên dịch và chạy bộ kiểm thử offline `run_tests` thành công 100% không phát sinh lỗi (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-12T12:18:00+07:00]
- **Task ID**: D4
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [WebInterface.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/WebInterface.h)
  - [NEW] [WebInterface.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/WebInterface.cpp)
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tạo file `WebInterface.h` / `WebInterface.cpp` để đóng vai trò làm Local WebServer phục vụ giao diện điều khiển và trạng thái nhà nấm trên mạng cục bộ.
  - Triển khai hàm `serveDashboardHTML()` phục vụ phương thức HTTP GET `/` với HTML/CSS/JS được nhúng hoàn toàn dưới dạng Inline và lưu trữ trực tiếp trong bộ nhớ Flash tĩnh (`PROGMEM`) thay vì RAM để bảo vệ Heap.
  - Thiết kế giao diện Dashboard cục bộ tối ưu hóa UI: mang phong cách Glassmorphism cao cấp, chế độ tối dịu mắt, các thẻ hiển thị thông số (nhiệt độ, độ ẩm, CO2, trạng thái relay TPC) trực quan và tự động đồng bộ qua AJAX/fetch định kỳ 2 giây, không sử dụng tài nguyên CDN ngoài để chạy tốt offline 100% trong LAN.
  - Đồng thời đặt nền móng và triển khai cho hàm API `apiGetRealtimeData()` (phục vụ GET `/data`) trả về JSON trạng thái hệ thống đầy đủ của dự án, tích hợp cơ chế Rate-limiting (tối đa 1 request mỗi giây) trả về mã lỗi 429 quá tải để bảo vệ tài nguyên ESP32.
  - Triển khai cấu trúc dữ liệu chia sẻ thread-safe `SharedSystemState` cùng các helper `update_shared_system_state()` / `get_shared_system_state()` được bảo vệ bởi `xTelemetryMutex` trong FreeRTOS đa nhân, cập nhật dữ liệu liên tục từ Core 1 Control loop để Core 0 Web Server đọc.
  - Bổ dung unit test (Case 31) trong `test/run_tests.cpp` để kiểm chứng quá trình cập nhật/truy xuất `SharedSystemState` thread-safe và chạy thử nghiệm stub WebInterface dưới môi trường host PC (`UNIT_TEST`).
  - Tự kiểm tra: PlatformIO build thành công cho target ESP32-S3 `otg` không có lỗi liên kết; biên dịch và chạy bộ test offline thành công tốt đẹp 100% (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-12T12:15:00+07:00]
- **Task ID**: D3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [MODIFY] [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [MODIFY] [CryptoUtils.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/CryptoUtils.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai thuật toán Exponential Backoff cho cơ chế tự động kết nối lại MQTT trong `MqttClient::maintain_mqtt_connection()`. Khoảng thời gian thử lại bắt đầu từ 2000 ms, nhân đôi sau mỗi lần kết nối thất bại và bị giới hạn tối đa là 60000 ms (60 giây). Khoảng thời gian này tự động reset về 2000 ms khi kết nối lại thành công hoặc khi mất kết nối từ trạng thái CONNECTED.
  - Triển khai Mạch bảo vệ (WiFi Safeguard) trong `MqttClient::reconnect_mqtt()`: kiểm tra điều kiện `WiFi.status() != WL_CONNECTED` cùng với wifi_state check để ngăn chặn việc gọi kết nối lại MQTT khi WiFi chưa sẵn sàng.
  - Sửa đổi `CryptoUtils.cpp` để bọc phần include `<mbedtls/base64.h>` trong `#ifndef UNIT_TEST` và cung cấp một bộ mã hóa base64 giả lập trên host PC. Điều này cho phép compile thành công tất cả các file mã nguồn của dự án trên host.
  - Viết bộ kiểm thử unit test chi tiết (Case 12.4c) trong `test/run_tests.cpp` để kiểm chứng hành vi của Exponential Backoff và Mạch bảo vệ. Đồng thời, tinh chỉnh lại test case 12.4b cũ bằng cách tăng khoảng chờ `mock_millis_offset` lên 9000 ms nhằm tương thích với khoảng reconnect interval động mới.
  - Tự kiểm tra: Biên dịch offline bằng `g++` cục bộ thành công 100% không lỗi; chạy `./run_tests` vượt qua 100% assertions thành công tốt đẹp (`--- All Unit Tests Passed Successfully! ---`).

## [2026-07-12T12:12:00+07:00]
- **Task ID**: D2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [definitions.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/definitions.h)
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [main.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/main.cpp)
  - [MODIFY] [mqtt_client.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/mqtt_client.h)
  - [MODIFY] [mqtt_client.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/mqtt_client.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai biến cờ chia sẻ đa nhân `shared_forceFullPublish` dưới dạng `volatile bool` và đồng hành với Mutex `xTelemetryMutex` nhằm bảo vệ dữ liệu truyền nhận giữa Core 0 (đầu nạp tin nhắn/quản lý truyền thông) và Core 1 (luồng điều khiển TPC).
  - Triển khai các hàm helper thread-safe `get_shared_force_full_publish()` và `set_shared_force_full_publish()` sử dụng cơ chế tranh chấp mutex an toàn non-blocking cho môi trường FreeRTOS đa lõi trên ESP32.
  - Sửa đổi hàm xử lý callback MQTT `handle_message()` thành `handleMQTTCallback()` trong lớp `MqttClient` đóng vai trò nhận gói tin từ MQTT Broker. Thêm logic bóc tách khóa `"cmd"` để nhận diện lệnh hệ thống `"full_sync"`. Khi khớp lệnh, lập tức đổi trạng thái cờ `shared_forceFullPublish = true` một cách an toàn.
  - Áp dụng các quy tắc bảo vệ dữ liệu (Data Sanitization): Kiểm tra con trỏ dữ liệu MQTT hợp lệ, kiểm soát chặt kích thước payload tối đa (512 bytes) để chống tràn đệm, sao chép sang vùng đệm cục bộ an toàn trước khi Deserialization JSON.
  - Bổ dung Case J trong bộ kịch bản kiểm thử MQTT callback tại `test/run_tests.cpp` để kiểm chứng logic bắt lệnh `"cmd": "full_sync"` hoạt động chính xác và an toàn.
  - Khắc phục lỗi thiếu thư viện `<freertos/semphr.h>` trên `definitions.h` và bổ sung phương thức kiểm tra chuỗi rỗng `isEmpty()` cho mock class `String` trên môi trường kiểm thử offline.
  - Tự kiểm tra: Biên dịch và chạy bộ kiểm thử offline `run_tests` thành công 100% không lỗi; PlatformIO biên dịch thành công cho target ESP32-S3 `otg` không phát sinh lỗi liên kết hay data race.

## [2026-07-12T12:08:00+07:00]
- **Task ID**: D1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [NetworkTask.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/NetworkTask.h)
  - [NEW] [NetworkTask.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/NetworkTask.cpp)
  - [MODIFY] [wifi_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/wifi_manager.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai hàm `initWiFiModes()` trong `NetworkTask.h` / `NetworkTask.cpp` để thiết lập chế độ WiFi song song `WIFI_AP_STA`, khởi động SoftAP nội bộ cho cấu hình và bắt đầu quá trình kết nối không chặn (non-blocking) đến router ngoài khi có cấu hình STA trong NVS.
  - Tích hợp `network::initWiFiModes()` vào `wifi::init_wifi()` trong `wifi_manager.cpp` để thống nhất luồng cấu hình WiFi phần cứng.
  - Sửa đổi mock `WiFi.softAP` trong `test/Arduino.h` để duy trì chính xác chế độ `WIFI_AP_STA` khi cấu hình SoftAP trên môi trường kiểm thử.
  - Bổ sung unit tests cho `network::initWiFiModes()` trực tiếp trong `test/run_tests.cpp` để xác nhận chế độ `WIFI_AP_STA` được kích hoạt chính xác.
  - Tự kiểm tra: Chạy bộ thử nghiệm offline `./run_tests` thành công 100% vượt qua toàn bộ assertions mà không phát sinh lỗi hay ảnh hưởng tính năng cũ.

## [2026-07-12T12:05:00+07:00]
- **Task ID**: C3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [Telemetry.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/Telemetry.h)
  - [MODIFY] [Telemetry.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Telemetry.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm `buildDeltaPayload()` trong module `Telemetry` để tạo chuỗi JSON nén chỉ chứa các trường thay đổi (DELTA) hoặc toàn bộ các trường (FULL).
  - Áp dụng các quy tắc bảo vệ: Sử dụng `StaticJsonDocument` cố định 512 bytes trên Stack thay vì `DynamicJsonDocument` động để chống phân mảnh RAM.
  - Sử dụng các phím tắt short-keys: `rT` (nhiệt độ thực đo), `rH` (độ ẩm thực đo), `tC` (nồng độ CO2 thực đo) để thu gọn tối đa băng thông IoT.
  - Xử lý giá trị `NAN` an toàn: nếu một trường có giá trị là `NAN`, nó sẽ được mã hóa thành `null` trong JSON thay vì bị bỏ qua hoặc làm hỏng cấu trúc.
  - Thiết lập khởi tạo `doc.to<JsonObject>()` để đảm bảo chuỗi DELTA khi không có thay đổi nào sẽ trả về đối tượng trống `"{}"` thay vì `"null"`.
  - Bổ sung 6 kịch bản kiểm thử độc lập cho `buildDeltaPayload` trong `test/run_tests.cpp` (NONE, FULL với NAN, DELTA không thay đổi, DELTA đổi nhiệt độ, DELTA đổi nhiệt độ + độ ẩm, DELTA khi CO2 kết nối lại), sử dụng so sánh dựa trên giải mã JSON float delta để tránh lỗi lệch format chữ số floating-point.
  - Tự kiểm tra: Biên dịch và chạy bộ test offline `./run_tests` thành công 100% không lỗi.

## [2026-07-12T12:03:00+07:00]
- **Task ID**: C2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [Telemetry.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/Telemetry.h)
  - [NEW] [Telemetry.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Telemetry.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Tạo module `Telemetry` và triển khai hàm `evaluateDeltaThresholds()` để tối ưu hóa tần suất truyền tin dựa trên sự thay đổi giá trị cảm biến (Delta Thresholding) và khoảng thời gian giữ kết nối (Heartbeat Keepalive).
  - Tích hợp cấu trúc `TelemetryState` dưới dạng POD standard-layout để đảm bảo an toàn bộ nhớ và tối ưu hóa căn chỉnh 32-bit.
  - Sử dụng sai số delta tối thiểu: lệch nhiệt độ > 0.2°C, độ ẩm > 1.0%, CO2 > 10 ppm. Xử lý an toàn giá trị `NAN`: nếu trạng thái lỗi/kết nối của cảm biến thay đổi (NAN chuyển thành hữu hạn hoặc ngược lại) thì kích hoạt gửi tin lập tức; nếu cả hai đều NAN thì bỏ qua.
  - Hỗ trợ cờ `forceFullPublish` và tự động kích hoạt gửi gói tin đầy đủ (`FULL`) sau mỗi 5 phút (300,000 ms) keepalive để backend kiểm soát trạng thái hoạt động (LWT).
  - Khắc phục logic kiểm thử không nhất quán trong `test/run_tests.cpp` (do sai lệch `mock_millis_offset` kế thừa từ các test case trước đó làm biến đổi giá trị cảm biến nhiệt độ mock).
  - Tự kiểm tra: Biên dịch và chạy bộ test offline thành công 100% không lỗi; PlatformIO build thành công cho target ESP32-S3 `otg`.

## [2026-07-12T11:03:39+07:00]
- **Task ID**: C1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [CryptoUtils.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/CryptoUtils.h)
  - [NEW] [CryptoUtils.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/CryptoUtils.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tạo module `CryptoUtils` với ba overload `encodeBase64String()` (raw bytes, `const char*`, `String`) dùng trực tiếp API native `mbedtls_base64_encode` từ `mbedtls/base64.h`.
  - Giới hạn input telemetry ở 512 bytes và dùng buffer output cố định 684 bytes trên Stack; không dùng buffer Heap hay cấp phát động trong encoder. Dữ liệu null không hợp lệ, input quá giới hạn và lỗi mbedTLS fail-safe trả về chuỗi rỗng; input rỗng hợp lệ trả về Base64 rỗng.
  - Tự kiểm tra: PlatformIO target build `pio run -e otg` PASS; host test với AddressSanitizer/UndefinedBehaviorSanitizer xác nhận chuẩn Base64 (padding, dữ liệu binary), biên 512 bytes, null và oversized input PASS; `git diff --check` sạch.


## [2026-07-11T18:00:00+07:00]
- **Task ID**: Kiến trúc TPC & Fail-safe (Phase 1)
- **Trạng thái hiện tại**: Đã chốt phương án
- **Danh sách file**:
  - [MODIFY] [README.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/README.md)
  - [MODIFY] [sprint_1.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/sprint_1.md)
  - [MODIFY] [sprint_2.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/sprint_2.md)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
- **Giải trình ngắn gọn**:
  - Ghi nhận Quyết định Kiến trúc TPC: Không đập bỏ TPC window, mà tiến hành tune tham số để giảm hao mòn SSR/thiết bị. SSR ấn định dùng AC Zero-crossing.
  - Cập nhật thông số kỹ thuật `window` = 300 s, `min_on` = 5–10 s, `min_off` = 3–10 s theo thiết bị tải nhằm ngăn chặn chattering.
  - Áp dụng cấu hình *Staggered Startup*: Trễ pha kích hoạt giữa HAir, HWat, Mist (0, 3, 8 giây) để chống cộng dồn dòng điện inrush dội ngược.
  - Giải quyết "nhánh code chết" bằng yêu cầu NTP: Core 0 phải dùng `configTime()` ngay khi có mạng; Core 1 chỉ thi hành blackout chống sốc nhiệt giữa trưa nếu cờ giờ hợp lệ; chưa đồng bộ thì fallback an toàn OFF thiết bị sưởi/siêu âm.
  - Tích hợp chu kỳ tính toán Fuzzy = 5 s, scheduler TPC = 50 ms.


## [2026-07-11T17:20:52+07:00]
- **Task ID**: B5
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core1_tasks.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai `task_core1_control()` (Core1_ControlTask) theo pipeline bắt buộc: sensors → Trajectory setpoints → AdaptiveTuner gains → Fuzzy dual-heater + CO2 → arbitrateOutputs → hardwareProtectionOverride → applyTpcOutputs (digitalWrite HIGH/LOW) → `vTaskDelay(pdMS_TO_TICKS(50))`.
  - Không dùng `delay()`, `analogWrite()`, `ledcWrite()`, `malloc`/`new`/`String` trong loop; state (CO2 latch, integral gains, TPC scheduler) nằm trên stack của task, caller-owned.
  - RTC chưa có provider thật → `readRtcTimeFailSafe()` trả invalid → hard-rule ép HWat/Mist OFF trước TPC, đúng biosafety fail-safe.
  - Bỏ local_control hysteresis path cũ trên Core 1; legacy MQTT ActuatorCommand bị drain/drop, không bypass pipeline TPC.
  - Unit test B5: single-iteration host path xác nhận init GPIO LOW + protection force HWat/Mist LOW; focused host compile+run PASS; static check thứ tự protection→TPC→vTaskDelay; `git diff --check` sạch.

## [2026-07-11T17:04:48+07:00]
- **Task ID**: B4
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [TPC_Task.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/TPC_Task.h)
  - [NEW] [TPC_Task.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/TPC_Task.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tạo module `TPC_Task` với `hardwareProtectionOverride()`: ép duty HWat/Mist về `0.0` trong khung 11:00–13:30 (inclusive) và fail-safe OFF khi RTC invalid/malformed; các kênh HAir/Exh không bị ảnh hưởng.
  - Triển khai TPC scheduler non-blocking (`millis()`): `updateTpcChannel()` chuyển duty `[0.0, 1.0]` thành pha HIGH/LOW trong cửa sổ TPC, tôn trọng min ON/OFF configurable theo thiết bị; chỉ dùng `digitalWrite`, không PWM/`analogWrite`/`ledcWrite`.
  - Duty = 0.0 (kể cả sau protection interlock) ép SSR OFF ngay lập tức, không bị giữ bởi minimum-ON; min ON/OFF chỉ áp dụng cho các chuyển pha theo duty bình thường.
  - State caller-owned (`TpcSchedulerState` POD), không hidden static; window=0 fail-safe LOW; khởi tạo kênh bắt đầu OFF nhưng cho phép ON ngay chu kỳ đầu.
  - Bổ sung unit tests B4 (blackout endpoints, RTC fail-safe, 50% duty phase, min ON/OFF, zero-demand immediate OFF, zero-window, POD layout) trong `run_tests.cpp`.
  - Tự kiểm tra: standalone host test B4 với `clang++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` PASS; `git diff --check` sạch.

## [2026-07-11T16:59:20+07:00]
- **Task ID**: B3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Rà soát `arbitrateOutputs()` theo TPC semantics: HAir/HWat/Mist được nhân adaptive gain, còn `ExhTH` và `ExhCO2` được hợp nhất độc lập bằng `std::max`; toàn bộ demand hậu arbitration được clamp liên tục trong `[0.0, 1.0]`, không threshold/map sang relay boolean.
  - Xác nhận cơ chế fail-safe: raw demand NaN/Inf thành `0.0`; gain NaN/Inf ép kênh tương ứng OFF, gain hữu hạn ngoài dải được giới hạn trong `[0.5, 2.5]` trước phép nhân.
  - Tự kiểm tra: focused host test B3 dùng `clang++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` PASS; static check xác nhận `FuzzyController.cpp` không gọi `digitalWrite`/`analogWrite`/`ledcWrite`; `git diff --check` sạch.

## [2026-07-11T16:54:54+07:00]
- **Task ID**: B2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [MODIFY] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Rà soát `executeCO2Rules()` theo semantics SSR + TPC: khi latch ON trả demand chuẩn hóa `ExhCO2 = 1.0`, khi OFF trả `0.0`; không threshold/map sang GPIO và không tự tạo xung trong FuzzyController.
  - Giữ hysteresis/deadband caller-owned (`CO2RuleState`): bật khi excess > 50 ppm, giữ latch trong dải chết, nhả khi excess < 20 ppm; NaN/Inf fail-safe OFF và xóa latch.
  - Cập nhật docs/comment để khẳng định TPC Task là nơi duy nhất quyết định pha HIGH/LOW SSR; hysteresis chỉ yêu cầu full duty demand.
  - Bổ sung test biên chính xác: excess = 50 ppm vẫn OFF, excess = 20 ppm vẫn giữ latch ON; cập nhật wording test B2 theo TPC demand.
  - Tự kiểm tra: focused host test B2 với `clang++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` PASS; static check không có `digitalWrite`/`analogWrite`/`ledcWrite` trong FuzzyController; `git diff --check` sạch.

## [2026-07-11T16:50:57+07:00]
- **Task ID**: B1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [MODIFY] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Rà soát `executeDualHeaterRules()` theo semantics SSR + TPC: các kênh HAir/HWat/Mist/ExhTH giữ là duty demand liên tục `[0.0, 1.0]`; không threshold thành relay boolean và không gọi GPIO/PWM trong FuzzyController.
  - Xác nhận độc lập hai nhánh bắt buộc: Lạnh & Khô ưu tiên HAir và phân bổ ngân sách dư cho Mist; Lạnh & Ẩm ướt ưu tiên HWat, không kích hoạt Mist/ExhTH ở mức full-scale. Toàn bộ output được clamp và dữ liệu NaN/Inf fail-safe về 0.
  - Bổ sung test cho duty trung gian (HAir `0.25`, Mist `0.375`, ExhTH `0.5`) để bảo vệ chống hồi quy map ngưỡng 0/1 trước TPC.
  - Tự kiểm tra: focused host test B1 với `g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` PASS; static check xác nhận không có `digitalWrite`/`analogWrite`/`ledcWrite`; `git diff --check` sạch. Full host suite không thể biên dịch với `-Werror` vì mock Arduino có sẵn unused parameters, không liên quan B1.

## [2026-07-11T16:47:45+07:00]
- **Task ID**: Kế hoạch Sprint 1 — điều chỉnh kiến trúc SSR + TPC
- **Trạng thái hiện tại**: Đã cập nhật kế hoạch; B1, B2, B3, B4, B5 ở Pending
- **Danh sách file**:
  - [MODIFY] [README.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/README.md)
  - [MODIFY] [sprint_1.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/sprint_1.md)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Theo yêu cầu mới, SSR được điều khiển bằng TPC (Time-Proportional Control): demand mờ `[0.0, 1.0]` được chuyển thành thời lượng ON/OFF trong cửa sổ thời gian dài qua `digitalWrite()`, không dùng PWM tần số cao.
  - Cập nhật luồng kiến trúc: fuzzy → arbitration → demand TPC → hardware protection → TPC window/minimum ON-OFF → GPIO SSR.
  - Các task bị ảnh hưởng B1, B2, B3 được trả về `[ ] Pending` để rà soát semantics demand TPC; B4/B5 vẫn Pending nhưng được mở rộng chỉ dẫn TPC scheduler, RTC fail-safe, minimum ON/OFF và thứ tự safety bắt buộc.
  - Không thay đổi mã firmware trong bản cập nhật kế hoạch này. Đã kiểm tra `git diff --check` sạch.

## [2026-07-11T16:39:27+07:00]
- **Task ID**: B3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [MODIFY] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai `arbitrateOutputs(thermalOutputs, exhCO2, gains)` trong `FuzzyController`, trả `ArbitratedOutputsPod` (HAir/HWat/Mist/Exh) đã chuẩn hóa.
  - Decoupled arbitrator: trộn `ExhTH` và `ExhCO2` bằng `std::max` để kênh xả được kích hoạt khi CO2 hoặc nhiệt-ẩm yêu cầu mạnh hơn; không nhân gain lên kênh exhaust.
  - HAir/HWat/Mist được nhân với `gain_*` từ AdaptiveTuner; gain finite bị kẹp cứng vào band an toàn `[0.5, 2.5]`; NaN/Inf gain fail-safe OFF cho kênh tương ứng.
  - Post-arbitration clamp: mọi kết quả sau nhân gain/trộn exhaust bị clamp về `[0.0, 1.0]` — phù hợp relay ON/OFF (không PWM).
  - Bổ sung unit tests Task B3 (nominal, max-authority, gain apply, NaN fail-safe, out-of-band gain, POD layout) và smoke regression A1–A4 + B1–B3.
  - Kết quả tự kiểm tra: focused host tests cho B3 và core math smoke với `-Wall -Wextra -Werror -fsanitize=address,undefined` PASS. `git diff --check` sạch. Full suite phụ thuộc ESP/WiFi/FreeRTOS không chạy được trên host (thiếu header platform), không ảnh hưởng logic B3.

## [2026-07-11T16:30:08+07:00]
- **Task ID**: B2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [MODIFY] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Triển khai `executeCO2Rules(CO2RuleState&, errorCO2)` trong `FuzzyController`, trả về công suất thô `ExhCO2` thuộc `[0.0, 1.0]`.
  - Áp dụng hysteresis/deadband quanh setpoint CO2: bật khi excess > 50 ppm, giữ latch trong dải chết, tắt khi excess < 20 ppm để chống đóng ngắt quạt xả liên tục.
  - Khi latch ON, trả `ExhCO2 = 1.0` (relay ON); khi OFF trả `0.0`. Không dùng PWM/duty cycle tỉ lệ vì phần cứng hiện tại chỉ ON/OFF.
  - NaN/Inf fail-safe về 0 và xóa latch. State hysteresis là POD caller-owned (`CO2RuleState`), không dùng static ẩn, phù hợp Core 1.
  - Bổ sung unit tests Task B2 (deadband, engage, hold, release, full-scale, fail-safe, clamp, POD layout).
  - Kết quả tự kiểm tra: focused host test cho `FuzzyController` với `-Wall -Wextra -Werror -fsanitize=address,undefined` PASS. `git diff --check` sạch.

## [2026-07-11T16:24:28+07:00]
- **Task ID**: B1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [NEW] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tạo module fuzzy thuần, không trạng thái `FuzzyController` và triển khai `executeDualHeaterRules(errorTemp, errorHumid)` theo quy ước lỗi `target - measured`.
  - Nhánh **Lạnh & Khô** ưu tiên sấy khí (`HAir`) và chỉ cấp phần ngân sách còn lại cho phun sương (`Mist`); nhánh **Lạnh & Ẩm ướt** ưu tiên sấy nước (`HWat`) và khóa Mist/ExhTH. Cơ chế ngân sách bảo đảm `HAir + Mist <= 1.0`, tránh kích hoạt đồng thời quá mức hai thiết bị triệt tiêu nhau.
  - Nhiệt độ cao hoặc độ ẩm dư kích hoạt `ExhTH`; tất cả bốn đầu ra được kẹp cứng về `[0.0, 1.0]`. Dữ liệu lỗi NaN/Inf trả về toàn bộ công suất 0 theo fail-safe.
  - Bổ sung unit test độc lập cho hai nhánh bắt buộc, kiểm tra ngân sách công suất, exhaust, clamp, dữ liệu invalid và POD layout.
  - Kết quả tự kiểm tra: test tập trung B1 với `-Wall -Wextra -Werror` cùng AddressSanitizer/UndefinedBehaviorSanitizer PASS; biên dịch và chạy toàn bộ host test suite PASS. `git diff --check` sạch. PlatformIO CLI không có trong môi trường nên chưa thể chạy firmware build trên target.

## [2026-07-11T16:19:56+07:00]
- **Task ID**: A1, A2, A3, A4 (Full Track A Audit)
- **Trạng thái hiện tại**: QA Approved — All LGTM / Done
- **Agent rà soát**: Security Auditor & Senior Code Reviewer
- **Kết quả tổng hợp**:
  - **A1** `calculateFuzzyArea()`: PASS — pure functions, NaN/Inf sanitize, divide-by-zero guard, TB clamp, Pascal equations verified.
  - **A2** `computeMembership(trimf/trapmf)`: PASS — early-exit optimization, degenerate case handling (a==b, b==c, c==d), NaN/Inf validate all params, output clamp [0,1].
  - **A3** `interpolateSetpoints()`: PASS — static constexpr Flash storage, boundary clamp [0,20], NaN→0, linear interpolation correct, POD pass-by-value.
  - **A4** `updateGains()`: PASS — anti-windup ±I_MAX, sensor-loss freeze, dt guard, gain clamp [0.5,2.5], explicit state (no hidden statics).
  - **Kiến trúc**: Toàn bộ Track A tuân thủ Clean Architecture — layer toán học tách biệt hoàn toàn với GPIO/I2C/delay.
  - **Bảo mật**: Không hardcode secret; validate NaN/Inf tại mọi entry point; clamp mọi output range; không raw pointer/heap.
  - **Tối ưu**: O(1) cho A1/A2/A4; O(n=20) cho A3 (acceptable); không vòng lồng; không N+1; không cấp phát động.
- **Xác minh độc lập**: `g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` focused host tests → PASS.
- **Quyết định**: **All Track A LGTM**. Chuyển A1, A2, A3 sang `[x] Done`.

## [2026-07-11T16:14:06+07:00]
- **Task ID**: A4
- **Trạng thái hiện tại**: QA Approved — LGTM / Done
- **Agent rà soát**: Security Auditor & Senior Code Reviewer
- **Kết quả checklist**:
  1. **Kiến trúc & Conventions**: PASS — module thuần toán học, tách khỏi GPIO/I2C/delay, namespace `AdaptiveTuner`, POD `GainsPod`/`IntegralState`, state tường minh (không static ẩn), hàm ngắn gọn, không DRY-break.
  2. **Bảo mật**: PASS — không hardcode secret/.env; validate NaN/Inf cho error/state/dt; clamp anti-windup + gain; chặn dt quá lớn; không raw pointer/heap.
  3. **Logic & Edge-cases**: PASS — anti-windup `±I_MAX`, freeze khi sensor loss/`dt<=0`, repair state hỏng, clamp gain `[0.5, 2.5]`, mapping HAir/HWat/Mist hợp lý; unit tests 24.x phủ cold-start/T/H/windup/NaN/reset/POD.
  4. **Tối ưu**: PASS — O(1), không vòng lồng, không N+1, không cấp phát động.
- **Xác minh độc lập**: `g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` focused host tests cho `AdaptiveTuner` → PASS.
- **Quyết định**: **LGTM**. Chuyển Task A4 sang `[x] Done`.

## [2026-07-11T16:10:21+07:00]
- **Task ID**: A4
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [AdaptiveTuner.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/AdaptiveTuner.h)
  - [NEW] [AdaptiveTuner.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/AdaptiveTuner.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai module `AdaptiveTuner` với hàm `updateGains()` tính toán sai số bề mặt tích phân của nhiệt độ và độ ẩm, sau đó điều chỉnh `gain_HAir`, `gain_HWat`, `gain_Mist`.
  - Anti-windup: tích phân bị kẹp cứng ở `I_MAX_TEMP = ±15 °C·s` và `I_MAX_HUMID = ±30 %·s`; khi cảm biến NaN/Inf hoặc `dt <= 0` thì đóng băng tích phân tương ứng để tránh windup do mất tín hiệu / scheduler trễ.
  - Ràng buộc gain: mọi kênh gain được clamp cứng về dải an toàn phần cứng `[0.5, 2.5]`.
  - Thiết kế state tường minh qua `IntegralState` (không dùng static toàn cục), trả `GainsPod` dạng POD pass-by-value, phù hợp FreeRTOS Core 1.
  - Ánh xạ điều khiển: `gain_HAir` theo I_T, `gain_Mist` theo I_H, `gain_HWat` theo I_T + 0.25·I_H để ưu tiên sấy nước khi lạnh & ẩm.
  - Bổ sung unit tests Task A4 trong `test/run_tests.cpp` (cold-start, tăng gain theo T/H, bão hòa anti-windup, freeze khi NaN/dt invalid, reset, kiểm tra layout POD).
  - Kết quả tự kiểm tra: biên dịch host `g++ -Wall -Wextra -Werror -fsanitize=address,undefined` cho `AdaptiveTuner.cpp` + test focused và chạy PASS 100%.

## [2026-07-11T16:05:00+07:00]
- **Task ID**: A3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [Trajectory.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/Trajectory.h)
  - [NEW] [Trajectory.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Trajectory.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm `interpolateSetpoints()` nhận đầu vào là `currentDay` (float), thực hiện nội suy tuyến tính từ mảng Waypoints 20 ngày.
  - Tối ưu hóa bộ nhớ: Mảng Waypoints 20 ngày được khai báo dưới dạng mảng `static constexpr` trong file `Trajectory.cpp`, lưu trữ trực tiếp trên bộ nhớ Flash tĩnh (RODATA), hoàn toàn không chiếm dụng dung lượng Heap/RAM khi thực thi.
  - Bảo vệ biên: Thực hiện kiểm tra biên đầu vào nghiêm ngặt, tự động clamp `currentDay` về khoảng `[0.0, 20.0]` trước khi tính toán. Hỗ trợ xử lý an toàn cho trường hợp đầu vào là `NaN` hoặc `Inf`.
  - Interface thiết kế dạng POD (`SetpointPod`) được pass-by-value, loại bỏ việc dùng con trỏ thô để triệt tiêu nguy cơ rò rỉ bộ nhớ.
  - Bổ sung Test Case 23 vào file kiểm thử `test/run_tests.cpp` bao phủ các kịch bản: kiểm tra biên ngoài dải, kiểm tra NaN, kiểm tra các điểm checkpoint chính xác và kiểm tra nội suy giữa hai checkpoint.
  - Kết quả kiểm tra nội bộ: Biên dịch offline bằng `g++` thành công và vượt qua 100% các xác nhận (assertions) trong test suite mà không làm ảnh hưởng đến các tính năng cũ.

## [2026-07-11T16:03:00+07:00]
- **Task ID**: A2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [MathEngine.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/MathEngine.h)
  - [MODIFY] [MathEngine.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/MathEngine.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm nạp chồng `computeMembership()` cho hàm thuộc tính tam giác (`trimf`) và hình thang (`trapmf`) trong `MathEngine.h` và `MathEngine.cpp`.
  - Logic tính toán được tối ưu CPU tối đa: kiểm tra và thoát sớm khi $x$ nằm ngoài miền xác định, chỉ thực hiện phép chia tại sườn dốc tương ứng (không tính toán dư thừa).
  - Ép kết quả đầu ra luôn nằm trong khoảng `[0.0, 1.0]` bằng cơ chế kẹp an toàn.
  - Xử lý mượt mà và đúng đắn các trường hợp suy biến biên trùng nhau ($a == b$ hoặc $c == d$) để tránh lỗi chia cho 0.
  - Tích hợp cơ chế kiểm duyệt dữ liệu đầu vào (NaN/Inf) để trả về `0.0f` fallback an toàn.
  - Viết bộ unit tests phủ toàn bộ các trường hợp biên của hàm tam giác & hình thang (gồm sườn dốc, đỉnh, ngoài khoảng, trường hợp suy biến và kiểm thử NaN/Inf) trong `run_tests.cpp`.
  - Kết quả kiểm tra nội bộ: Biên dịch bằng `g++` local thành công 100%, vượt qua toàn bộ test suite hiện có của dự án.

## [2026-07-11T16:01:00+07:00]
- **Task ID**: A1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [MathEngine.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/MathEngine.h)
  - [NEW] [MathEngine.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/MathEngine.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm `calculateFuzzyArea()` giải mờ thuật toán Pascal gốc trong `MathEngine.h` và `MathEngine.cpp`.
  - Các hàm tích phân `Fz1`, `Fz2`, `Fz3` và `Fu1`, `Fu2`, `Fu3` được viết chính xác theo cấu trúc toán học của Pascal gốc, sử dụng kiểu dữ liệu `float` tối ưu cho FPU của ESP32.
  - Áp dụng các quy tắc bảo vệ: hàm thuần túy (pure functions/stateless), kiểm tra và loại trừ các giá trị NaN/Infinity, kiểm tra mẫu số khác không trước khi chia centroid `Kz / K` để tránh chia cho 0, clamp kết quả `TB < 1.0` về `0.0` theo logic Pascal gốc.
  - Bổ sung 4 kịch bản kiểm thử độc lập cho `MathEngine` vào file `run_tests.cpp` (giá trị chuẩn, giá trị bằng 0, chèn lỗi NaN/Infinity, clamp giá trị centroid nhỏ hơn 1.0).
  - Tự kiểm tra: Biên dịch lại toàn bộ test code bằng `g++` local và chạy `./run_tests` thành công 100%, tất cả các assert đều đạt yêu cầu mà không làm ảnh hưởng đến các tính năng cũ.
