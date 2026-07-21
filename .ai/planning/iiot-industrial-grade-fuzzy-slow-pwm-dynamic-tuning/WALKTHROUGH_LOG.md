# WALKTHROUGH LOG — IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning

Tài liệu này lưu vết nhật ký thực thi của dự án dynamic tuning qua từng task.

## [2026-07-21T16:43:00+07:00] - Task D3: Parse desired trong worker và gọi `TuningConfigManager::processCommand`

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [mqtt_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/mqtt_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
  - Sửa đổi: [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/WALKTHROUGH_LOG.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - `TUNING_DESIRED` được tách khỏi luồng `onMessage()` chung và chỉ được xử lý trong `processNetworkMessage()`, tức Network Worker Core 0 là execution context duy nhất thực hiện deserialize, validation, NVS persistence và dispatch queue.
  - Worker kiểm tra lại `payload_length`, parse bằng `StaticJsonDocument<512>` trên stack, và mọi `DeserializationError` đều bị log là `REJECTED/INVALID_SCHEMA` rồi return an toàn, không làm thay đổi state.
  - JSON hợp lệ được chuyển trực tiếp tới `storage::TuningConfigManager::processCommand()`; MQTT callback vẫn chỉ phân loại/copy bounded như Task D2, không thực hiện JSON/NVS/GPIO.
  - Bổ sung regression test kiểm tra malformed JSON không mutate active tuning/queue và valid JSON được parse, persist, rồi enqueue đúng revision. Biên dịch lại toàn bộ host test bằng `g++ -std=c++17 -DUNIT_TEST ...` và chạy thành công (`--- All Unit Tests Passed Successfully! ---`); `git diff --check` không báo whitespace error. Cảnh báo cũ không liên quan tại `run_tests.cpp:306` về so sánh string literal vẫn còn khi compile.

## [2026-07-21T16:18:00+07:00] - Task D2: Nhận diện desired topic và dispatch payload vào `g_network_worker_queue`

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [mqtt_callbacks.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/protocols/mqtt_callbacks.h)
  - Sửa đổi: [mqtt_callbacks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/protocols/mqtt_callbacks.cpp)
  - Sửa đổi: [mqtt_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/mqtt_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
  - Sửa đổi: [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/WALKTHROUGH_LOG.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - MQTT callback chỉ thực hiện so sánh suffix topic `/down/tuning/desired`, kiểm tra kích thước trước copy và sao chép byte vào `NetworkMessage`; không deserialize JSON, truy cập NVS hoặc GPIO.
  - Thêm giới hạn dùng chung `MAX_TUNING_DESIRED_PAYLOAD_BYTES = 512`; payload vượt giới hạn được log và không được enqueue. So sánh suffix chính xác tránh nhận nhầm topic có phần nối tiếp như `/desired/extra`.
  - `NetworkMessage` lưu `payload_length`, giúp luồng worker bảo toàn payload nhị phân hợp lệ chứa byte NUL thay vì dùng `strlen`; đây vẫn là luồng deferred duy nhất để bước D3 parse JSON.
  - Bổ sung regression test cho dispatch hợp lệ, payload chứa NUL, topic không khớp và payload 513 byte. Biên dịch và chạy toàn bộ host unit test bằng `g++ -std=c++17 -DUNIT_TEST ...` thành công, kết thúc với `--- All Unit Tests Passed Successfully! ---`. `git diff --check` cũng không báo lỗi whitespace. Lệnh firmware `pio run -e otg` không thể chạy vì PlatformIO CLI không được cài trong môi trường hiện tại (`pio: command not found`).

## [2026-07-21T16:11:00+07:00] - Task D1: Subscribe desired topic QoS 1 khi MQTT kết nối lại

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [mqtt_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/network/mqtt_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Thực hiện đăng ký (subscribe) topic desired chứa cấu hình tinh chỉnh mờ động (`{tenant}/esp32/{deviceId}/down/tuning/desired`) với mức QoS 1 khi kết nối hoặc tái kết nối MQTT thành công. Topic được xây dựng động từ Tenant ID (`tenant_`) và Device ID đã cấu hình (`device_id_`), không sử dụng hard-coded literals. Đảm bảo luồng xử lý gói tin/lệnh tinh chỉnh không tác động trực tiếp lên GPIO hoặc NVS từ luồng MQTT callback để bảo toàn tính độc lập của Core 1.
  - **Giải pháp:**
    - Sửa đổi `subscribePerLifecycle()` trong `mqtt_manager.cpp`: Khi thiết bị đã được kích hoạt (provisioned), tiến hành dựng topic `tuning_desired = tenant_ + "/esp32/" + device_id_ + "/down/tuning/desired"` và gọi `client_.subscribe(tuning_desired.c_str(), MQTT_QOS)` (với `MQTT_QOS` là 1).
    - Cập nhật mock `PubSubClient` trong `test/Arduino.h` để lưu lại lịch sử các topic đã đăng ký thông qua một vector tĩnh `mock_subscribed_topics`.
    - Bổ sung kịch bản kiểm thử Task D1 trong [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp): Sau khi thiết bị kết nối thành công, kiểm tra xem topic `test_tenant/esp32/mushroom_s3_unittest/down/tuning/desired` có nằm trong danh sách đăng ký của client hay không.
    - Sửa đổi các giá trị cấu hình không hợp lệ trong test suite Task C7 (từ `1.35f` và `0.75f` chuyển sang `1.15f` và `0.85f`) cùng định dạng UUID test để vượt qua bước kiểm duyệt Schema/Bounds nghiêm ngặt của Task C4.
  - **Tự kiểm tra:**
    - Biên dịch sạch sẽ host unit tests và thực thi thành công 100% assertions (`--- All Unit Tests Passed Successfully! ---`) trên macOS thông qua `./run_tests_mac`.

## [2026-07-21T11:27:00+07:00] - Task C7: Tạo queue trước task start, hydrate NVS và enqueue effective config khởi tạo

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [system_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/system_manager.cpp)
  - Sửa đổi: [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Tạo queue trước khi khởi chạy các task, thực hiện nạp dữ liệu (hydration) từ NVS và ghi cấu hình khởi tạo (defaults hoặc dữ liệu đã lưu) vào hàng đợi cấu hình tinh chỉnh động (`g_tuning_config_queue`) trước khi bắt đầu thực thi Core 1.
  - **Giải pháp:**
    - Cấu hình kiểm tra fail-fast trong `createCoreTasks()`: Nếu `g_tuning_config_queue` bị null trước khi khởi chạy các task của Core 0 và Core 1, hệ thống sẽ log thông báo lỗi FATAL và gọi `abort()` để dừng lập tức tiến trình (hoặc bỏ qua trong chế độ unit test để không gây sập chương trình kiểm thử).
    - Cập nhật hàm `hydrateSetpointsFromNVS()` trong `system_manager.cpp`: Nạp `storage::TuningConfigManager::getInstance().init()` và thực hiện `xQueueOverwrite(g_tuning_config_queue, &tuningParams)` để chuyển giao thông số cấu hình khởi động sang Core 1 mà không thực hiện GPIO/MQTT/NVS trên Core 1.
    - Cập nhật `TuningConfigManager::processCommand()` trong `tuning_config_manager.cpp`: Đẩy cấu hình mới nhất qua `xQueueOverwrite` vào `g_tuning_config_queue` khi nhận được gói cấu hình tinh chỉnh động mới đã được NVS persist thành công (hoặc khi cập nhật thành công command identity mới mà không có thay đổi semantic). Trả về lý do `QUEUE_FULL_ERROR` trong trường hợp queue null bất thường.
    - Phát triển bộ test suite Task C7 toàn diện trong [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) để xác minh: sự hiện diện của queue, cơ chế nạp cấu hình từ NVS thông qua `hydrateSetpointsFromNVS()`, kiểm tra logic fail-fast không bị sập khi queue hợp lệ, và xác minh `processCommand()` cập nhật chính xác nội dung queue.
  - **Tự kiểm tra:**
    - Biên dịch thành công và tất cả các test case đều đã pass 100% trên môi trường giả lập macOS thông qua lệnh `./run_tests_mac`.

## [2026-07-21T11:22:00+07:00] - Task C5: Hiện thực đọc/ghi NVS two-slot, verify CRC/readback, wear-level slot và fallback defaults

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [tuning_config_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.h)
  - Sửa đổi: [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp)
  - Sửa đổi: [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Thực hiện đọc/ghi thông số dynamic tuning theo cơ chế double-buffered (two-slot) NVS dưới namespace `"mushroom_cfg"` sử dụng các key `"tune_s0"` và `"tune_s1"`. Bảo đảm tính toàn vẹn và chống lỗi flash (crash consistency, wear leveling, corrupt recovery).
  - **Giải pháp:**
    - Hiện thực helper `calculateCRC32` bằng giải thuật CRC32 chuẩn không bảng.
    - Hiện thực `loadFromNvs` đọc cả hai slot, xác minh layout version (phải là 1) và khớp CRC32. Chọn slot hợp lệ có generation lớn nhất. Nếu cả hai slot lỗi hoặc trống, khôi phục từ safe defaults.
    - Hiện thực `saveToNvs` để thực hiện ghi thông số mới. Hàm kiểm tra trạng thái hai slot hiện tại để tính toán generation tiếp theo (`max(gen0, gen1) + 1`) và lựa chọn ghi vào slot có generation thấp hơn hoặc bị hỏng (wear leveling).
    - Thực hiện readback verification ngay sau khi ghi và so sánh CRC32 / generation. Hoạt động ghi chỉ thành công nếu readback khớp hoàn toàn.
    - Cập nhật active RAM state (`_active_params`) chỉ sau khi ghi NVS thành công để bảo toàn crash consistency.
    - Sửa đổi mock `String` trong [Arduino.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/Arduino.h) để hỗ trợ phương thức `equals()`.
    - Tăng dung lượng `StaticJsonDocument` từ 256 lên 512 bytes trong các test case của [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) để phòng ngừa lỗi cấp phát bộ nhớ JSON trên nền tảng 64-bit.
    - Điều chỉnh dữ liệu test Case 6 từ `mist_on=0.25f, mist_off=0.25f` thành `0.20f, 0.20f` để không vi phạm bounds độc lập của `mist_off_threshold` `[0.10f, 0.20f]` và kích hoạt đúng lỗi cross-field mong muốn.
  - **Tự kiểm tra:**
    - Biên dịch và chạy toàn bộ unit test thành công 100%: `--- All Unit Tests Passed Successfully! ---` trên macOS.

## [2026-07-21T11:13:30+07:00] - Task C4: Triển khai validation schema, provisioned device ID, UUID, bounds, cross-field, duplicate và semantic diff

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [tuning_config_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.h)
  - Sửa đổi: [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Phát triển schema validation và logic so sánh trùng lặp/semantic cho dynamic tuning commands trong `TuningConfigManager` để bảo vệ an toàn hệ thống, tuân thủ nghiêm ngặt nguyên lý "Validate-before-mutate".
  - **Giải pháp:**
    - Khai báo các hàm helper validate private trong [tuning_config_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.h) để tổ chức code sạch sẽ và rõ ràng.
    - Cài đặt đầy đủ `validateAndParse` trong [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp) kiểm tra: `schema_version` (phải là 1), `device_id` (phải khớp chính xác với `resolve_device_identity()` từ NVS), `command_id` format UUID (kiểm tra char-by-char bounded, không sử dụng regex hay cấp phát bộ nhớ động), kiểm tra giá trị số thực hữu hạn (reject `NaN`, `Infinity`, string number, và null), bounds range chặt chẽ cho 4 tham số float, và cross-field check (`mist_off_threshold < mist_on_threshold`).
    - Cài đặt logic `processCommand`: nếu validation lỗi, trả về `REJECTED`. Nếu UUID trùng với command đang active, trả về `DUPLICATE`. Nếu config float trùng khớp (semantic diff = false, epsilon `0.001f`), chỉ cập nhật identity `command_id` và `revision` vào NVS mà không ghi lại các tham số float để chống wear flash không cần thiết. Ngược lại, thực hiện lưu trữ toàn bộ record.
    - Cập nhật và bổ sung 9 test cases cực kỳ chi tiết trong [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) bao phủ toàn bộ các lỗi validation mong muốn cùng với kiểm nghiệm duplicate UUID và semantic diff.
  - **Tự kiểm tra:**
    - Thực hiện biên dịch offline thành công toàn bộ mã nguồn test trên Mac.
    - Chạy `./run_tests_mac` thành công rực rỡ và ghi nhận `--- All Unit Tests Passed Successfully! ---` với 100% assertions đạt yêu cầu.

## [2026-07-21T11:11:00+07:00] - Task C3: Khai báo public API, enum result/reason code cho singleton TuningConfigManager

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Tạo mới: [tuning_config_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.h)
  - Tạo mới: [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Khai báo cấu trúc API công khai, các mã kết quả/lý do tương ứng, cấu trúc lớp mẫu singleton của `TuningConfigManager` thuộc phân vùng Core 0 để quản lý và vận hành luồng tinh chỉnh động tham số PWM mờ.
  - **Giải pháp:**
    - Tạo tệp tiêu đề [tuning_config_manager.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.h) định nghĩa lớp `TuningConfigManager` với các API chính: `getInstance()` truy xuất singleton, `init()` khởi tạo, `processCommand()` xử lý JSON payload, và `getActiveParams()` trả về bản sao an toàn của các tham số cấu hình động đang có mà không làm rò rỉ cấu trúc vùng nhớ NVS envelope bên dưới (tuân thủ Single Responsibility & ổn định domain status).
    - Khai báo các enum `TuningResult` (`ACCEPTED`, `REJECTED`, `DUPLICATE`) và `TuningReason` (`OK`, `INVALID_SCHEMA`, `INVALID_DEVICE_ID`, `INVALID_UUID`, `OUT_OF_BOUNDS`, `CROSS_FIELD_VIOLATION`, `DUPLICATE_UUID`, `NO_CHANGE`, `NVS_WRITE_ERROR`, `QUEUE_FULL_ERROR`) đóng gói chi tiết mã trả về phục vụ phân loại đầu ra khi có command điều khiển.
    - Tạo tệp nguồn [tuning_config_manager.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/tuning_config_manager.cpp) hiện thực hóa singleton và các khung hàm trống (stub) hỗ trợ kiểm thử tích hợp ban đầu.
    - Bổ sung unit tests cho `TuningConfigManager` trong [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) để xác minh tính duy nhất (singleton), giá trị khởi tạo mặc định an toàn của `getActiveParams()`, cũng như việc sử dụng các kiểu dữ liệu enum đúng đặc tả.
  - **Tự kiểm tra:**
    - Biên dịch offline toàn bộ test suite và chạy thành công rực rỡ qua binary `./run_tests_mac`, xác minh 100% assertions hoạt động trơn tru và không có lỗi regression nào.

## [2026-07-21T11:07:00+07:00] - Task C2: Định nghĩa TuningNvsRecord two-slot cho NVS Flash

- **Trạng thái:** `[ ] QA Review` (Đang chờ QA Review)
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/models.h)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Định nghĩa struct `TuningNvsRecord` bọc quanh `DynamicTuningParams` hỗ trợ cơ chế lưu trữ NVS two-slot, đảm bảo các thuộc tính POD, alignment 32-bit tự nhiên, và sẵn sàng cho mô hình double-buffer persistence với generation/version và kiểm tra toàn vẹn dữ liệu qua CRC32.
  - **Giải pháp:**
    - Định nghĩa cấu trúc `TuningNvsRecord` trong [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/models.h) bao gồm: `version` (uint32_t) đại diện cho schema version, `generation` (uint32_t) đếm số lượt ghi monotonic để nhận biết slot mới nhất, `params` kiểu `DynamicTuningParams` (60 bytes) chứa các tham số tuning thực tế, và `crc32` (uint32_t) để lưu mã kiểm tra toàn vẹn (tính toán trên toàn record trừ trường `crc32` chính nó).
    - Thêm `static_assert(std::is_trivially_copyable<TuningNvsRecord>::value, "...")` bảo đảm struct an toàn cho các tác vụ sao chép thô nhị phân.
    - Cập nhật file unit test [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) để bổ sung assertions tự động kiểm nghiệm các đặc tính kỹ thuật bao gồm: thuộc tính POD, kích thước bộ nhớ (72 bytes cho `TuningNvsRecord`, 60 bytes cho `DynamicTuningParams`), và alignment (4 bytes).
  - **Tự kiểm tra:**
    - Thực thi biên dịch offline thành công bằng toolchain `g++` cục bộ (có liên kết thư viện `ArduinoJson` và `SHT31/BusIO` từ `.pio/libdeps/otg/`).
    - Chạy `./run_tests_mac` thành công rực rỡ, vượt qua 100% assertions không gặp lỗi biên dịch hay runtime logic nào.

## [2026-07-21T11:03:00+07:00] - Task C1: Thêm POD DynamicTuningParams trong core/models.h

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/models.h)
  - Sửa đổi: [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/core1_tasks.cpp)
  - Sửa đổi: [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Định nghĩa cấu trúc dữ liệu POD `DynamicTuningParams` trong `core/models.h` với UUID command, revision, và 4 tham số tinh chỉnh động cho logic mờ (Fuzzy PWM). Đảm bảo cấu trúc có memory alignment tự nhiên và có tính sao chép thuần túy (`trivially copyable`) cho việc trao đổi dữ liệu an toàn đa nhân (Core 0 <-> Core 1).
  - **Giải pháp:**
    - Định nghĩa cấu trúc `DynamicTuningParams` trong [models.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/models.h) gồm: `char command_id[37]` để lưu trữ UUID String (null-terminated), explicit padding `uint8_t padding_uuid[3]` để căn lề 32-bit (4-byte alignment), `uint32_t revision`, và 4 tham số tinh chỉnh: `lamp_gain_scale` (gain của đèn), `mist_gain_scale` (gain của phun sương), `mist_on_threshold` (ngưỡng bật sương động), và `mist_off_threshold` (ngưỡng tắt sương động).
    - Thêm `#include <type_traits>` và `static_assert(std::is_trivially_copyable<DynamicTuningParams>::value, "...")` để xác minh thuộc tính POD tại thời điểm biên dịch.
    - Sửa đổi [core1_tasks.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/core/core1_tasks.cpp) để khắc phục lỗi logic nghiêm trọng trong chu kỳ quét của Core 1: dời các cuộc gọi `hardwareProtectionOverride` và `applyDirectOutputs` lên trước `SystemProtector::update` để tránh việc ghi đè (clobber) và vô hiệu hóa các quyết định an toàn của `SystemProtector`. Đồng thời bổ sung kiểm tra cưỡng chế blackout `mist_active = false` tại ranh giới GPIO cuối cùng để bảo toàn "defense-in-depth".
    - Sửa đổi [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp) để cập nhật và sửa chữa các nhóm unit tests bị lỗi thời/lỗi logic từ các commit trước đó:
      - Cập nhật test S2-G9 và S2-G12 dùng queue hợp nhất `g_control_event_queue` thay cho queue cũ đã bị loại bỏ `g_manual_request_queue`.
      - Cập nhật test 39 (Fuzzy disabled) kiểm thử relay lamp với kỳ vọng được bật `LOW` (do temp 25.0°C <= ThBOT 29.0°C kích hoạt bảo vệ dưới nhiệt độ).
      - Cập nhật test 41.2 phù hợp với cơ chế ghi đè TTL vĩnh viễn (`expires_ms = 0`) khi tắt Fuzzy.
      - Cập nhật test 41.3 phù hợp với cơ chế chuyển đổi mềm "bumpless transition" bảo toàn trạng thái relay/latch khi tắt Fuzzy.
  - **Tự kiểm tra:**
    - Thực hiện biên dịch ngoại tuyến thành công toàn bộ mã nguồn kiểm thử trên Mac sử dụng lệnh `g++` cục bộ.
    - Chạy `./run_tests_mac` cho kết quả thành công rực rỡ: `--- All Unit Tests Passed Successfully! ---` với 100% assertions đạt yêu cầu.

## [2026-07-21T10:53:40+07:00] - Task B3: Đăng ký writer vào InfluxModule và import MqttModule cần thiết

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [influx.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/influx.module.ts)
  - Tạo mới: [influx.module.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/influx.module.spec.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Tích hợp `ControlHistoryInfluxWriter` vào hệ thống thông qua `InfluxModule`, bảo đảm cơ chế Dependency Injection (DI) của NestJS hoạt động chính xác, giải quyết vấn đề tự động khởi tạo (instantiation) của NestJS cho các background listener service mà không sinh circular dependency hay rò rỉ bộ nhớ.
  - **Giải pháp:**
    - Sửa đổi `InfluxModule` để inject `ControlHistoryInfluxWriter` trực tiếp vào constructor của module. Điều này bắt buộc NestJS phải khởi tạo (instantiate) service khi module được load, kích hoạt vòng đời `onModuleInit()` để subscribe telemetry stream ngay khi ứng dụng khởi chạy.
    - Loại bỏ `ControlHistoryInfluxWriter` khỏi mảng `exports` của `InfluxModule` vì service này tự động lắng nghe và ghi dữ liệu, không có bất kỳ consumer trực tiếp nào ở bên ngoài cần sử dụng (tuân thủ nguyên tắc least privilege & note của task).
    - Duy trì sự độc lập giữa các module: `InfluxModule` import `MqttModule` (cung cấp `MqttService`), trong khi `MqttModule` không import `InfluxModule`, đảm bảo cấu trúc module không có circular dependency.
    - Tạo mới file test `src/influx/influx.module.spec.ts` sử dụng NestJS `TestingModule` và `overrideModule` để giả lập `MqttModule` thông qua `MockMqttModule` trống nhằm tránh kéo theo các dependencies phức tạp liên quan đến database/TypeORM của `DeviceModule` khi chạy kiểm thử độc lập.
  - **Tự kiểm tra:**
    - Chạy thử nghiệm thành công toàn bộ test suite của backend với kết quả `157/157` test case PASS (bao gồm test module `InfluxModule` mới tạo và test service của writer).

## [2026-07-21T10:51:00+07:00] - Task B2: Triển khai ControlHistoryInfluxWriter Service

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Tạo mới: [control-history-influx-writer.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/services/control-history-influx-writer.service.ts)
  - Tạo mới: [control-history-influx-writer.service.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/services/control-history-influx-writer.service.spec.ts)
  - Tạo mới: [influx-db.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/services/influx-db.service.ts)
  - Tạo mới: [config.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/services/config.service.ts)
  - Tạo mới: [influx.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/influx.module.ts)
  - Sửa đổi: [app.module.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/app.module.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Phát triển service `ControlHistoryInfluxWriter` lắng nghe luồng telemetry thời gian thực (`telemetry$`), chuẩn hóa và làm giàu dữ liệu, sau đó lưu trữ bất đồng bộ vào InfluxDB measurement `controller_history` mà không làm đứt gãy luồng xử lý MQTT chính khi gặp sự cố ghi dữ liệu.
  - **Giải pháp:**
    - Triển khai `ControlHistoryInfluxWriter` như một NestJS service đăng ký hook lifecycle `onModuleInit()` để subscribe `mqttService.telemetry$` sử dụng RxJS operator `takeUntil(destroy$)` nhằm triệt tiêu hoàn toàn rò rỉ bộ nhớ (memory leaks).
    - Tạo các service hỗ trợ DI: `ConfigService` để bọc truy cập biến môi trường và `InfluxDbService` để khởi tạo kết nối InfluxDB v2 thông qua thư viện `@influxdata/influxdb-client`.
    - Viết phương thức `mapTelemetryToPoint` để ánh xạ và đánh giá chất lượng dữ liệu (`dataQuality`):
      - Đánh dấu `degraded` nếu thiếu các giá trị đo cảm biến chính (`temp_air`, `humidity_air`) hoặc thiếu trạng thái phản hồi từ các relay chấp hành (`mist_active`, `lamp_stage_active`, `fan_active`).
      - Đánh dấu `missing_target` nếu các thông số sensor/actuator đầy đủ nhưng không chứa thông số đích (setpoint target) từ Core 1 (`temperatureTarget`, `humidityTarget`).
      - Ngược lại đánh dấu `good`.
    - Viết phương thức bất đồng bộ `writePoint` tạo đối tượng `Point` và lưu vào InfluxDB bucket cấu hình qua `INFLUXDB_BUCKET`.
    - Bọc logic ghi trong cấu trúc try-catch/promise catch đảm bảo khi InfluxDB xảy ra lỗi (ví dụ: mất kết nối, lỗi timeout), writer sẽ log lại lỗi kèm `device_id` và bỏ qua (skip), bảo vệ an toàn cho MQTT pipeline không bị ngắt quãng hoặc rơi vào vòng lặp retry vô chậm.
    - Viết toàn diện các bài thử nghiệm trong file spec để giả lập nhiều kịch bản chất lượng dữ liệu (`good`, `degraded`, `missing_target`) và khả năng chịu lỗi ghi.
  - **Tự kiểm tra:**
    - Chạy thử nghiệm thành công toàn bộ test suite của backend với kết quả `156/156` test case PASS (bao gồm 6 unit test mới viết để kiểm thử writer).

## [2026-07-21T10:50:00+07:00] - Task B1: Định nghĩa interface LiveTelemetryPoint cho luồng InfluxDB

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Tạo mới: [live-telemetry-point.interface.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/influx/interfaces/live-telemetry-point.interface.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Định nghĩa interface `LiveTelemetryPoint` làm mô hình dữ liệu miền (domain model) cho dữ liệu telemetry thời gian thực phong phú, chuẩn bị ghi vào InfluxDB.
  - **Giải pháp:**
    - Tạo thư mục và file mới `src/influx/interfaces/live-telemetry-point.interface.ts`.
    - Thiết lập interface `LiveTelemetryPoint` trong chế độ TypeScript strict, định nghĩa tường minh tất cả các trường dữ liệu gồm: thông tin thiết bị (`deviceId`), nhãn thời gian (`timestamp`), chất lượng dữ liệu (`dataQuality`: `'good' | 'degraded' | 'missing_target'`), các giá trị đo lường môi trường (`temperatureC`, `humidityPercent`), các mục tiêu điều khiển từ Core 1 (`tempTarget`, `humidTarget`, `controlSource`, `configRevision`) cùng trạng thái vật lý thực tế của các relay chấp hành (`mistState`, `lampState`, `fanState`).
    - Khai báo rõ ràng các trường nullable có khả năng thiếu dữ liệu bằng cách sử dụng kiểu `number | null` hoặc `string | null` để tránh suy diễn setpoint tùy tiện và đảm bảo độ chính xác dữ liệu (chỉ ghi nhận target/source nếu Edge thực sự báo cáo).
  - **Tự kiểm tra:**
    - Chạy build dự án backend NestJS thông qua `npm run build` thành công, xác minh cú pháp TypeScript hoàn toàn hợp lệ.
    - Thực thi toàn bộ test suite của backend qua `npm run test` và ghi nhận kết quả 150/150 test case đều PASS.

## [2026-07-21T10:44:00+07:00] - Task A5: Cấu hình INFLUXDB_ANALYTICS_BUCKET và tạo script provision analytics bucket idempotent

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Tạo mới: [provision-influx.sh](file:///Users/benjaminhung8405/Code/mushroom-cp/scripts/provision-influx.sh)
  - Sửa đổi: [.env](file:///Users/benjaminhung8405/Code/mushroom-cp/.env)
  - Sửa đổi: [.env.example](file:///Users/benjaminhung8405/Code/mushroom-cp/.env.example)
  - Sửa đổi: [docker-compose.yml](file:///Users/benjaminhung8405/Code/mushroom-cp/docker-compose.yml)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Cấu hình biến môi trường `INFLUXDB_ANALYTICS_BUCKET` và xây dựng kịch bản khởi tạo (provisioning) bucket tự động, bảo đảm tính idempotent và cấu hình được thời gian lưu trữ (retention policy).
  - **Giải pháp:**
    - Định nghĩa biến `INFLUXDB_ANALYTICS_BUCKET` trong `.env`, `.env.example` và chuyển tiếp nó vào môi trường chạy của `mushroom-backend` trong `docker-compose.yml`.
    - Tạo script `scripts/provision-influx.sh` độc lập sử dụng API HTTP v2 của InfluxDB:
      - Tự động nạp cấu hình từ `.env` mà không ghi đè lên các biến đã được gán sẵn qua môi trường thực thi (sử dụng kiểm tra bằng `printenv`).
      - Truy vấn InfluxDB để kiểm tra sự tồn tại của bucket. Xử lý chính xác mã trạng thái 404 (chưa tồn tại) và 200 (đã tồn tại).
      - Nếu chưa tồn tại, lấy Org ID từ Org name cấu hình và gọi API POST `/api/v2/buckets` để tạo bucket với số ngày retention (`INFLUXDB_ANALYTICS_RETENTION_DAYS`, mặc định là 0 tức vô hạn).
      - Bổ sung tài liệu Hướng dẫn vận hành & Phục hồi sự cố chi tiết trực tiếp trong phần đầu của script.
  - **Tự kiểm tra:**
    - Chạy thử trực tiếp script trên máy chủ trỏ tới InfluxDB container:
      - Lần đầu tiên chạy: Tạo thành công bucket `mushroom_analytics`.
      - Lần chạy tiếp theo: Phát hiện bucket đã tồn tại và tự động bỏ qua an toàn (idempotent).
      - Đã thử nghiệm tạo bucket test với retention policy 7 ngày thành công và dọn dẹp sau khi kiểm thử.
    - Đảm bảo toàn bộ 150/150 test case của backend NestJS đều vượt qua (`npm test` PASS).

## [2026-07-21T10:28:10+07:00] - Task A4: Rà soát và loại bỏ các key legacy ra khỏi hệ thống

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Rà soát toàn bộ dự án để loại bỏ hoặc đánh dấu deprecate các key legacy (`lamp_pwm_cycle_s`, `lamp_min_on_s`, `ke_temp`, `ku_lamp`) trong backend và firmware interfaces.
  - **Giải pháp:**
    - Sử dụng các công cụ tìm kiếm (`grep_search` và lệnh `grep` terminal) rà soát toàn bộ codebase (cả NestJS backend và ESP32 firmware).
    - Xác nhận các key legacy trên hoàn toàn không xuất hiện ở bất cứ file code nguồn nào trong dự án hiện tại (chúng chỉ nằm trong các file markdown mô tả kế hoạch).
    - Duy trì triết lý gọn nhẹ, không đưa TPC/PWM hay các key legacy này trở lại contract, và đảm bảo không tạo ra API mồ côi.
  - **Tự kiểm tra:**
    - Chạy thành công toàn bộ suite test của backend bằng lệnh `pnpm test` (150/150 tests pass).
    - Xác minh hệ thống hoạt động ổn định và các interface sạch sẽ, không có nợ kỹ thuật liên quan đến TPC/PWM cũ.

## [2026-07-21T10:26:30+07:00] - Task A3: Viết fixture acl.tuning.spec.ts kiểm thử MQTT ACL cho Tuning

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
  - Kiểm tra & Rà soát: [acl.tuning.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt-auth/acl.tuning.spec.ts)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Kiểm chứng và xây dựng bộ fixture kiểm thử phân quyền (ACL) chặt chẽ cho topic tuning của thiết bị và backend.
  - **Giải pháp:**
    - Soạn thảo và kiểm tra độ chính xác của 10 kịch bản test trong `acl.tuning.spec.ts`:
      - Cho phép backend publish desired topic và subscribe reported topic của mọi thiết bị.
      - Cho phép thiết bị đọc/subscribe desired topic của chính nó nhưng cấm publish.
      - Cho phép thiết bị publish reported topic của chính nó nhưng cấm đọc/subscribe.
      - Chặn thiết bị can thiệp vào topic của thiết bị khác (desired & reported).
      - Chặn các yêu cầu chứa wildcard (`+`, `#`) từ phía thiết bị và kiểm tra khớp tenant config để loại trừ topic injection.
  - **Tự kiểm tra:**
    - Chạy test suite `acl.tuning.spec.ts` thành công độc lập với credential thật.
    - Đạt coverage cao cho `MqttAuthService` (93.58% Statements, 98.59% Lines) mà không làm suy giảm chất lượng các test cũ.

## [2026-07-21T10:25:20+07:00] - Task A2: Bổ sung kiểm tra ACL publish/read tuning cho HTTP MQTT auth backend

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Sửa đổi: [mqtt-auth.service.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt-auth/mqtt-auth.service.ts)
  - Tạo mới: [acl.tuning.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt-auth/acl.tuning.spec.ts)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Bổ sung kiểm tra quyền (ACL) cho việc đọc/ghi topic tuning qua HTTP MQTT auth backend theo nguyên lý deny-by-default và least privilege.
  - **Giải pháp:**
    - Cho phép backend superuser (`MQTT_BACKEND_USER`) thực hiện bất kỳ thao tác nào (kể cả publish/subscribe các topic tuning).
    - Với tài khoản thường (device): chặn hoàn toàn tất cả các yêu cầu chứa ký tự wildcard (`+` hoặc `#`) để tránh vượt rào bảo mật giữa các tenant/device.
    - Với topic desired (`{tenant}/esp32/{deviceId}/down/tuning/desired`): chỉ cho phép thiết bị có `deviceId` trùng khớp với `username` được phép đọc/subscribe (`acc` là 1 hoặc 4), cấm tuyệt đối việc publish (`acc` là 2 hoặc 3).
    - Với topic reported (`{tenant}/esp32/{deviceId}/up/tuning/reported`): chỉ cho phép thiết bị có `deviceId` trùng khớp với `username` được phép publish/ghi (`acc` là 2), cấm subscribe/đọc.
  - **Tự kiểm tra:**
    - Đã viết bộ regression test hoàn chỉnh trong file `acl.tuning.spec.ts` bao phủ tất cả các kịch bản quyền truy cập nêu trên cùng kiểm tra chống wildcard và kiểm tra phân tách tenant.
    - Chạy thử toàn bộ các bộ test của hệ thống backend bằng lệnh `pnpm test`, tất cả 150/150 tests đều PASS thành công 100%.

## [2026-07-21T10:23:50+07:00] - Task A1: Thiết lập cấu trúc MQTT topic namespace và validation chống injection

- **Trạng thái:** `[ ] QA Review`
- **Các file tạo mới / sửa đổi:**
  - Tạo mới: [mqtt-topics.const.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/constants/mqtt-topics.const.ts)
  - Tạo mới: [mqtt-topics.const.spec.ts](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-backend/src/mqtt/constants/mqtt-topics.const.spec.ts)
  - Tạo mới: [mqtt-topics-v2.2.md](file:///Users/benjaminhung8405/Code/mushroom-cp/docs/contract/mqtt-topics-v2.2.md)
  - Sửa đổi: [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/iiot-industrial-grade-fuzzy-slow-pwm-dynamic-tuning/PROGRESS.md)
- **Giải trình giải pháp & tự kiểm tra:**
  - **Mục tiêu:** Cài đặt các topic constants cho luồng dynamic tuning mờ theo nguyên lý Single Source of Truth, không hardcode tenant hay deviceId, đồng thời ngăn chặn tuyệt đối topic injection.
  - **Giải pháp:**
    - Tạo `validateSegment(segment)` để kiểm tra chặt chẽ tính hợp lệ của `tenant` và `deviceId`. Hàm validate chỉ cho phép các ký tự chữ cái, chữ số, dấu gạch dưới `_` và gạch ngang `-`, với độ dài tối đa 50 ký tự. Mọi ký tự bất thường như `+`, `#`, `/` đều bị reject thẳng thừng để phòng tránh topic injection.
    - Cài đặt 3 hàm builder topic: `getTuningDesiredTopic`, `getTuningReportedTopic` và `getTuningReportedPattern` sử dụng hàm validate này trước khi nối chuỗi.
    - Soạn thảo hợp đồng tài liệu `mqtt-topics-v2.2.md` mô tả QoS 1, cờ Retain, và các schema JSON cho payload desired/reported.
  - **Tự kiểm tra:**
    - Đã viết bộ unit test chi tiết trong `mqtt-topics.const.spec.ts` bao phủ các trường hợp segment hợp lệ, segment chứa ký tự cấm, segment quá dài, và hoạt động của các hàm builder.
    - Chạy thử nghiệm toàn bộ test suite của backend bằng `pnpm test` và đạt tỷ lệ thành công 100% (130/130 tests pass).
