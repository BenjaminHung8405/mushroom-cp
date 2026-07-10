# PROGRESS.md

## Started
- **Thời gian bắt đầu**: 2026-07-10T15:24:05+07:00
- **Cập nhật lần cuối**: 2026-07-10T15:24:05+07:00
- **Agent thực thi**: Gemini
- **Agent rà soát / khởi tạo PROGRESS**: Claude (Senior Solution Architect)

## Reference Plan
- **Thư mục kế hoạch**: [setup-sht30-driver-integration](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/setup-sht30-driver-integration/)
- **Sprints tham chiếu**:
  1. [sprint_1.md (PlatformIO & Include Driver SHT30) — ❌ NEXT TO DO](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/setup-sht30-driver-integration/sprint_1.md)
  2. [sprint_2.md (Real I2C Driver & Heater State Machine) — ❌ LATER](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/setup-sht30-driver-integration/sprint_2.md)
  3. [sprint_3.md (Host Unit Test & Hardware Validation) — ❌ LATER](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/setup-sht30-driver-integration/sprint_3.md)

## Addition Plan
- **Yêu cầu phát sinh**: Chưa có
- **Ghi chú kiến trúc (từ plan gốc)**:
  - Giữ nguyên public API namespace `sensors` (`init_sensors_placeholder`, `read_sht30`, `read_all_telemetry`) — chỉ thay implementation trong `#ifndef UNIT_TEST`
  - Heater state machine dùng `static` local trong `read_sht30()` — cấm thêm global state mới
  - I2C clock ghim **50 kHz** (dây dài + đầu dò kim loại); địa chỉ mặc định **0x44**
  - Khi `is_heating == true` → `temp = NAN` (khóa actuator downstream, không fallback 0°C)

## Tracks Progress

---

### SPRINT 1: CẤU HÌNH PLATFORMIO & INCLUDE DRIVER SHT30 — ❌ NEXT TO DO
> Prerequisite: Baseline firmware build pass · Không đụng logic nghiệp vụ

#### Track A: Cấu hình Build System (PlatformIO)
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| A1 | Thêm `adafruit/Adafruit SHT31 Library` vào `lib_deps` trong `platformio.ini` | [ ] QA Review | - **Phiên bản tối thiểu**: Ghim `adafruit/Adafruit SHT31 Library @ ^2.2.2` — phiên bản `< 2.2` có bug `readTemperature()` trả giá trị âm sai trên ESP32-S3 PSRAM.<br>- **Vị trí**: Thêm vào khối `lib_deps` của `[env:base]` (khoảng dòng 53), thụt lề 4 spaces đồng nhất với các dep hiện có.<br>- **Không đụng logic**: Sprint này **chỉ** sửa `platformio.ini` — cấm sửa `sensors.cpp` / `sensors.h`.<br>- **Chống xung đột Wire**: Không redefine `#include <Wire.h>` ở bất kỳ file nào; Adafruit SHT31 phụ thuộc ESP32 Core Wire.<br>- **File**: `mushroom-iot-firmware/platformio.ini`. |
| A2 | Verify build success (`pio run`) — linker resolve symbol SHT31 | [ ] QA Review | - **Gate bắt buộc**: `cd mushroom-iot-firmware && pio run` phải pass 0 error / 0 warning mới so với baseline.<br>- **Checklist linker**: Resolve được `Adafruit_SHT31::begin(uint8_t)` và `Adafruit_SHT31::readTemperature()`; lib xuất hiện trong `.piolibdeps/`.<br>- **Flash budget**: Binary sau thêm lib **≤ 1 MB** partition (baseline ~400 KB, margin > 600 KB). Nếu vượt → escalate, không silent accept.<br>- **Tech debt**: Không pin version bằng commit hash / git URL; chỉ dùng PlatformIO Registry semver. |

---

### SPRINT 2: THAY THẾ MOCK DRIVER BẰNG REAL I2C & HEATER STATE MACHINE — ❌ LATER
> Prerequisite: Sprint 1 A1+A2 Done · Interface public `sensors` không đổi

