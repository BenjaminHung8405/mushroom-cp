# Sprint 4 — Offline Autonomy, Persisted Crop Profile & Control Observability

## Mục tiêu Sprint

Khi Wi-Fi/MQTT/NTP không khả dụng, ESP32 vẫn phải tiếp tục chạy trajectory, Fuzzy, TPC,
Safety Gate và manual override từ state profile đã đồng bộ gần nhất. Mọi safety limit vẫn
được thực thi tại Core 1, không phụ thuộc backend hoặc giờ trình duyệt.

Sprint này cũng chuẩn hóa feedback cho UI hiện có tại
`mushroom-ui/components/standard-actuators-control.tsx`: UI chỉ gửi intent `auto/on/off`,
nhưng quyết định hiệu lực, tự nhả override, và trạng thái thực phải đến từ firmware ack/state.

## Quy tắc quan trọng: Không giả vờ biết thời gian sau khi mất điện

`elapsed_seconds` chỉ có giá trị khi MCU còn cấp nguồn. Ghi nó vào NVS mỗi 30 phút **không**
tự cho ESP32 biết đã mất điện 6 giờ hay 6 ngày, vì `millis()` cũng dừng khi mất điện. Do đó:

- Khi còn nguồn nhưng mất mạng: dùng đồng hồ hệ thống đã được NTP sync gần nhất; thời gian vẫn
  tiến và trajectory nội suy được bình thường.
- Khi mất điện rồi boot lại **và thời gian chưa được trust**: không được giả định crop day bằng
  snapshot cũ. Firmware vào `TimeConfidence::Uncertain`, phát telemetry/ack cảnh báo, và chạy
  profile an toàn bảo thủ cho tới khi nhận NTP/MQTT time/profile mới.
- Nếu yêu cầu vận hành cần trajectory chính xác qua power loss + offline kéo dài, phải trang bị
  RTC có pin backup (ví dụ DS3231) hoặc nguồn giữ RTC; đây là dependency phần cứng, không thể
  thay bằng NVS đơn thuần.

## Thiết kế state và ownership

```
Core 0                                      Core 1
======                                      ======
MQTT profile/time update                    runControlPipelineStep
  validate schema/version                     snapshot immutable profile
  persist complete profile transaction        derive crop day + time confidence
  enqueue ProfileUpdate ------------------->  interpolate setpoint
                                              Fuzzy → manual latch → protection → TPC
NTP sync
  update trusted clock metadata
  persist at bounded cadence
```

- Core 0 chỉ validate, persist NVS, enqueue snapshot mới. Không sửa state profile Core 1 đang
  dùng.
- Core 1 là owner của active profile snapshot. `ProfileUpdate` được copy đầy đủ qua queue hoặc
  swap bằng mutex ngắn; không đọc NVS trong control tick.
- NVS write phải bounded để tránh flash wear: chỉ write profile khi version/checksum thay đổi,
  time checkpoint tối đa 30 phút/lần, và manual intent khi nó thay đổi (không write mỗi tick).
- Data NVS phải versioned + CRC. Chỉ activate record có magic/version/length/CRC hợp lệ; record
  lỗi thì giữ profile RAM trước đó hoặc fallback safe profile, không dùng dữ liệu một phần.

## Models

```cpp
enum class TimeConfidence : uint8_t {
    Trusted = 0,       // clock đã sync, hoặc external RTC hợp lệ
    Holdover = 1,      // mất mạng nhưng MCU chưa reset từ trusted time
    Uncertain = 2,     // reset sau mất điện, chưa có trusted time
};

struct CropCheckpoint {
    uint16_t crop_day;
    float temp_target_c;
    float humidity_target_rh;
} __attribute__((aligned(4)));

struct PersistedCropProfile {
    uint32_t magic;
    uint16_t schema_version;
    uint16_t checkpoint_count; // 1..MAX_CROP_CHECKPOINTS, tối đa 10
    int64_t crop_start_epoch_s;
    uint16_t total_crop_days;
    CropCheckpoint checkpoints[MAX_CROP_CHECKPOINTS];
    uint32_t crc32;
} __attribute__((aligned(4)));

struct PersistedTimeState {
    int64_t last_trusted_epoch_s;
    uint64_t last_trusted_uptime_ms;
    uint32_t crc32;
} __attribute__((aligned(4)));
```

- `crop_start_epoch_s` là UTC epoch của thời điểm bắt đầu vụ; backend phải gửi cùng profile.
- `last_trusted_uptime_ms` chỉ dùng để phân biệt holdover khi **chưa reboot**, không được dùng để
  suy ra thời lượng mất điện.
- Với `TimeConfidence::Trusted` hoặc `Holdover`:
  `crop_day = clamp(1 + floor((now_epoch_s - crop_start_epoch_s) / 86400), 1, total_crop_days)`.
- Với `Uncertain`: không tính crop day dựa trên NVS elapsed time. Áp dụng `SAFE_OFFLINE_SETPOINT`
  được review sinh học, giữ safety hard limits, và publish `time_confidence=uncertain`.

## Nội suy trajectory

`interpolateSetpoint(cropDay, checkpoints)` là pure function trên Core 1:

1. Sort/validate checkpoint theo `crop_day` tăng dần ở lúc profile ingest; reject duplicate, NaN,
   checkpoint ngoài `1..total_crop_days`, hoặc profile quá `MAX_CROP_CHECKPOINTS`.
2. Nếu day trước checkpoint đầu, dùng checkpoint đầu; nếu sau checkpoint cuối, dùng checkpoint cuối.
3. Tìm hai checkpoint bao quanh `day_a`, `day_b`, sau đó:

   `target = value_a + (value_b - value_a) * (cropDay - day_a) / (day_b - day_a)`

