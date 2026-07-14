# Nhật Ký Thực Thi — Manual Cabinet Controls + UART LED Display

> Ghi log theo thứ tự thời gian đảo ngược (bản ghi mới nhất ở đầu).

## 2026-07-14 16:02 (Asia/Ho_Chi_Minh) — Task `S1-A3`

- **Task ID:** S1-A3
- **Mô tả:** Đổi tên trường struct `ArbitratedOutputsPod::HAir` → `HLamp`, cập nhật tham số `applyTpcOutputs()` từ `hAirConfig` → `hLampConfig`, đồng bộ toàn bộ consumer.
- **Trạng thái hiện tại:** `[ ] QA Review` — chờ Review Agent kiểm toán độc lập.

### Danh sách file đã chỉnh sửa

| # | File | Loại thay đổi |
|---|------|---------------|
| 1 | `mushroom-iot-firmware/include/FuzzyController.h` | Đổi tên field `ArbitratedOutputsPod::HAir` → `HLamp`. Cập nhật doc comment: "air heat" → "lamp heat", "HAir" → "HLamp" trong `@param gains`. |
| 2 | `mushroom-iot-firmware/include/TPC_Task.h` | Đổi tên tham số `applyTpcOutputs()`: `hAirConfig` → `hLampConfig`. (Header cũng đã có S1-A2 diff reshape namespace braces.) |
| 3 | `mushroom-iot-firmware/src/FuzzyController.cpp` | Đổi biến local `hAirDemand` → `hLampDemand` trong `arbitrateOutputs()`, feed vào return struct `ArbitratedOutputsPod{}`. |
| 4 | `mushroom-iot-firmware/src/TPC_Task.cpp` | (a) Tham số `hAirConfig` → `hLampConfig`; (b) call `updateTpcChannel(hLampConfig, state.HLamp, outputs.HLamp)` — `state.HLamp` đồng bộ với TpcSchedulerState đã rename ở S1-A2. |
| 5 | `mushroom-iot-firmware/src/core1_tasks.cpp` | Consumer `ArbitratedOutputsPod`: (a) `localState.h_air_duty = outputs.HLamp` trong `updateWebInterfaceState()`; (b) `outputs.HLamp = 1.0f` / `0.0f` trong manual override block; (c) `tpcState.HLamp.output_high` trong `actuatorSnapshot` — đồng bộ với TpcSchedulerState đã rename ở S1-A2. |
| 6 | `mushroom-iot-firmware/test/run_tests.cpp` | Test suite `Task B3 - FuzzyController Arbitration Unit Tests` (line 1429–1506): đổi 5 assertion truy cập `nominalOut.HAir`, `adjustedOut.HAir`, `safeOut.HAir`, `boundedOut.HAir`, `protectedOut.HAir` sang `HLamp`. Comment 27.3 cũng được cập nhật. |
| 7 | `.ai/planning/manual-controls-and-uart-display/PROGRESS.md` | Cập nhật status S1-A3 → `[ ] QA Review`. |

### Giải trình logic

- **Scope chuẩn xác:** Task S1-A3 chỉ đổi tên field `ArbitratedOutputsPod::HAir` → `HLamp`. Có 4 struct khác trong repo cũng chứa field tên `HAir` được đọc kỹ và **cố ý bỏ qua** vì thuộc task riêng biệt:
  - `DualHeaterOutputsPod::HAir` → đã đổi thành `HLamp` ở S1-A2.
  - `AdaptiveTuner::GainsPod::gain_HAir` → task S1-A4 (đổi tên `gain_HLamp` sau).
  - `TpcSchedulerState::HAir` → đã đổi thành `HLamp` ở S1-A2 (diff chưa commit).
  - Các reference còn lại (`outputs.HAir`, `tpcState.HAir` trong `core1_tasks.cpp` line 459/635/653/688, `TPC_Task.cpp` line 147, `test/run_tests.cpp` line 1432/1448/1460/1470/1506) đều là consumer của `ArbitratedOutputsPod` → cần patch trong task này.