#### Track B: Include & Khai báo Đối tượng Phần cứng
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| B1 | Thêm include `Wire.h` / `Adafruit_SHT31.h` + static object `sht30` (bao bởi `#ifndef UNIT_TEST`) | [ ] QA Review | - **HAL isolation pattern**: Mọi include HW-dependent **bắt buộc** bọc `#ifndef UNIT_TEST` … `#endif` ngay sau `#include "sensors.h"`. Host g++ không có Wire/Adafruit → fail compile nếu rò rỉ.<br>- **Static object**: `static Adafruit_SHT31 sht30 = Adafruit_SHT31();` đặt sau các static flag hiện tại (`scd30_last_error`). Scope file-private — cấm global / header export.<br>- **Public API bất biến**: `include/sensors.h` **không** thêm declaration mới. Giữ nguyên signature, enum `SensorError`, fault-injection getters/setters.<br>- **Naming**: `snake_case` biến/hàm, không PascalCase cho local static.<br>- **Files**: `mushroom-iot-firmware/src/sensors.cpp` (sửa), `include/sensors.h` (không đổi). |

#### Track C: Khởi tạo I2C Bus & SHT30
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| C1 | Cập nhật `init_sensors_placeholder()` — real I2C init trong `#ifndef UNIT_TEST` | [ ] QA Review | - **Thứ tự init cứng (fail-fast)**: (1) log init → (2) `Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 50000)` → (3) check return, fail → `sht30_healthy=false; return false` → (4) `Wire.setWireTimeout(3000, true)` — auto-reset bus treo → (5) `sht30.begin(0x44)` probe ACK → (6) fail → healthy=false → (7) `sht30.heater(false)` đảm bảo OFF cold-start → (8) `sensors_initialized=true`, `sht30_healthy=true`.<br>- **Cấm magic pin**: Chỉ dùng `config::pins::PIN_I2C_SDA` / `PIN_I2C_SCL` — **nghiêm cấm** hardcode `8`/`9` trong `sensors.cpp`.<br>- **I2C clock ≤ 50 kHz**: Không được tăng 100/400 kHz — dây dài + đầu dò kim loại méo xung.<br>- **UNIT_TEST branch**: Khối `#else` giữ nguyên mock (set flags = true), **không** gọi Wire/sht30.<br>- **No blocking**: Cấm `delay()` / `while` busy-wait trong init.<br>- **File**: `mushroom-iot-firmware/src/sensors.cpp`. |

