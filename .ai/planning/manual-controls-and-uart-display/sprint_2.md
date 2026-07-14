# Sprint 2 — Cabinet Buttons + Manual Request Pipeline (Core 0 → Core 1 Safety Gate)

## Mục tiêu Sprint

Thêm ba nút vật lý trên tủ điện cho Mist / Lamp / Fan. Nút không bao giờ ghi GPIO relay
trực tiếp; thay vào đó gửi yêu cầu qua queue tới Core 1, nơi luật fuzzy/safety gate quyết
định có cho phép bật/tắt hay không. Bất kỳ yêu cầu ON nào vi phạm ranh giới an toàn (over
temp, over humidity, blackout, sensor NAN) sẽ bị chặn và log lý do. Yêu cầu OFF luôn được
chấp nhận (hướng fail-safe).

## Non-goals

- Không hiển thị trạng thái nút lên LED display (Sprint 3).
- Không đẩy manual command lên MQTT ack (chỉ log Serial ở sprint này; MQTT tùy chọn).
- Không thêm rotary encoder logic mới.

## Thiết kế luồng dữ liệu

```
Core 0                                Core 1
======                                ======
taskCabinetButtons                    taskCore1Control (runControlPipelineStep)
  poll 10ms (vTaskDelayUntil)           drainManualRequestQueue()
  history = (history<<1) | sample         for each ManualRequest:
  history==0x00 → confirmed PRESS         decision = evaluateManualSafetyGate(req, tel, sp, rtc)
  history==0xFF → confirmed RELEASE       if Accepted:
    → push {chan, intent_on} into             update/toggle manualLatch[chan]
      g_manual_request_queue                else:
                                              push ManualAck{reject reason} → g_manual_ack_queue
                                        autoClearOnSensorViolation(...)
                                        applyManualLatchToOutputs(outputs, manualLatch, now)
                                        hardwareProtectionOverride(outputs, rtcTime)  # ưu tiên cao nhất
                                        TPC.applyTpcOutputs(outputs, ...)
```

**Debounce = Shift Register Integrator (industrial-grade).** Mỗi nút giữ `uint8_t history`;
task Core 0 lấy mẫu mỗi 10 ms và dịch bit trái. Chỉ khi 8 mẫu liên tiếp cùng cực (0x00 hoặc
0xFF) mới chốt trạng thái. EMI từ SSR đóng ngắt tải công suất cao trong tủ điện sinh ra xung
< 5–10 ms sẽ bị lọc sạch. Thời gian nhận diện nhấn thật ổn định ≈ 80 ms — vẫn cảm giác tức
thời với người vận hành.

- `g_manual_request_queue`: depth 4, item `ManualRequest`.
- `g_manual_ack_queue`: depth 4, item `ManualAck` (Core 0 dùng cho Serial log + future MQTT).
- `manualLatch[]`: array 3 phần tử `{active, forced_state, expires_ms}` sống trong scope
  `taskCore1Control` (không toàn cục).

## Data models

Trong `include/models.h`:

```cpp
enum class AppChannel : uint8_t {
    MIST = 0,
    LAMP = 1,
    FAN  = 2,
    COUNT
};

// Unified override intent — shared by UI (MQTT) and physical buttons.
// Replaces the old toggle-only `intent_on` boolean with explicit three-state intent.
enum class AppIntent : uint8_t {
    AUTO = 0,   // Trả quyền về Fuzzy/TPC
    FORCE_ON = 1, // Ép bật có kiểm soát (Fuzzy-Bounds Guarding)
    FORCE_OFF = 2, // Ép tắt
};

struct ManualRequest {
    AppChannel channel;
    AppIntent  intent;      // AUTO / FORCE_ON / FORCE_OFF
    uint32_t   request_ms;  // millis() lúc phát request
} __attribute__((aligned(4)));

// Payload từ Web UI qua MQTT override topic — cùng schema với ManualRequest.
struct ActuatorOverridePayload {
    AppChannel channel;
    AppIntent  intent;      // AUTO / FORCE_ON / FORCE_OFF
    uint32_t   request_ms;  // epoch ms từ client (cho audit trail)
} __attribute__((aligned(4)));

enum class ManualDecision : uint8_t {
    Accepted     = 0,
    RejectedNAN  = 1,
    RejectedTemp = 2,
    RejectedHumi = 3,
    RejectedBlackout = 4,
    RejectedRateLimit = 5,
    RejectedLocked = 6,    // NEW: crop-day lock (heater_air > day 8) hoặc blackout cứng
};

struct ManualAck {
    AppChannel     channel;
    AppIntent      requested_intent;
    ManualDecision decision;
    uint32_t       ack_ms;
} __attribute__((aligned(4)));
```