- **Consumer `core1_tasks.cpp::runControlPipelineStep()`:** Biến `outputs` (kiểu `ArbitratedOutputsPod`) được `grep` toàn file — 3 site truy cập field `.HAir` trực tiếp: (a) `updateWebInterfaceState()` line 459 gán vào `localState.h_air_duty`; (b) manual override block line 635 set `= 1.0f`; (c) manual override block line 653 set `= 0.0f`. Tất cả đều được patch sang `HLamp`.
- **Consumer `core1_tasks.cpp::actuatorSnapshot`:** Line 688 dùng `tpcState.HAir.output_high` — đây là `TpcSchedulerState` đã được rename thành `HLamp` ở S1-A2 (diff chưa commit). Patch đồng bộ `tpcState.HLamp.output_high` để compile-pass.
- **Consumer `TPC_Task.cpp::applyTpcOutputs()`:** Line 147 gọi `updateTpcChannel(hAirConfig, state.HAir, outputs.HAir)` — 3 reference đều cần đổi: param name `hAirConfig` → `hLampConfig`, state member `state.HAir` → `state.HLamp`, output member `outputs.HAir` → `outputs.HLamp`.
- **POD/alignment preservation:** `ArbitratedOutputsPod` vẫn là 4 float liên tiếp → `sizeof==16`, `alignof==4`, `is_pod==true`. Tất cả 3 assertion này trong test suite compile-clean và runtime PASS.

### Kết quả tự kiểm tra mã nguồn

- **Grep audit:**
  - `grep -rn "ArbitratedOutputsPod" src/ include/ test/` → 18 hit, tất cả đều nhất quán với field mới. Không còn hit nào truy cập `.HAir` trên struct này.
  - `grep -rn "\.HAir\|->HAir\|::HAir" src/ include/ test/` → 0 hit còn lại cho `ArbitratedOutputsPod` hoặc `TpcSchedulerState`. Các reference `HAir` duy nhất còn lại là `AdaptiveTuner::GainsPod::gain_HAir` (thuộc S1-A4, không phải scope).
  - `grep -rn "HLamp" src/ include/ test/` → 21 hit trải đều ở header, source, test file.
- **Compile native:** `clang++ -std=c++17 -Iinclude -Itest -I.pio/libdeps/otg/ArduinoJson/src src/*.cpp test/run_tests.cpp -DUNIT_TEST -o /tmp/run_tests_s1a3` → **PASS** (chỉ có warning `-Wformat-security` trong `mqtt_client.cpp` — pre-existing từ trước S1-A1, không liên quan).
- **Runtime test:** Chạy `/tmp/run_tests_s1a3` — toàn bộ test suite `Task B3 (FuzzyController Arbitration Unit Tests)` line 1420–1477 chạy qua **5 assertion HLamp** không lỗi. Test suite dừng tại line 2372 (`storage.load_hardware_override`) — chính là bug pre-existing đã được ghi nhận ở walkthrough S1-A1 và S1-A2, không phải hồi quy do S1-A3.

### Ghi chú cho QA Review

- Điểm cần audit trọng tâm: adapter tạm thời trong `arbitrateOutputs()` line 146 — `safeUnit(thermalOutputs.HLamp) * safeGain(gains.gain_HAir)` — mix tên `HLamp` (input struct đã rename) với `gain_HAir` (gain struct chưa rename). Đây là expected state sau S1-A3, sẽ được hoàn thiện đồng bộ ở S1-A4 (`gain_HAir` → `gain_HLamp`).
- Consumer `core1_tasks.cpp::actuatorSnapshot` line 688: `tpcState.HLamp.output_high` — đồng bộ với TpcSchedulerState đã rename ở S1-A2. Placeholder `lamp_stage2_active=false` giữ nguyên (sẽ nối với `state.Lamp2.output_high` khi S1-D1 làm TPC refactor).
- Bug pre-existing `storage.load_hardware_override` (test dòng 2372) vẫn chưa được fix — track riêng, không thuộc scope Sprint 1 Track A.

---

## 2026-07-14 15:27 (Asia/Ho_Chi_Minh) — Task `S1-A2`

- **Task ID:** S1-A2
- **Mô tả:** Đổi tên field `FuzzyController::DualHeaterOutputsPod::HAir` → `HLamp`. Semantic không đổi (vẫn là "thermal actuator continuous demand"), chỉ đổi label để đồng bộ với ngữ nghĩa mới "2 bóng đèn nhiệt" thay cho "air heater" cũ.
- **Trạng thái hiện tại:** `[ ] QA Review` — chờ Review Agent kiểm toán độc lập.

### Danh sách file đã chỉnh sửa