#### Track D: Real Driver `read_sht30()` & Heater State Machine
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| D1 | Thay thế logic sine/cosine mock bằng đọc I2C thực tế trong `read_sht30()` | [ ] Pending | - **Guard clause giữ nguyên**: 2 check đầu `!sensors_initialized` / `!sht30_healthy` **không** refactor — fail path trả `false` + `temp=NAN`, `hum=NAN` + error code tương ứng.<br>- **Real read path (`#ifndef UNIT_TEST`)**: `temp = sht30.readTemperature(); hum = sht30.readHumidity();` → `if (isnan(temp) \|\| isnan(hum))` set `ERR_CRC_MISMATCH`, return false.<br>- **Error contract**: Fail → `false` + NAN outputs + cập nhật `sht30_last_error`. Không throw, không crash.<br>- **UNIT_TEST branch**: Khối `#else` **giữ nguyên 100%** sine/cosine mock — zero regression host tests (Sprint 3 E1 phụ thuộc).<br>- **No blocking I/O pattern**: Cấm `delay()` trong read path; I2C transaction là blocking ngắn chấp nhận được, không thêm retry loop busy.<br>- **File**: `mushroom-iot-firmware/src/sensors.cpp` → `read_sht30()`. |
| D2 | Implement Heater State Machine hysteresis (non-blocking `millis()`) | [ ] Pending | - **4 static local only** (cấm global mới): `humidity_saturated_start`, `heat_start_time`, `is_heating` (+ timer logic). Pattern giống baseline — không thêm class/struct state.<br>- **Nhánh `!is_heating`**: `hum >= 99.0f` → start/continue saturation timer; `elapsed > 600000UL` (10 phút) → `sht30.heater(true)`, `is_heating=true`, log WARNING. `hum < 99.0f` → reset timer = 0 (hysteresis cooldown bắt buộc trước khi bật lại).<br>- **Nhánh `is_heating`**: **Luôn** `temp = NAN` (khóa fuzzy/actuator — cấm fallback 0°C / default). Tắt khi `elapsed > 300000UL` (5 phút) **HOẶC** `hum < 90.0f` → `heater(false)`, log INFO.<br>- **Power constraint cứng**: Heater ~120 mA — **không** bật > 5 phút liên tục (guard trong SM). Cooldown tối thiểu = saturation re-arm 10 phút (`hum < 99%`).<br>- **Non-blocking bắt buộc**: Mọi timer = `millis()` delta compare. **Nghiêm cấm** `delay()` / blocking `while`.<br>- **Thread-safety**: Static local chia sẻ giữa các lần gọi; FreeRTOS ESP32 atomic `uint32_t` — **không** dùng `volatile` thừa. SM phải nhất quán nếu `read_all_telemetry()` gọi nhiều lần/chu kỳ.<br>- **File**: cùng `read_sht30()` trong `sensors.cpp`. |
| D3 | Guard — không thay đổi `read_ds18b20` / `read_scd30` / `read_all_telemetry` / fault-injection API | [ ] Pending | - **Scope lock Sprint 2**: Chỉ SHT30. DS18B20 + SCD30 vẫn mock đến sprint riêng.<br>- **API surface bất biến**: Không đổi chữ ký, enum `SensorError`, getter/setter fault injection.<br>- **Verify diff**: `git diff` chỉ được đụng `sensors.cpp` (implementation SHT30) + các include/static liên quan — không đụng test suite, actuators, MQTT.<br>- **Tech debt prevention**: Không "tiện tay" refactor naming / extract helper ngoài plan. |

---

### SPRINT 3: VERIFICATION — HOST UNIT TEST & HARDWARE VALIDATION — ❌ LATER
> Prerequisite: Sprint 2 D1+D2+D3 Done · Board ESP32-S3 + SHT30 probe + pull-up 4.7 kΩ

#### Track E: Host Unit Test Regression
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| E1 | Chạy host unit tests section 16.x — zero regression | [ ] Pending | - **Không sửa** `test/run_tests.cpp` — nếu fail → isolation `#ifndef UNIT_TEST` bị rò, fix `sensors.cpp` chứ không nới test.<br>- **Lệnh chuẩn**: `cd mushroom-iot-firmware && g++ -std=c++11 -DUNIT_TEST -Iinclude -Itest test/run_tests.cpp src/sensors.cpp src/actuators.cpp src/serial_mutex.cpp src/storage.cpp src/config.cpp src/wifi_manager.cpp src/mqtt_client.cpp -o run_tests && ./run_tests`.<br>- **Assert bắt buộc pass**: (1) pre-init `read_sht30` → false + `ERR_NOT_INITIALIZED` + NAN; (2) `init_sensors_placeholder()` → true; (3) post-init temp ∈ [23,27], hum ∈ [75,85]; (4) `set_simulated_health_sht30(false)` → `ERR_DISCONNECTED`; (5) `mock_millis_offset=10000` → giá trị thay đổi (dynamic mock).<br>- **Gate merge**: 100% section 16.x pass — 1 fail = block merge. |

#### Track F: Verify `#ifndef UNIT_TEST` Isolation
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| F1 | Audit isolation — Wire/Adafruit/heater SM/real read chỉ trong `#ifndef UNIT_TEST` | [ ] Pending | - **Checklist tĩnh (đọc code, không sửa nếu đã đúng)**: (1) `#include <Wire.h>` + `#include <Adafruit_SHT31.h>` bọc `#ifndef UNIT_TEST`; (2) `static Adafruit_SHT31 sht30` bọc tương tự; (3) real I2C path trong `init_sensors_placeholder()` nằm `#ifndef`; (4) `sht30.readTemperature/Humidity` + heater SM nằm `#ifndef` trong `read_sht30()`; (5) `#else` vẫn là mock sine/cosine nguyên vẹn.<br>- **Leak = bug**: Bất kỳ symbol Arduino/Adafruit nào lọt ra ngoài `#ifndef` → host g++ fail. Fix ngay, không workaround mock header.<br>- **File audit**: `mushroom-iot-firmware/src/sensors.cpp`. |

