# Nhật Ký Thực Thi (Walkthrough Log) — OTA Remote Update System

> Ghi chú: Các bản ghi được sắp xếp theo thứ tự thời gian đảo ngược (mới nhất ở trên đầu).

---

## 2026-07-14T13:45:00+07:00 — Task A4

- **Task ID:** A4
- **Mô tả:** Tạo file header `ota_manager.h` khai báo public API của namespace `ota`.
- **Trạng thái hiện tại:** `[ ] QA Review` — Đang chờ QA Review.
- **Files đã sửa đổi:**
  - Không có.
- **Files đã tạo mới:**
  - `mushroom-iot-firmware/include/ota_manager.h` (file header định nghĩa namespace `ota` chứa các public API).
- **Giải trình ngắn gọn về giải pháp logic đã viết:**
  - Khai báo các hàm public cho hệ thống OTA trong `namespace ota`: `init()`, `request_ota_update()`, `check_ota_trigger()`, `perform_ota_update()`.
  - Để đảm bảo file có thể compile bình thường trong môi trường host unit tests (`UNIT_TEST`), chúng tôi bọc header `<WString.h>` và `<Arduino.h>` trong một cấu trúc điều kiện: `#ifndef UNIT_TEST` thì include cả hai, ngược lại (`#else`) thì chỉ include `<Arduino.h>` (trỏ đến mock header `test/Arduino.h` trên host). Điều này giải quyết triệt để lỗi thiếu file `<WString.h>` trên host compiler (macOS) đồng thời giữ cho định nghĩa `String` hoạt động bình thường.
- **Kết quả tự kiểm tra mã nguồn:**
  - Tích hợp thử `#include "ota_manager.h"` vào `test/run_tests.cpp` và biên dịch bằng trình biên dịch `g++` local host: build thành công không có bất cứ lỗi nào liên quan đến cú pháp hay file header không tìm thấy.
  - Chạy `./run_tests` xác nhận hoạt động bình thường và chỉ gặp lỗi assertion `load_hardware_override` có sẵn từ trước (pre-existing).
  - Khôi phục file `test/run_tests.cpp` sạch sẽ sau khi kiểm tra xong.

---

## 2026-07-14T13:27:51+07:00 — Task A3

- **Task ID:** A3
- **Mô tả:** Định nghĩa file-scope `TaskHandle_t hTaskCore1Control` và `TaskHandle_t hTaskHWButton` (khởi tạo `nullptr`) trong `mushroom-iot-firmware/src/main.cpp`.
- **Trạng thái hiện tại:** `[ ] QA Review` — Đang chờ QA Review.
- **Files đã sửa đổi:**
  - `mushroom-iot-firmware/src/main.cpp` (chèn 8 dòng: comment giải thích + block `#ifndef UNIT_TEST` chứa hai định nghĩa TaskHandle).
- **Files đã tạo mới:**
  - Không có.
- **Giải pháp logic đã viết:**
  - Chèn đúng một block gồm 3 dòng comment mô tả mục đích + `#ifndef UNIT_TEST ... #endif` bao quanh hai định nghĩa `TaskHandle_t hTaskCore1Control = nullptr;` và `TaskHandle_t hTaskHWButton = nullptr;` ngay sau nhóm `#include` (dòng 14-21), trước các `static constexpr` hằng số cấu hình task.
  - Khởi tạo về `nullptr` là bắt buộc theo chỉ thị Kỹ sư trưởng để `ota_manager` ở Sprint 2 có thể kiểm tra an toàn (`if (handle != nullptr)`) trước khi gọi `vTaskSuspend/vTaskResume`, tránh gọi vào task chưa được tạo.
  - Toàn bộ định nghĩa nằm trong `#ifndef UNIT_TEST` khớp với extern declaration đã có sẵn ở `include/definitions.h` (Task A2) — đảm bảo native unit test build không đòi hỏi symbol và không lộ FreeRTOS type ra host.
  - Không đụng vào bất kỳ include, hằng số, hàm hiện hữu nào khác; không sửa `createCoreTasks()` (đó là phạm vi Task B1/B2). Patch tối thiểu tuyệt đối.
- **Kết quả tự kiểm tra mã nguồn:**
  - `grep -n "TaskHandle_t hTask"` xác nhận đúng một cặp definition tại `src/main.cpp:19-20` và đúng một cặp extern declaration tại `include/definitions.h:36-37` — không xung đột đa định nghĩa, cả hai đều bên trong `#ifndef UNIT_TEST`.
  - Syntax check bằng `gcc -x c++ -std=c++17 -fsyntax-only` cho phần định nghĩa (giả lập với typedef `TaskHandle_t`): pass ở cả nhánh non-UNIT_TEST và nhánh UNIT_TEST (nhánh UNIT_TEST đơn giản bỏ qua block do `#ifndef` false).
  - Chạy `./run_tests` sau khi thay đổi: assertion fail tại `run_tests.cpp:270` (`storage.load_hardware_override`) — đây là lỗi pre-existing đã được ghi nhận trong bản ghi Task A2 và KHÔNG liên quan tới `main.cpp`. Test `main.cpp setup()/loop()` ở block 14 (dòng 711) nằm SAU điểm assert fail line 270 nên không có đánh giá được ở lần chạy này, nhưng đường dẫn UNIT_TEST của `main.cpp` không bị thay đổi (khối `#ifndef UNIT_TEST` mới thêm sẽ không được compile trong test build).
  - `git diff mushroom-iot-firmware/src/main.cpp` xác nhận diff chỉ gồm đúng 8 dòng added liên tiếp, không có thay đổi ngẫu nhiên (whitespace/format/encoding) ở phần còn lại của file. Không phát sinh binary hay artefact nào.

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