## Safety gate rules (Core 1, pure function)

Hàm `manual::evaluateSafetyGate(request, telemetry, setpoints, rtcTime, cropDay)` chạy **chỉ trên Core 1**
và áp dụng đồng nhất cho request từ nút vật lý lẫn MQTT/Web UI:

- **AUTO hoặc FORCE_OFF**: luôn `Accepted`. Không cần đọc sensor; AUTO xoá latch, FORCE_OFF
  giữ duty ở 0 cho tới TTL hoặc request AUTO mới.
- **Mist FORCE_ON**:
  - `!isfinite(humidity_air)` → `RejectedNAN`.
  - `humidity_air >= MIST_WARNING_LIMIT_RH` (92.0f) → `RejectedHumi`.
  - `!rtcTime.valid || isMiddayBlackout(rtcTime)` → `RejectedBlackout`.
  - Ngược lại → `Accepted`.
- **Lamp FORCE_ON**:
  - `!isfinite(temp_air)` → `RejectedNAN`.
  - `cropDay > 8` → `RejectedLocked`, đúng với UI lock của `heater_air`.
  - `temp_air >= setpoints.temp_target + LAMP_WARNING_DELTA_C` (3.0f) → `RejectedTemp`.
  - Ngược lại → `Accepted`.
- **Fan FORCE_ON**: luôn `Accepted` (quạt an toàn, kể cả blackout — giúp hạ nhiệt).

### Fuzzy-Bounds Guarding (bắt buộc)

`FORCE_ON` **không** nhường quyền lại cho Fuzzy ngay ở tick kế tiếp. Nó ép thiết bị chạy để đáp ứng
ý định của người vận hành, nhưng vẫn chạy dưới dải giới hạn sinh học đã xác nhận:

- MIST: giữ duty 1.0 cho đến khi `humidity_air >= MIST_WARNING_LIMIT_RH` (92%RH). Khi chạm
  ngưỡng, ép duty=0, tự đổi intent về `AUTO`, publish ack/release reason `SafetyLimitReached`.
- LAMP: giữ demand `LAMP_MANUAL_DUTY` (0.6, tương ứng staged Lamp1 full + Lamp2 20%) cho đến
  khi `temp_air >= temp_target + LAMP_WARNING_DELTA_C`; khi chạm ngưỡng, ép duty=0, tự về `AUTO`
  và publish ack/release reason.
- FAN: FORCE_ON không có biological warning limit; chỉ nhả theo AUTO, TTL, hoặc reset.
- `hardwareProtectionOverride()` là chốt cứng cuối: thắng mọi latch, bao gồm cả FORCE_OFF/ON.

Manual latch:
- Mỗi override có TTL 15 phút. Sau TTL, intent tự thành `AUTO` và fuzzy giành lại quyền.
- Core 1 đánh giá lại giới hạn ở **mỗi control tick**, không chỉ lúc nhận request. Vì vậy sensor
  thay đổi sau khi force-on vẫn tự nhả an toàn.
- Rate limit: cùng 1 kênh không được nhận > 1 request/second → `RejectedRateLimit`.
- Chỉ Core 1 đọc/ghi latch. Core 0 không được sửa trực tiếp state manual.

## Ứng dụng latch vào output

Hàm `manual::applyManualLatchToOutputs(FuzzyController::ArbitratedOutputsPod& outputs,
ManualLatchArray& latch, uint32_t now, const TelemetryData&, const SetpointPod&, const RtcTimePod&, uint16_t cropDay)`:

