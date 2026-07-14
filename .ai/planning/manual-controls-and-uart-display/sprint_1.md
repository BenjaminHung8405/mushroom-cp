# Sprint 1 — Pin Map Refactor + HAir→HLamp (2-Bulb Staged Dispatch)

## Mục tiêu Sprint

Đóng gói toàn bộ thay đổi phần cứng và pipeline điều khiển cho việc chuyển từ 4 relay
`{Mist, Fan, HAir, HWat}` sang 5 relay `{Mist, Fan, HWat, Lamp_1, Lamp_2}`. Sau Sprint 1:

- Fuzzy chỉ sinh ra 3 duty demand cho thermal/humidity pipeline: `HLamp`, `HWat`, `Mist`.
- TPC nhận `HLamp` [0..1] và phân rã thành hai kênh vật lý `Lamp_1`/`Lamp_2` bằng staged
  dispatch (bóng 1 kích khi demand > 0, bóng 2 kích thêm khi demand > 0.5).
- Adaptive tuner đổi trường `gain_HAir` → `gain_HLamp`.
- Web UI, telemetry payload, MQTT topic hiển thị đúng nhãn mới.
- Toàn bộ unit test `pio test -e native` PASS; test reject-invalid-pin dời sang GPIO 21.
- Blackout interlock của `HWat`/`Mist` giữ nguyên hành vi.

## Non-goals

- Không thêm nút vật lý (Sprint 2).
- Không thêm UART display (Sprint 3).
- Không đổi TPC window/min-on/min-off của Mist/Fan/HWat.
- Không đổi luật fuzzy CO2.

## Trạng thái ban đầu (đã verify)

- `PIN_RELAY_HEATER_1=12` gán cho `HAir`, `PIN_RELAY_HEATER_2=13` gán cho `HWat`.
- `PIN_ONE_WIRE=14` chỉ còn được tham chiếu trong `test/run_tests.cpp:851` (assertion reject);
  không có driver DS18B20 nào đọc chân này.
- `FuzzyController::DualHeaterOutputsPod` có 4 trường `{HAir, HWat, Mist, ExhTH}`.
- `ArbitratedOutputsPod` có 4 trường `{HAir, HWat, Mist, Exh}`.
- `AdaptiveTuner::GainsPod` có `gain_HAir`, `gain_HWat`.
- `TpcSchedulerState` có `{HAir, HWat, Mist, Exh}`.
- Web UI có label "Air Heater (HAir)" và "Water Heater (HWat)".

## Danh sách task

### Track A — Config & Model Rename

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| A1 | Cập nhật `config::pins` trong `include/config.h` | Xóa `PIN_RELAY_HEATER_1`, `PIN_RELAY_HEATER_2`, `PIN_ONE_WIRE`. Thêm `PIN_RELAY_HWAT = 12`, `PIN_RELAY_LAMP_1 = 13`, `PIN_RELAY_LAMP_2 = 14`. Comment tiếng Việt ngắn cho từng constant. Không sửa các constexpr khác. |
| A2 | Đổi tên trường `HAir → HLamp` trong `FuzzyController::DualHeaterOutputsPod` | Sửa `include/FuzzyController.h` (struct + docstring rule). Grep toàn repo, đổi tên chỉ trong file thuộc namespace `FuzzyController` và `AdaptiveTuner`. |
| A3 | Đổi tên trường `HAir → HLamp` trong `FuzzyController::ArbitratedOutputsPod` | Sửa `include/FuzzyController.h`. Comment trong header cập nhật ngữ nghĩa "HLamp = tổng duty demand cho 2 bóng đèn nhiệt". |
| A4 | Đổi tên `gain_HAir → gain_HLamp` trong `AdaptiveTuner::GainsPod` | Sửa `include/AdaptiveTuner.h` + `src/AdaptiveTuner.cpp`. Docstring nêu rõ gain áp dụng cho cụm 2 bóng, không phải per-bulb. Giữ nguyên công thức toán (integral loop, clamp 0.5..2.5). |
| A5 | Thay `TpcChannelState HAir` bằng `TpcChannelState Lamp_1, Lamp_2` trong `TpcSchedulerState` | Sửa `include/TPC_Task.h`. Thứ tự trường: `{Lamp_1, Lamp_2, HWat, Mist, Exh}` — giữ 16-byte alignment ổn định. |