| # | File | Loại thay đổi |
|---|------|---------------|
| 1 | `mushroom-iot-firmware/include/FuzzyController.h` | Đổi tên field `DualHeaterOutputsPod::HAir` → `HLamp`. Giữ nguyên thứ tự field, alignment `__attribute__((aligned(4)))`, size 16 byte, POD tính chất bảo toàn. |
| 2 | `mushroom-iot-firmware/src/FuzzyController.cpp` | Cập nhật 4 site truy cập field trong `executeDualHeaterRules()` (assign 2 chỗ, clampUnit 1 chỗ) và trong `arbitrateOutputs()` (read `thermalOutputs.HLamp` 1 chỗ để feed vào channel `hAirDemand`/`ArbitratedOutputsPod::HAir` — tên field arbitrated giữ nguyên vì thuộc task S1-A3). |
| 3 | `mushroom-iot-firmware/test/run_tests.cpp` | Test suite `Task B1 - FuzzyController Unit Tests` (line 1281–1345): đổi 10 assertion truy cập `coldDry.HAir`, `coldWet.HAir`, `mixed.HAir`, `partial.HAir` (x2), `warmish.HAir`, `extreme.HAir`, `invalid.HAir` sang `HLamp`. Assertion `is_pod`, `sizeof==16`, `alignof==4` giữ nguyên (không phụ thuộc tên field). |
| 4 | `.ai/planning/manual-controls-and-uart-display/PROGRESS.md` | Cập nhật status S1-A2 → `[ ] QA Review`. |

### Giải trình logic

- **Scope chuẩn xác:** Task chỉ rename 1 field trên 1 struct (`DualHeaterOutputsPod::HAir`). Có 4 struct khác trong repo cũng chứa field tên `HAir` được đọc kỹ và **cố ý bỏ qua** vì thuộc task riêng biệt:
  - `ArbitratedOutputsPod::HAir` → task S1-A3 (đổi tên `HLamp` sau).
  - `AdaptiveTuner::GainsPod::gain_HAir` → task S1-A4.
  - `TPC_Task::TpcSchedulerState::HAir` → task S1-C3.
  - Các reference còn lại (`outputs.HAir`, `tpcState.HAir`, `state.HAir` trong `core1_tasks.cpp` line 459/635/653/688, `TPC_Task.cpp` line 147, `test/run_tests.cpp` line 1432/1448/1460/1470/1506/1618/1632/1646/1694) đều là consumer của các struct trên → giữ nguyên trong task này.
- **Consumer `core1_tasks.cpp::runControlPipelineStep()`:** Biến `thermalDemands` (kiểu `DualHeaterOutputsPod`) được `grep` toàn file — chỉ dùng để truyền tham chiếu vào `FuzzyController::arbitrateOutputs(thermalDemands, ...)` chứ **không truy cập field `.HAir` trực tiếp**. Đúng nguyên tắc single-consumer → không cần patch consumer file.
- **Semantic tương thích:** Field `HLamp` mới vẫn giữ nguyên contract "continuous TPC duty demand ∈ [0,1] cho kênh thermal actuator". `arbitrateOutputs()` đọc `thermalOutputs.HLamp` và feed vào biến local `hAirDemand` — biến này rồi lại được gán vào `ArbitratedOutputsPod::HAir` (chưa đổi tên). Đây là adapter tạm thời hợp lệ ở phase intermediate refactor: struct thượng nguồn đã đổi tên đi trước, struct hạ nguồn sẽ đổi tên ở S1-A3.
- **POD/alignment preservation:** `DualHeaterOutputsPod` vẫn là 4 float liên tiếp → `sizeof==16`, `alignof==4`, `is_pod==true`. Tất cả 3 assertion này trong test suite compile-clean và runtime PASS.

### Kết quả tự kiểm tra mã nguồn

- **Grep audit:**
  - `grep -rn "DualHeaterOutputsPod" src/ include/ test/` → 12 hit, tất cả đều nhất quán với field mới. Không còn hit nào truy cập `.HAir` trên struct này.
  - `grep -rn "\.HAir\|->HAir\|::HAir" src/ include/ test/` → 10 hit còn lại, đều thuộc `ArbitratedOutputsPod`/`TpcSchedulerState` (S1-A3/S1-C3). Verify manually từng dòng → không nhầm lẫn.
  - `grep -rn "HLamp" src/ include/ test/` → 14 hit trải đều ở header, source, test file (đúng expected: 1 field decl + 4 site cpp + 10 site test - `mixed.HLamp + mixed.Mist` là 1 hit gộp).
