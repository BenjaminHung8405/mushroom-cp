# WALKTHROUGH LOG — IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning

Tài liệu này lưu vết nhật ký thực thi của dự án dynamic tuning qua từng task.

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