- Với từng channel, expire TTL hoặc auto-release do warning limit trước khi áp dụng duty.
- `FORCE_ON`: set duty tương ứng = `1.0f` (Mist/Fan) hoặc `0.6f` (Lamp).
- `FORCE_OFF`: set duty = `0.0f`.
- `AUTO`: không sửa output của Fuzzy.
- Trả về danh sách release event để Core 1 publish `ManualAck` cập nhật UI.
- Áp dụng **sau** fuzzy + adaptive tuner, **trước** `hardwareProtectionOverride()`. Blackout
  interlock luôn thắng manual latch.

## Danh sách task

### Track A — Config & Boot GPIO

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| A1 | Thêm 3 constant chân nút trong `include/config.h::hardware` | `PIN_BTN_MIST = 4`, `PIN_BTN_LAMP = 15`, `PIN_BTN_FAN = 16` trong namespace mới `config::hardware`. Comment: active-LOW, dùng `INPUT_PULLUP` mềm; production cần thêm pull-up 4.7 kΩ vật lý + RC 100 nF + 10k debounce. |
| A2 | Thêm helper `init_cabinet_buttons_gpio()` trong `actuators.h`/`actuators.cpp` | `pinMode(pin, INPUT_PULLUP)` cho cả 3 chân. Log rõ ràng. Gọi từ `init_actuators_gpio()` cùng với `init_wifi_config_button_gpio()`. |

### Track B — Unified Override Models, Queues & MQTT Bridge

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| B1 | Thêm models vào `include/models.h` | `AppChannel`, `AppIntent`, `ManualRequest`, `ActuatorOverridePayload`, `ManualDecision`, `ManualAck` theo spec. Bọc POD với `__attribute__((aligned(4)))`. Không dùng boolean/toggle semantic cho override. |
| B2 | Khai báo `g_manual_request_queue`, `g_mqtt_override_queue`, `g_manual_ack_queue` trong `include/definitions.h` | Bọc `#ifndef UNIT_TEST`. Hai queue input tách nguồn (physical/MQTT) nhưng cùng `ManualRequest` schema và đều chỉ được Core 1 consume. Depth 8 mỗi queue; ack depth 8. |
| B3 | Định nghĩa queue trong `src/core1_tasks.cpp` | Khởi tạo `nullptr`, cùng khu vực `xTelemetryQueue`. |
| B4 | Tạo ba queue trong `initQueues()` của `main.cpp` | Fail FATAL nếu không tạo được; không start task phụ thuộc queue. |
| B5 | Thêm MQTT/UI override adapter trong `mqtt_client.cpp` | Parse payload `actuator` + `state` (`true`→FORCE_ON, `false`→FORCE_OFF, `null`→AUTO) từ contract hiện có của `postActuatorOverride()`. Validate schema/range tại Core 0 rồi enqueue `ManualRequest`; không đánh giá bio-rule, không sửa latch. |
| B6 | Xác nhận telemetry/ack contract cho UI | Retained ack phải có: `channel`, `requested_intent`, `decision`, `effective_intent`, `release_reason`, `expires_ms`, `ack_ms`. UI dựa vào ack/effective intent, không suy diễn auto-release từ trạng thái relay đơn thuần. |

