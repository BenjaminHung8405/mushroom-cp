# Nhật Ký Thực Thi — Manual Cabinet Controls + UART LED Display

> Ghi log theo thứ tự thời gian đảo ngược (bản ghi mới nhất ở đầu).

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