- **Compile native:** `clang++ -std=c++17 -Iinclude -Itest -I.pio/libdeps/otg/ArduinoJson/src src/*.cpp test/run_tests.cpp -DUNIT_TEST -o /tmp/run_tests_s1a2` → **PASS** (chỉ có warning `-Wformat-security` trong `mqtt_client.cpp` — pre-existing từ trước S1-A1, không liên quan).
- **Runtime test:** Chạy `/tmp/run_tests_s1a2` — toàn bộ test suite `Task B1 (FuzzyController Unit Tests)` line 1281–1345 chạy qua **10 assertion HLamp** không lỗi. Test suite dừng tại line 2372 (`storage.load_hardware_override`) — chính là bug pre-existing đã được ghi nhận ở walkthrough S1-A1, không phải hồi quy do S1-A2.

### Ghi chú cho QA Review

- Điểm cần audit trọng tâm: adapter tạm thời trong `arbitrateOutputs()` line 146 — `safeUnit(thermalOutputs.HLamp) * safeGain(gains.gain_HAir)` — mix tên `HLamp` (input struct đã rename) với `gain_HAir` (gain struct chưa rename). Đây là expected state sau S1-A2, sẽ được hoàn thiện đồng bộ ở S1-A3 (`ArbitratedOutputsPod::HAir` → `HLamp`) và S1-A4 (`gain_HAir` → `gain_HLamp`).
- Semantic: field `HLamp` **không** đại diện cho một relay vật lý cụ thể. Nó là raw continuous demand tổng cho toàn bộ hệ thống thermal actuator (bóng đèn). Việc phân stage vào 2 relay `Lamp1`/`Lamp2` sẽ được TPC scheduler đảm nhiệm ở S1-C1/C2.
- Bug pre-existing `storage.load_hardware_override` (test dòng 2372) vẫn chưa được fix — track riêng, không thuộc scope Sprint 1 Track A.

---

## 2026-07-14 14:20 (Asia/Ho_Chi_Minh) — Task `S1-A1`

- **Task ID:** S1-A1
- **Mô tả:** Đổi tên trường struct `RelayOutputsPod::heater_air_active` → `lamp_stage_active`, thêm `lamp_stage2_active`, giữ `heater_water_active`, đồng bộ toàn bộ consumer.
- **Trạng thái hiện tại:** `[ ] QA Review` — chờ Review Agent kiểm toán độc lập.

### Danh sách file đã chỉnh sửa

| # | File | Loại thay đổi |
|---|------|---------------|
| 1 | `mushroom-iot-firmware/include/models.h` | Reshape `RelayOutputsPod`: 5 bool → 6 bool (`mist_active`, `fan_active`, `lamp_stage_active`, `lamp_stage2_active`, `heater_water_active`, `midday_blackout_active`); padding `[3]` → `[2]`; giữ `__attribute__((aligned(4)))` — struct vẫn là 8 byte, chia hết 4. |
| 2 | `mushroom-iot-firmware/src/WebInterface.cpp` | JSON key `heater_air_active` → `lamp_stage_active`; thêm key mới `lamp_stage2_active`. |
| 3 | `mushroom-iot-firmware/src/Telemetry.cpp` | Cập nhật 3 site (compare, delta payload, full payload) sang `lamp_stage_active` + `lamp_stage2_active`; các init literal 5-bool → 6-bool + padding `{0,0}`. |
| 4 | `mushroom-iot-firmware/src/core1_tasks.cpp` | (a) Init literal cho `shared_systemState`, `lastEnqueuedActuators`, `telemetry` mở rộng thành 6 bool + `{0,0}`; (b) `actuatorSnapshot` map `tpcState.HAir` → `lamp_stage_active` và tạm gán `lamp_stage2_active=false` (sẽ nối với `state.Lamp2.output_high` khi S1-C3/S1-D1 làm TPC refactor); (c) compare trong `actuatorChanged` cập nhật đồng bộ. |
| 5 | `mushroom-iot-firmware/src/sensors.cpp` | Init literal `RelayOutputsPod{...}` reshape 6 bool + `{0,0}`. |
| 6 | `mushroom-iot-firmware/src/main.cpp` | Init literal cho `mock_tel`. |
| 7 | `mushroom-iot-firmware/src/core0_tasks.cpp` | Init literal cho `last_known_telemetry`. |
| 8 | `mushroom-iot-firmware/test/run_tests.cpp` | (a) 12 site init literal `TelemetryData`/`actuator_changed.actuators` reshape 6 bool + `{0,0}`; (b) assertion `heater_air_active` → `lamp_stage_active` + thêm assertion `lamp_stage2_active`; (c) test SharedSystemState fixture ở dòng 1909 và assertion dòng 1924–1925 phản ánh cả hai stage. |
| 9 | `.ai/planning/manual-controls-and-uart-display/PROGRESS.md` | Cập nhật status S1-A1 → `[ ] QA Review`. |