### Track C — Safety Gate & Latch Module

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| C1 | Tạo mới `include/manual_control.h` | Namespace `manual`. Khai báo: `evaluateSafetyGate()`, `applyManualLatchToOutputs()`, struct `ManualLatchEntry`, alias `ManualLatchArray` (std::array<ManualLatchEntry, 3>). `#pragma once`. Không include `Arduino.h` ở header; forward-declare types nếu cần. |
| C2 | Tạo mới `src/manual_control.cpp` | Chỉ chứa pure logic + constant. `constexpr uint32_t MANUAL_TTL_MS = 15UL * 60UL * 1000UL;` `constexpr float LAMP_MANUAL_DUTY = 0.6f;` `constexpr float RATE_LIMIT_MS = 1000U;`. Không include `<Arduino.h>` khi không cần thiết — dùng `<cstdint>`, `<cmath>`. |
| C3 | Hiện thực `evaluateSafetyGate()` | Đúng theo rule ở phần thiết kế. Không side-effect, không log. Trả `ManualDecision`. |
| C4 | Hiện thực helper `updateLatchOnAccepted()` | Nhận request đã accepted + `now` + reference `ManualLatchArray`. Set `active=true`, `forced_state=req.request_on`, `expires_ms=now+MANUAL_TTL_MS`. |
| C5 | Hiện thực `applyManualLatchToOutputs()` | Duyệt 3 channel: nếu latch expired → tự clear. Nếu active, ép duty theo forced_state. |
| C6 | Thêm `autoClearOnSensorViolation()` | Nhận latch + telemetry + setpoints + rtcTime. Nếu latch active theo hướng ON nhưng điều kiện chuyển sang cảnh báo (nhiệt/ẩm vượt biên), clear latch và log lý do. |

### Track D — Core 0 Button Task

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| D1 | Thêm khai báo `taskCabinetButtons(void*)` trong `definitions.h` | Bọc `#ifndef UNIT_TEST`. |
| D2 | Tạo file `src/cabinet_buttons.cpp` | Chỉ chứa task Core 0. Import `manual_control.h`, `definitions.h`, `config.h`. Không import fuzzy/TPC. |
| D3 | Hiện thực Shift-Register Integrator debounce cho từng nút | Cấu hình `ButtonState` và `buttons[]` như đoạn mã thực chiến. Lấy mẫu mỗi 10ms: `raw_sample = (digitalRead(pin) == HIGH)`, `history = (history << 1) \| (raw_sample ? 1 : 0)`. Chốt PRESS khi `history == 0x00` và `current_state == true`. Chốt RELEASE khi `history == 0xFF` và `current_state == false`. |
| D4 | Gửi request sang Core 1 | Khi chốt PRESS, gửi `ManualRequest` với `intent_on = true` sang `g_manual_request_queue`. |
| D5 | Gọi `xTaskCreatePinnedToCore` trong `createCoreTasks()` | Chạy task `cabinet_buttons::task_cabinet_buttons` (Core 0, priority 1, stack 2048). Vòng lặp dùng `vTaskDelayUntil` với chu kỳ `xFrequency = pdMS_TO_TICKS(10)` để đảm bảo chính xác 10ms. |
| D6 | Pre-seed lịch sử nút lúc start | Khởi tạo nút với `history = 0xFF`, `current_state = true` để tránh false trigger PRESS khi boot. |

### Track E — Core 1 Integration

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| E1 | Thêm biến local `ManualLatchArray manualLatch{}` trong `taskCore1Control()` | Không toàn cục. Init zero. |
| E2 | Thêm bước drain queue vào đầu `runControlPipelineStep()` | Sau khi drain baseline/override, drain `g_manual_request_queue`. Với mỗi request: gọi `evaluateSafetyGate`, nếu Accepted và toggle-semantics: nếu latch cùng channel đang active với `forced_state==intent_on` thì clear latch (toggle OFF), ngược lại update latch. Sinh `ManualAck` push vào `g_manual_ack_queue` (non-blocking). |
| E3 | Chèn `autoClearOnSensorViolation(manualLatch, telemetry, setpoints, rtcTime)` sau khi có `setpoints` | Trước khi gọi fuzzy. |
| E4 | Chèn `applyManualLatchToOutputs(outputs, manualLatch, millis())` sau `arbitrateOutputs` | Trước `hardwareProtectionOverride`. |
| E5 | Verify `hardwareProtectionOverride` vẫn thắng | Thêm 1 comment giải thích thứ tự: fuzzy → tuner → arbitrate → manual latch → protection → TPC. |

### Track F — Core 0 Ack Consumer

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| F1 | Trong `taskCore0Communication`, thêm bước drain `g_manual_ack_queue` mỗi vòng | Log qua `ScopedSerialLock`: `[MANUAL] ch=%d req_on=%d decision=%d`. Không block. |
| F2 | (Optional) Publish MQTT topic `mushroom/{device}/manual_ack` | Nếu MQTT connected. Payload JSON `{channel, requested_on, decision, ts}`. Không bắt buộc pass trong sprint này. |

