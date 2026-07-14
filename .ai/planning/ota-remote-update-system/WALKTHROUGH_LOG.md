# Nhật Ký Thực Thi (Walkthrough Log) — OTA Remote Update System

> Ghi chú: Các bản ghi được sắp xếp theo thứ tự thời gian đảo ngược (mới nhất ở trên đầu).

---

## 2026-07-14T13:09:48+07:00 — Task A2

- **Task ID:** A2
- **Mô tả:** Khai báo `extern TaskHandle_t hTaskCore1Control` và `extern TaskHandle_t hTaskHWButton` trong `mushroom-iot-firmware/include/definitions.h`.
- **Trạng thái hiện tại:** `[ ] QA Review` — Đang chờ QA Review.
- **Files đã sửa đổi:**
  - `mushroom-iot-firmware/include/definitions.h` (thêm 2 dòng khai báo `extern` bên trong block `#ifndef UNIT_TEST` hiện có).
- **Files đã tạo mới:**
  - Không có.
- **Giải pháp logic đã viết:**
  - Chèn đúng 2 dòng `extern TaskHandle_t hTaskCore1Control;` và `extern TaskHandle_t hTaskHWButton;` ngay sau `extern SemaphoreHandle_t xTelemetryMutex;` — nằm bên trong block `#ifndef UNIT_TEST ... #endif` đã sẵn có ở khoảng dòng 34-38, đảm bảo tuân thủ chỉ thị Kỹ sư trưởng: (1) chỉ khai báo trong `definitions.h`, (2) bọc trong `#ifndef UNIT_TEST`, (3) không include trực tiếp `<freertos/task.h>` ở phạm vi toàn cục (type `TaskHandle_t` đã có sẵn qua include `<freertos/task.h>` nội bộ trong cùng block `#ifndef UNIT_TEST` ở đầu file).
  - Không sinh definition, không sửa vị trí include, không đụng vào các khai báo/hàm khác — patch tối thiểu tuyệt đối để không tạo nợ kỹ thuật.
- **Kết quả tự kiểm tra mã nguồn:**
  - `grep -rn "extern TaskHandle_t hTaskCore1Control" mushroom-iot-firmware` xác nhận duy nhất một khai báo tại `include/definitions.h:36`; tương tự `hTaskHWButton` tại dòng 37 — không có xung đột đa khai báo.
  - Biên dịch host-side unit test bằng lệnh chuẩn của repo (`g++ -std=c++17 -DUNIT_TEST -Iinclude -Itest -I.pio/libdeps/otg/ArduinoJson/src ...`) với đầy đủ source files → build thành công, chỉ tồn tại 1 warning `-Wformat-security` pre-existing tại `test/Arduino.h:61` (không liên quan Task A2). Điều này chứng minh khối `#ifndef UNIT_TEST` hoạt động đúng: khai báo `TaskHandle_t` extern KHÔNG bị lộ ra native build và không đòi hỏi định nghĩa symbol khi link.
  - Chạy `./run_tests` cho kết quả assertion fail pre-existing tại `run_tests.cpp:270` (`storage.load_hardware_override`) — đã được xác nhận là lỗi tồn tại từ trước bằng cách `git stash` toàn bộ thay đổi Task A2 và rebuild/rerun cho cùng lỗi. Task A2 KHÔNG gây hồi quy.
  - `git diff mushroom-iot-firmware/include/definitions.h` xác nhận diff chỉ gồm đúng 2 dòng added, không có thay đổi ngẫu nhiên nào khác (whitespace, formatting, encoding). Không có file binary/artefact được commit kèm.

---

## 2026-07-14T13:01:32+07:00 — Task A1

- **Task ID:** A1
- **Mô tả:** Bổ sung MQTT buffer flag `-DMQTT_MAX_PACKET_SIZE=2048` vào `[env:base]` của `platformio.ini`.
- **Trạng thái hiện tại:** `[ ] QA Review` — Đang chờ QA Review.
- **Files đã sửa đổi:**
  - `mushroom-iot-firmware/platformio.ini` (thêm 1 dòng build flag trong section `[env:base]`).
- **Files đã tạo mới:**
  - `.ai/planning/ota-remote-update-system/WALKTHROUGH_LOG.md` (nhật ký thực thi, khởi tạo lần đầu).
- **Giải pháp logic đã viết:**
  - Thêm đúng một dòng `-D MQTT_MAX_PACKET_SIZE=2048 ; Buffer nhận gói tin OTA payload lớn từ MQTT Broker` vào cuối khối `build_flags` trong `[env:base]`, ngay sau `-D MQTT_SOCKET_TIMEOUT=2`.
  - Không đụng vào các flag hiện hữu (`CORE_DEBUG_LEVEL`, `BOARD_HAS_PSRAM`, `MQTT_SOCKET_TIMEOUT`) để tránh nợ kỹ thuật hoặc thay đổi hành vi build hiện tại.
  - `[env:uart]` và `[env:otg]` đều dùng `extends = env:base` và tham chiếu `${env:base.build_flags}`, nên flag mới tự động lan xuống cả hai môi trường hardware theo đúng yêu cầu Kỹ sư trưởng.
- **Kết quả tự kiểm tra mã nguồn:**
  - `grep -n MQTT_MAX_PACKET_SIZE mushroom-iot-firmware/platformio.ini` xác nhận flag tồn tại tại dòng 62, đặt trong section `[env:base]` (bắt đầu ở dòng 31).
  - `grep -n "\[env:" mushroom-iot-firmware/platformio.ini` xác nhận `[env:uart]` và `[env:otg]` vẫn `extends = env:base` và có `${env:base.build_flags}` trong `build_flags`, nghĩa là kế thừa đúng flag mới.
  - Kiểm tra thư viện `PubSubClient` tại `.pio/libdeps/{esp32s3,otg}/PubSubClient/src/PubSubClient.h`: định nghĩa `#ifndef MQTT_MAX_PACKET_SIZE / #define MQTT_MAX_PACKET_SIZE 256`, xác nhận macro do build_flag inject sẽ được ưu tiên và constructor gọi `setBufferSize(MQTT_MAX_PACKET_SIZE)` → buffer runtime = 2048 bytes.
  - Không có env `native/test` trong `platformio.ini` (test build chạy qua binary `run_tests` biên dịch bằng host toolchain, không ảnh hưởng bởi build_flags của env hardware) → không rủi ro hồi quy đối với unit test.
  - Không phát sinh binary artefact hay file lock nào; diff chỉ gồm đúng 1 dòng thêm mới trong `platformio.ini`, đảm bảo tác động tối thiểu.
