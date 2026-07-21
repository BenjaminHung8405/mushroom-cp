# MQTT Topics Contract v2.2 — Direct-Relay Fuzzy Dynamic Tuning

Tài liệu này định nghĩa cấu trúc topic, chính sách QoS, chính sách Retain và cấu trúc dữ liệu payload cho luồng Dynamic Tuning (Fuzzy Logic) trong dự án IIoT.

## 1. Topic Namespaces

Mọi topic phải tuân thủ cấu trúc phân cấp dựa trên tenant và device ID. Cấm tuyệt đối hard-code tenant hoặc device ID.
Tất cả các segment của topic (`tenant`, `deviceId`) phải được validate để chống topic injection (chỉ chứa các ký tự chữ và số, dấu gạch dưới `_`, dấu gạch ngang `-`, độ dài tối đa 50 ký tự).

### 1.1 Desired Topic (Lệnh cấu hình từ Backend xuống Device)
- **Topic:** `{tenant}/esp32/{deviceId}/down/tuning/desired`
- **QoS:** 1 (At least once)
- **Retain:** `true` (Backend publish dạng retained để khi device khởi động lại hoặc reconnect có thể nhận được cấu hình mong muốn mới nhất).
- **Quy tắc xóa Retain:** Khi Backend nhận được ACK khớp với lệnh PENDING mới nhất của thiết bị, Backend sẽ publish một payload trống với cờ `retained=true` để xóa thông điệp desired trước đó.

### 1.2 Reported Topic (Phản hồi/Trạng thái từ Device lên Backend)
- **Topic:** `{tenant}/esp32/{deviceId}/up/tuning/reported`
- **QoS:** 1 (At least once)
- **Retain:** `false` (Tránh lưu trữ trạng thái ACK cũ).

### 1.3 Wildcard Pattern (Subscribe tại Backend)
- **Pattern:** `{tenant}/esp32/+/up/tuning/reported` (Backend subscribe theo tenant để phân quyền, tránh wildcard xuyên tenant `+/esp32/+/up/tuning/reported` trừ khi được cấu hình cụ thể).

---

## 2. Cấu trúc Payload (Schemas)

### 2.1 Desired Payload (Tuning Cấu hình)

Payload gửi từ Backend xuống thiết bị dưới dạng JSON:

```json
{
  "command_id": "3b2b4d9a-5b12-4c9c-87d1-efda2d1b82ac",
  "device_id": "esp32_device_01",
  "schema_version": 1,
  "config": {
    "lamp_gain_scale": 1.00,
    "mist_gain_scale": 1.05,
    "mist_on_threshold": 0.28,
    "mist_off_threshold": 0.14
  }
}
```

#### Các trường và ràng buộc:
- `command_id`: Chuỗi UUID v4 (8-4-4-4-12 hex chars).
- `device_id`: Khớp chính xác với ID của thiết bị nhận lệnh.
- `schema_version`: Phải là số nguyên `1`.
- `config`:
  - `lamp_gain_scale`: Float, giới hạn `[0.80, 1.20]`
  - `mist_gain_scale`: Float, giới hạn `[0.80, 1.20]`
  - `mist_on_threshold`: Float, giới hạn `[0.20, 0.35]`
  - `mist_off_threshold`: Float, giới hạn `[0.10, 0.20]`
  - *Ràng buộc liên kết (Cross-field constraint):* `mist_off_threshold` phải nhỏ hơn `mist_on_threshold` (`mist_off_threshold < mist_on_threshold`).

### 2.2 Reported Payload (ACK phản hồi từ Device)

Payload gửi từ Device lên Backend khi xử lý xong Desired:

```json
{
  "command_id": "3b2b4d9a-5b12-4c9c-87d1-efda2d1b82ac",
  "device_id": "esp32_device_01",
  "status": "ACCEPTED",
  "reason_code": null,
  "reported_config": {
    "lamp_gain_scale": 1.00,
    "mist_gain_scale": 1.05,
    "mist_on_threshold": 0.28,
    "mist_off_threshold": 0.14
  },
  "persisted": true,
  "reported_at": "2026-07-21T03:22:15Z"
}
```

#### Các trường và trạng thái:
- `command_id`: UUID của lệnh tương ứng.
- `device_id`: ID của thiết bị phản hồi.
- `status`: Trạng thái xử lý lệnh:
  - `ACCEPTED`: Chấp nhận cấu hình, đã ghi NVS và đưa vào queue điều khiển thành công.
  - `REJECTED`: Lệnh bị từ chối do không hợp lệ.
  - `DUPLICATE`: UUID đã được nhận và lưu trước đó (idempotency check).
- `reason_code`: Mã lỗi chi tiết nếu `status` là `REJECTED`:
  - `INVALID_SCHEMA`: Schema không hợp lệ, thiếu trường hoặc sai `schema_version`.
  - `DEVICE_MISMATCH`: `device_id` trong payload không khớp với ID đã cấu hình trên thiết bị.
  - `INVALID_UUID`: Định dạng UUID của `command_id` không hợp lệ.
  - `OUT_OF_RANGE`: Giá trị tham số nằm ngoài biên cho phép.
  - `CROSS_FIELD_INVALID`: Không thỏa mãn ràng buộc `mist_off_threshold < mist_on_threshold`.
  - `PERSISTENCE_FAILED`: Lỗi đọc/ghi Flash NVS.
  - `CONTROL_QUEUE_UNAVAILABLE`: Không thể đưa cấu hình vào queue điều khiển của Core 1.
- `reported_config`: Cấu hình thực tế đang hoạt động trên thiết bị sau khi nhận/xử lý lệnh.
- `persisted`: Cờ đánh dấu cấu hình đã được lưu bền vững vào Flash NVS.
- `reported_at`: Thời điểm phản hồi (định dạng ISO8601 UTC string).