### Track G — Tests

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| G1 | `test_manual_gate_mist_over_humidity` | telemetry.humidity_air = 94, request Mist ON → `RejectedHumi`. |
| G2 | `test_manual_gate_mist_nan_humidity` | humidity NAN → `RejectedNAN`. |
| G3 | `test_manual_gate_lamp_over_temp` | temp_air = target+5 → `RejectedTemp`. |
| G4 | `test_manual_gate_fan_always_accepted` | Fan ON được chấp nhận kể cả blackout + sensor NAN. |
| G5 | `test_manual_gate_off_always_accepted` | Bất kỳ OFF request → Accepted, không đọc sensor. |
| G6 | `test_latch_ttl_expires` | Latch active, giả lập `now` vượt TTL → apply không ép duty. |
| G7 | `test_latch_auto_clear_on_sensor_violation` | Latch Mist=ON, telemetry.humidity vọt 95 → autoClear clear latch. |
| G8 | `test_apply_latch_order_vs_protection` | Latch Mist=ON, blackout active → sau protection outputs.Mist = 0 (protection thắng). |
| G9 | Chạy `pio test -e native` toàn bộ | PASS, không có warning liên quan. |

## Definition of Done

- Sau khi flash và nhấn nút Mist ở nhà nấm với humidity 70%, Mist relay ON trong TTL 15 phút.
- Nhấn nút Mist khi humidity 94% → relay không ON, Serial log `[MANUAL] ch=0 req_on=1 decision=3`.
- Nhấn nút Fan luôn ON.
- Blackout 11:00-13:30: nút Mist bị chặn với `decision=RejectedBlackout`.
- `pio test -e native` PASS.
- Không có race condition: manualLatch chỉ được sửa bởi Core 1, request chỉ push bởi Core 0.

## Phụ lục — Thuật toán Shift-Register Integrator Debounce

Được thay thế cho polling 20 ms + confirm 30 ms sau review phản hồi từ senior IoT dev.
Môi trường tủ điện thực địa có EMI mạnh khi SSR đóng ngắt tải cảm (quạt, mist, đèn nhiệt).
Debounce đơn giản dễ bị **ghost trigger** — chip đọc xung nhiễu thành lệnh nhấn giả.

### Nguyên lý

Mỗi 10 ms task lấy 1 mẫu điện áp raw từ GPIO. 8 mẫu gần nhất được dồn vào biến `uint8_t
history`. Chỉ khi cả 8 mẫu liên tiếp đều cùng một mức (`0x00` hoặc `0xFF`) thì trạng thái
debounced mới được chốt. Cửa sổ xác nhận thực tế = **80 ms**, đủ dài để lọc mọi burst EMI
điển hình (< 10 ms) và đủ ngắn để user không cảm nhận độ trễ.

Với active-LOW (INPUT_PULLUP + nút GND): raw sample = 1 khi nhả (HIGH), 0 khi nhấn (LOW).
Convention của repo: `history` lưu chuỗi mẫu raw **đã lọc**; nhấn ổn định = `0x00`, nhả
ổn định = `0xFF`. Không dùng inverted history.

### Mã nguồn Triển khai Thực chiến cho `cabinet_buttons.cpp`