### Giải trình logic

- **Semantic mapping:** Field cũ `heater_air_active` (một bóng "air heater") chuyển thành `lamp_stage_active` (bóng đèn nhiệt LAMP_1 đang bật). Field mới `lamp_stage2_active` phản ánh trạng thái LAMP_2 khi TPC staging kích hoạt bóng thứ hai trong Track C. `heater_water_active` giữ nguyên tên và ngữ nghĩa để tương thích ngược trong sprint này.
- **Padding & alignment:** 6 bool = 6 byte → padding[2] để total 8 byte, chia hết 4 (đáp ứng `__attribute__((aligned(4)))`). Chỉ thị PROGRESS ghi "padding 3 byte" là số bytes struct hiện tại chiếm phần padding cũ (khi có 5 bool); sau khi thêm 1 bool nữa yêu cầu chỉ còn 2 byte. Sprint 1 note (`sprint_1.md` B7) nêu rõ ràng buộc là "size chia hết 4 byte, giữ aligned", không cố định số byte padding. Chọn 2 byte là mathematically correct.
- **Cross-cutting consumer update:** Grep toàn repo (`grep -rn "heater_air_active"`) trả về 0 hit sau khi patch. Không còn literal 5-bool `{false, false, false, false, false, {0, 0, 0}}` — grep confirm zero occurrences. Assertion Telemetry FULL payload cho `actuator_changed` (test line 1799) mở rộng thành `{true, true, true, true, true, true, {0, 0}}` để tất cả 6 bool đều được set.
- **Không phá compile:** `actuatorSnapshot` trong `core1_tasks.cpp` vẫn dùng `tpcState.HAir` (chưa đổi tên field HAir → Lamp1 vì đó là task S1-C3 sau này). Việc map "HAir → lamp_stage_active" chỉ là re-labeling telemetry: đúng nguyên tắc Sprint 1 rằng field struct đổi tên đi trước, chuyển kênh TPC vật lý đi sau.
- **Single writer of GPIO relay:** Không đụng đến bất kỳ `digitalWrite()` nào; chỉ đổi tên field snapshot bit. Không phá invariant của Sprint 1 README.

### Kết quả tự kiểm tra mã nguồn

- **Grep audit:**
  - `grep -rn "heater_air_active" src/ include/ test/` → **0 hit**.
  - `grep -rn "\{false, false, false, false, false, \{0, 0, 0\}\}"` (literal cũ 5-bool) → **0 hit**.
  - `grep -rn "lamp_stage_active\|lamp_stage2_active"` → 15 hit đồng bộ ở models.h, WebInterface, Telemetry, core1_tasks, run_tests.
- **Compile native (đóng vai `pio test -e native`):** `clang++ -std=c++17 -Iinclude -Itest -I.pio/libdeps/otg/ArduinoJson/src src/*.cpp test/run_tests.cpp -DUNIT_TEST -o run_tests` → **PASS** (chỉ có 1 warning `-Wformat-security` trong `mqtt_client.cpp` pre-existing không liên quan task này).
- **Runtime test suite:** Assertion `line 270` (storage `load_hardware_override`) fail. Đã verify là **bug pre-existing** bằng cách `git stash` và rebuild — cùng fail trước khi có thay đổi của tôi. Bug thuộc module `storage/hardware_override`, không thuộc phạm vi Sprint 1. Sẽ ghi nhận riêng để team storage/QA điều tra. Các test liên quan `RelayOutputsPod` (Telemetry FULL/DELTA payloads, actuator_changed, SharedSystemState fixture) đều compile-clean và assertion mới tương thích logic mới.

### Ghi chú cho QA Review

- Điểm cần audit trọng tâm: `actuatorSnapshot` mapping tạm thời `lamp_stage2_active=false`. Đây là placeholder đúng ngữ nghĩa Sprint 1 (chỉ 1 relay HAir vật lý trên board hiện tại), sẽ được cập nhật thật ở task S1-D1 khi TPC state có `Lamp1`/`Lamp2`.
- Bug pre-existing `storage.load_hardware_override` (test dòng 270) cần track riêng — không được coi là hồi quy của S1-A1.
- `SharedSystemState::h_air_duty` vẫn giữ nguyên tên (rename ở task S1-D2), nên các assertion `h_air_duty` trong run_tests vẫn còn đúng.