### Track B — Fuzzy & TPC Logic

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| B1 | Rewrite `executeDualHeaterRules()` trong `src/FuzzyController.cpp` | Output `HLamp = cold * (1.0f - wet)` (thay cho HAir cũ). Rule "cold & wet" vẫn set `HWat = cold * wet`. Không tách thành 2 bóng ở tầng này — fuzzy chỉ sinh 1 duty. |
| B2 | Rewrite `arbitrateOutputs()` để dùng `gain_HLamp` | Thay `outputs.HAir = safeUnit(thermalOutputs.HAir) * safeGain(gains.gain_HAir)` bằng phiên bản `HLamp`. Kiểm tra `safeUnit` clamp `[0, 1]` vẫn áp dụng. |
| B3 | Sửa `hardwareProtectionOverride()` trong `TPC_Task.cpp` | Comment cập nhật: blackout chỉ ép `HWat` và `Mist` về 0. `HLamp` được phép chạy trong blackout (đèn không gây rủi ro biosafety). Không sửa logic. |
| B4 | Thêm helper `dispatchLampDemand(float hLampDuty, float& duty_lamp_1, float& duty_lamp_2)` trong `TPC_Task.cpp` (anonymous namespace) | Rule: `duty <= 0` → cả hai 0. `0 < duty <= 0.5` → `duty_lamp_1 = duty * 2.0f`, `duty_lamp_2 = 0`. `duty > 0.5` → `duty_lamp_1 = 1.0f`, `duty_lamp_2 = (duty - 0.5f) * 2.0f`. Clamp final ở `[0, 1]`. Pure function, unit-testable. |
| B5 | Sửa `applyTpcOutputs()` để phát 2 kênh Lamp | Signature mở rộng thêm `TpcChannelConfig lamp1Config, lamp2Config` thay cho `hAirConfig`. Gọi `dispatchLampDemand(outputs.HLamp, l1, l2)`, sau đó `updateTpcChannel(lamp1Config, state.Lamp_1, l1)` và `updateTpcChannel(lamp2Config, state.Lamp_2, l2)`. Giữ nguyên gọi cho HWat/Mist/Exh. |
| B6 | Cập nhật cấu hình TPC trong `src/core1_tasks.cpp` | Thay `H_AIR_TPC_CONFIG` bằng `LAMP_1_TPC_CONFIG` (pin `PIN_RELAY_LAMP_1`, window 300000, min_on 10000, min_off 10000, offset 0) và `LAMP_2_TPC_CONFIG` (pin `PIN_RELAY_LAMP_2`, cùng window/min, offset 5000 để tránh bật đồng thời khi cùng chuyển từ OFF→ON). `H_WAT_TPC_CONFIG` giữ nguyên chân đổi sang `PIN_RELAY_HWAT`, offset 3000 giữ nguyên. |
| B7 | Cập nhật `actuatorSnapshot` trong `runControlPipelineStep()` | `RelayOutputsPod` mở rộng: thêm `heater_lamp1_active`, `heater_lamp2_active`; bỏ `heater_air_active`. Cập nhật `include/models.h` tương ứng, giữ `__attribute__((aligned(4)))` và padding cho tổng size chia hết 4 byte. |
| B8 | Cập nhật `SharedSystemState` trong `include/definitions.h` | Thay `h_air_duty` bằng `h_lamp_duty`; giữ `h_wat_duty`, `mist_duty`, `exhaust_duty`. Cập nhật khởi tạo `shared_systemState` trong `core1_tasks.cpp`. |

### Track C — Actuators & Boot

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| C1 | Cập nhật `VALID_RELAY_PINS[]` trong `src/actuators.cpp` | Whitelist mới: `{PIN_RELAY_MIST, PIN_RELAY_FAN, PIN_RELAY_HWAT, PIN_RELAY_LAMP_1, PIN_RELAY_LAMP_2}`. Cập nhật hàm `relay_name()` tương ứng: `"HWAT"`, `"LAMP_1"`, `"LAMP_2"`. |
| C2 | Cập nhật `init_actuators_gpio()` để init 5 chân | Giữ pattern `pinMode(OUTPUT) → digitalWrite(LOW)`. Log tiếng Việt/Anh format nhất quán. Fail-safe LOW là mandatory trước khi tạo task Core 1. |
| C3 | Cập nhật log reject trong `set_relay_state()` | Danh sách allowed pins in ra 5 phần tử. |