```cpp
#pragma once
#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "config.h"
#include "definitions.h"

namespace cabinet_buttons {
    // Cấu trúc quản lý trạng thái nút công nghiệp
    struct ButtonState {
        uint8_t pin;
        uint8_t history;       // Bộ lưu lịch sử dịch bit (8 mẫu liên tiếp)
        bool current_state;    // Trạng thái đã chốt (Debounced State)
        AppChannel channel;    // Kênh điều khiển tương ứng
    };

    // Khởi tạo ma trận nút bấm vật lý
    static ButtonState buttons[] = {
        { config::hardware::PIN_BTN_MIST, 0xFF, true, AppChannel::MIST },
        { config::hardware::PIN_BTN_FAN,  0xFF, true, AppChannel::FAN  },
        { config::hardware::PIN_BTN_LAMP, 0xFF, true, AppChannel::LAMP }
    };

    void task_cabinet_buttons(void *pvParameters) {
        // Cấu hình cứng GPIO với Pull-up nội bộ chống nhiễu ban đầu
        for (auto &btn : buttons) {
            pinMode(btn.pin, INPUT_PULLUP);
        }

        TickType_t xLastWakeTime = xTaskGetTickCount();
        const TickType_t xFrequency = pdMS_TO_TICKS(10); // Lấy mẫu liên tục mỗi 10ms

        while (true) {
            for (auto &btn : buttons) {
                // Đọc trạng thái raw tại chân vật lý (Active LOW do dùng Pull-up)
                bool raw_sample = (digitalRead(btn.pin) == HIGH);
                
                // Dịch bit lịch sử để lưu mẫu mới
                btn.history = (btn.history << 1) | (raw_sample ? 1 : 0);

                // Kiểm tra điều kiện chốt trạng thái (Industrial Filter State Machine)
                if (btn.history == 0x00 && btn.current_state == true) {
                    // 8 mẫu liên tiếp đều LOW -> Xác nhận Cử chỉ Nhấn Nút (Pressed)
                    btn.current_state = false;
                    
                    // Đóng gói ý định người dùng gửi sang Core 1 qua Queue
                    ManualRequest req{ .channel = btn.channel, .intent_on = true };
                    xQueueSend(g_manual_request_queue, &req, 0); // Non-blocking send
                    Serial.printf("[BUTTON] Debounced PRESS on Channel %d\n", btn.channel);
                } 
                else if (btn.history == 0xFF && btn.current_state == false) {
                    // 8 mẫu liên tiếp đều HIGH -> Xác nhận Cử chỉ Nhả Nút (Released)
                    btn.current_state = true;
                    Serial.printf("[BUTTON] Debounced RELEASE on Channel %d\n", btn.channel);
                }
            }

            // Trả quyền điều khiển cho FreeRTOS, ngủ đúng 10ms (Không chiếm dụng CPU)
            vTaskDelayUntil(&xLastWakeTime, xFrequency);
        }
    }
}
```

### Nghiệm thu

- **Nghiệm thu phần cứng Debounce:** Lấy một đoạn dây điện quẹt liên tục vào chân GPIO 4 (Nút sương) tạo tia lửa điện nhiễu giả lập. Hệ thống lọc nhiễu 8-bit tích lũy bắt buộc phải bỏ qua các xung nhiễu này, chỉ khi nhấn giữ nút thật sự cứng tay quá 80ms thì Rơ-le mới được quyền kích hoạt.
- **Độc quyền TPC Chốt chặn:** Dùng lệnh tìm kiếm toàn cục trong IDE: `grep -r "digitalWrite" src/`. Ngoại trừ file `actuators.cpp` tại hàm khởi tạo, tuyệt đối không được xuất hiện bất kỳ dòng lệnh ghi chân nào khác ngoài file `TPC_Task.cpp`.
- **Chống double-press:** Nhấn nhanh 2 lần cách nhau 100 ms → chỉ 1 request đi qua (rate-limit).
- **Chống stuck press:** Nút giữ 30 giây → chỉ 1 request tại thời điểm PRESS. Không lặp request.

## Rủi ro & Mitigation

- **Rủi ro:** Toggle semantics khiến user bối rối (nhấn 2 lần mà không thấy đảo trạng thái do
  latch expired giữa chừng). **Mitigation:** Sprint 3 hiển thị trạng thái latch lên LED display
  bằng dấu chấm decimal — user quan sát được ngay.
- **Rủi ro:** Nút bounce vật lý > 30 ms. **Mitigation:** production layout PCB có RC filter; nếu
  vẫn bounce, tăng debounce lên 50 ms trong task D3.
- **Rủi ro:** GPIO 4 có thể là input-only trên vài SKU. **Mitigation:** GPIO 4 trên ESP32-S3
  N16R8 là general-purpose I/O, đã verify với datasheet ESP32-S3-WROOM-1. Backup pin: GPIO 21.