#### Track G: Manual Hardware Validation & Documentation
| Task ID | Mô tả Task | Status | Note / Chỉ thị kỹ thuật cấp cao |
| :--- | :--- | :--- | :--- |
| G1 | Manual hardware checklist trên ESP32-S3 + SHT30 thật | [ ] Pending | - **HW prep**: Pull-up 4.7 kΩ SDA→3.3V và SCL→3.3V gần board; shield GND chỉ nối phía board (tránh ground loop).<br>- **Flash**: `pio run -t upload -e uart` (hoặc `-e otg`). Monitor: `pio device monitor` 115200.<br>- **Pass criteria init**: Log `[SENSORS] Initializing Real I2C Bus and SHT30...`; **không** có `ERROR: SHT30 not found at 0x44!`. Nếu 0x45 → ghi nhận Addition Plan, không silent hardcode đổi.<br>- **Telemetry thật**: temp/hum hợp lý, **không** phải sine mock pattern.<br>- **Heater SM e2e**: Thổi hơi ẩm hum ≥ 99% liên tục 10 phút → log WARNING heater ON + `temp=NAN` + actuator không kích hoạt sai → sau 5 phút hoặc hum < 90% → log INFO heater OFF + temp thực trở lại.<br>- **Fail-safe verify**: Downstream (fuzzy/actuator) coi NAN = "không điều khiển" — không fallback 0°C.<br>- **I2C clock**: Xác nhận vẫn 50 kHz (log hoặc scope nếu có). |
| G2 | Ghi nhận kết quả verification vào WALKTHROUGH_LOG | [ ] Pending | - **Nội dung bắt buộc**: (1) host unit test pass/fail count; (2) PlatformIO build result + binary size; (3) serial log snippet init I2C thành công; (4) lệch so với plan (địa chỉ 0x45, timing SM, v.v.).<br>- **Không tạo file lạ**: Chỉ cập nhật WALKTHROUGH_LOG khi chạy — cấm README/report rời ngoài plan.<br>- **Escalation**: Lệch HW (addr, pull-up, timing) → ghi **Addition Plan** trước khi sửa code lệch sprint. |

---

## Ghi chú điều phối Agent

| Vai trò | Agent | Trách nhiệm |
| :--- | :--- | :--- |
| Execution | **Gemini** | Viết code theo từng Task ID tuần tự A1 → … → G2. Cập nhật Status + Note khi xong từng task. |
| Architect / QA init | **Claude (Senior Solution Architect)** | Khởi tạo PROGRESS, rà soát QA Review → Done, chặn tech debt / lệch design. |
| Thứ tự sprint | — | **Sprint 1 → 2 → 3** tuần tự. Không parallel Sprint 2 khi A2 chưa Done (thiếu lib = fail compile). |
| Status legend | — | `[ ] Pending` · `[ ] In Progress` · `[ ] QA Review` · `[x] Done` |

### Quy tắc cứng toàn cục (áp dụng mọi task)
1. **`#ifndef UNIT_TEST` isolation** — HW code không được rò sang host build.
2. **Non-blocking** — cấm `delay()` / busy-wait trong `sensors.cpp`.
3. **No magic pins** — chỉ `config::pins::PIN_I2C_*`.
4. **Heater power** — max 5 phút ON, re-arm sau saturation cooldown 10 phút.
5. **`temp = NAN` khi heating** — khóa actuator, không fallback số.
6. **Public API bất biến** — không đổi signature / enum / fault-injection surface.
7. **I2C 50 kHz + `setWireTimeout(3000, true)`** — chống bus hang trên dây dài.