### Track D — UI & Telemetry Labels

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| D1 | Cập nhật `src/WebInterface.cpp` | Đổi "Air Heater (HAir)" → "Heat Lamp (HLamp)". Nếu có thêm block hiển thị dedicate cho từng bóng, chỉ hiển thị tổng duty `h_lamp_duty` (không tách 2 bóng ở UI Sprint 1 — Sprint 2 mới thêm chi tiết). |
| D2 | Cập nhật `src/Telemetry.cpp` (nếu có key riêng `HAir`) | Grep `HAir`/`h_air` trong `Telemetry.cpp` và `Telemetry.h`. Rename sang `HLamp`/`h_lamp`. Tăng minor version của payload schema nếu payload có trường `schema_version`. |
| D3 | Cập nhật `mqtt_client.cpp` nếu có command dispatch `hair_*` | Grep `hair`, `HAir` case-sensitive. Rename tất cả. Cấm để tồn tại 2 tên song song. |

### Track E — Tests & Boot Wiring

| Task ID | Mô tả | Chỉ thị chi tiết |
|---------|-------|------------------|
| E1 | Cập nhật `test/run_tests.cpp:851` | Assertion `set_relay_state(PIN_ONE_WIRE, true) == false` đổi thành `set_relay_state(21, true) == false` (GPIO 21 không nằm whitelist mới). Comment giải thích test là "reject invalid pin". |
| E2 | Thêm unit test `test_dispatch_lamp_demand()` | 5 case: `-0.1`, `0.0`, `0.25`, `0.5`, `0.75`, `1.0`. Assert cặp `(duty_lamp_1, duty_lamp_2)` = `(0,0)`, `(0,0)`, `(0.5,0)`, `(1.0,0)`, `(1.0,0.5)`, `(1.0,1.0)`. Test nằm trong `test/run_tests.cpp` gần các test TPC khác. |
| E3 | Thêm unit test `test_fuzzy_hlamp_semantics()` | Case cold=1.0 dry=1.0 → HLamp cao, HWat = 0. Case cold=1.0 wet=1.0 → HLamp = 0, HWat cao. Đảm bảo tách kênh không bị regress khi rename. |
| E4 | Chạy `pio test -e native` end-to-end | Tất cả test PASS, kể cả các test cũ. Nếu có test fail do rename, fix rename chứ không sửa oracle. |
| E5 | Chạy `pio run -e otg` (compile only) và `pio run -e uart` | Ép compile pass trước khi merge. Không upload trong sprint này. |

## Definition of Done

- `grep -rn "HAir\|gain_HAir\|PIN_RELAY_HEATER\|PIN_ONE_WIRE\|h_air_duty\|heater_air_active"` trong `src/`, `include/`, `test/` không còn hit.
- `pio test -e native` PASS 100%.
- `pio run -e otg` và `pio run -e uart` build sạch (không warning liên quan rename).
- `shared_systemState` khởi tạo với `h_lamp_duty` mặc định 0.0f.
- File `HARDWARE_DEPLOYMENT.md` được cập nhật: whitelist relay {10,11,12,13,14} và bắt buộc pull-down 10 kΩ trên cả GPIO 14.

## Rủi ro & Mitigation

- **Rủi ro:** GPIO 14 trên một số biến thể ESP32-S3 dev kit có LED debug — có thể nhấp nháy khi boot. **Mitigation:** đã có external pull-down 10 kΩ theo HW_DEPLOYMENT; đo đường boot ~2s vẫn LOW.
- **Rủi ro:** Rename lan rộng có thể sót ở comment/docstring. **Mitigation:** Task cuối cùng grep toàn repo và fail sprint nếu còn dấu vết `HAir`.
- **Rủi ro:** Test `run_tests.cpp:851` phụ thuộc `PIN_ONE_WIRE` — nếu quên đổi sẽ fail compile. **Mitigation:** đã liệt kê rõ ở task E1.