4. Validate output finite và nằm trong envelope biological safety profile trước khi đưa vào Fuzzy.

Interpolation dùng crop day integer theo profile hiện tại. Nếu cần ramp mượt hơn trong ngày, phải
bổ sung timestamp checkpoint và test riêng; không suy diễn fractional day từ clock không trust.

## Track A — Profile Contract & NVS

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| A1 | Thêm profile/time models vào `models.h` hoặc module profile riêng | Không để UI payload đi thẳng vào struct runtime; parse DTO rồi validate/copy. |
| A2 | Tạo `crop_profile_storage.h/.cpp` | NVS namespace/version/magic/CRC, load/store atomic record, bounded write cadence. |
| A3 | Implement profile validator | Reject malformed/NaN/unsorted/out-of-range checkpoints trước persist và trước enqueue. |
| A4 | Extend MQTT sync contract | Backend gửi version, `crop_start_epoch_s`, `total_crop_days`, checkpoints, CRC/schema. Retained profile giúp device reconnect tự phục hồi. |
| A5 | Persist manual override separately | Chỉ persist latest intent + expiry in trusted epoch khi available. Nếu reboot time `Uncertain`, do not restore FORCE_ON; restore AUTO (fail-safe). FORCE_OFF có thể restore only if explicitly approved in safety review. |

## Track B — Time Confidence

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| B1 | Tạo `time_confidence` module | API pure/read-only cho `Trusted`, `Holdover`, `Uncertain`; explicit boot transition. |
| B2 | Wire NTP/MQTT time sync | Valid time sets `Trusted`, saves bounded `PersistedTimeState`; connection loss while same boot gives `Holdover`. |
| B3 | Detect reboot/offline uncertainty | Boot without valid RTC/NTP/MQTT time must be `Uncertain`, not estimated elapsed time. |
| B4 | Define safe offline profile | Product/biological owner supplies concrete conservative setpoint; code uses named config, not a guessed magic number. |
| B5 | Telemetry exposure | Publish `time_confidence`, `crop_day`, `profile_version`, `profile_source` and `offline_safe_mode`. |

## Track C — Core 1 Profile Snapshot & Interpolation

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| C1 | Add profile update queue/snapshot bridge | Core 0 sends complete validated profile; Core 1 adopts only at beginning of a control tick. |
| C2 | Implement `interpolateSetpoint()` | Pure function; never allocates or touches NVS/network. |
| C3 | Integrate with control pipeline | Trusted/Holdover computes crop day + interpolated target; Uncertain selects safe offline target. |
| C4 | Maintain safety precedence | Profile target → Fuzzy → manual latch/Fuzzy-Bounds Guarding → `hardwareProtectionOverride()` → TPC. |
| C5 | Manual UI feedback | `manual_ack` includes `time_confidence`; UI shows degraded/offline warning but cannot bypass Core 1 safety gate. |

## Track D — UI Integration Contract

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| D1 | Rename actuator contract deliberately | Migrate UI `heater_air` to firmware’s thermal-lamp channel (`lamp`/`lamp_stage`) with an explicit backend migration, not a silent client-only rename. |
| D2 | Reconcile intent from firmware | Existing local React `mistMode/fanMode/heaterAirMode` becomes optimistic only; reconcile from retained ack/state `effective_intent`, `release_reason`, `expires_ms`. |
| D3 | Show authoritative safety release | When Core 1 emits `SafetyLimitReached`, UI returns control to AUTO and displays exact firmware-provided reason. It must not rely on browser time or guessed sensor threshold. |
| D4 | Preserve UI pre-checks as UX only | The midday/crop-day checks in `handleOverrideChange()` can reduce failed clicks, but device-side RTC/profile rules remain authoritative. |

## Track E — Tests & Field Verification

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| E1 | `test_interpolate_between_checkpoints` | Day between two known checkpoints gives exact linear target. |
| E2 | `test_interpolate_endpoint_clamp` | Before first/after last checkpoint clamps to endpoint. |
| E3 | `test_profile_rejects_invalid_checkpoint_data` | NaN, duplicates, unsorted, out-of-range count/day rejected. |
| E4 | `test_profile_crc_rejects_corruption` | Corrupt persisted record never becomes active. |
| E5 | `test_holdover_keeps_crop_day_after_wifi_loss` | Same boot, previously trusted clock, loss of network → valid derived crop day. |
| E6 | `test_reboot_without_trusted_clock_enters_safe_offline` | NVS profile exists but no RTC/NTP/MQTT after simulated reboot → `Uncertain`, safe profile; no false elapsed-time estimate. |
| E7 | `test_force_on_not_restored_when_time_uncertain` | Reboot under uncertainty must not revive a stale FORCE_ON latch. |
| E8 | Field test: Wi-Fi disconnect | Confirm no control pause, local button works, telemetry indicates Holdover. |
| E9 | Field test: power-cycle without network | Confirm Uncertain/safe mode, no stale FORCE_ON, then correct recovery after time/profile sync. |
| E10 | `pio test -e native` | PASS all current and new tests. |

## Definition of Done

- Device runs the last valid profile through network loss without a control-loop pause.
- Device never invents crop-day progression after a power loss without a trusted clock.
- Corrupt/incomplete NVS profile cannot activate.
- Manual FORCE_ON is protected by the Sprint 2 warning limits at every tick and is not resurrected
  after an uncertain reboot.
- UI receives retained, firmware-authoritative intent/release/time-confidence state after reconnect.
- `pio test -e native` passes, plus the two field tests above are logged.
