# IIoT Industrial-Grade Direct-Relay Fuzzy Dynamic Tuning — Tài liệu Kế hoạch Tổng thể (v2.2)

> **Phiên bản đồng bộ source: 2026-07-21.**
> Firmware hiện tại **không còn TPC/Slow PWM**. Relay được điều khiển trực tiếp ON/OFF qua `relay_control::applyDirectOutputs()` với hysteresis `FUZZY_ON_THRESHOLD=0.25 / FUZZY_OFF_THRESHOLD=0.15`. Core 1 tick mỗi 50 ms; cảm biến đọc mỗi 5 giây.

---

## 1. Mục Tiêu Kỹ Thuật Tổng Quát

Xây dựng luồng **khuyến nghị → operator phê duyệt → desired/reported sync** để tinh chỉnh có kiểm soát bốn tham số fuzzy/direct-relay của từng ESP32-S3 trong môi trường IIoT trồng nấm. Hệ thống phải đảm bảo:

### 1.1 Mục tiêu cốt lõi
| # | Mục tiêu | Ràng buộc không được vi phạm |
|---|---|---|
| 1 | Tính KPI từ telemetry live có đầy đủ setpoint và trạng thái relay do Edge xác nhận | Không dùng telemetry thiếu target hoặc `data_quality=degraded` |
| 2 | Sinh advisory deterministic, có `ruleset_version`, không tự áp dụng | Operator phải xem diff và bấm Confirm |
| 3 | Persist desired/reported shadow và audit log trong PostgreSQL durable | In-memory map hiện tại chỉ phục vụ baseline/crop profile |
| 4 | Hỗ trợ thiết bị/WAN offline bằng MQTT QoS 1 + retained desired | Offline device nhận đúng desired retained mới nhất tại reconnect |
| 5 | Chống flash wear, duplicate command/ACK và race Core 0/Core 1 | Two-slot CRC envelope; idempotent NVS write |
| 6 | Bảo toàn mọi interlock hiện hữu của firmware | Blackout, bio-bound, max-ON/cooldown, SystemProtector luôn thắng |

### 1.2 Tham số contract v1 (bất biến)
| Key | Default | Hard bounds | Áp dụng tại Core 1 |
|---|---:|---:|---|
| `lamp_gain_scale` | 1.00 | 0.80–1.20 | Nhân demand `HLamp` sau adaptive gain, trước clamp/protector |
| `mist_gain_scale` | 1.00 | 0.80–1.20 | Nhân demand `Mist` sau adaptive gain, trước clamp/protector |
| `mist_on_threshold` | 0.25 | 0.20–0.35 | Ngưỡng bật chỉ cho Mist direct relay |
| `mist_off_threshold` | 0.15 | 0.10–0.20 | Ngưỡng giữ/tắt chỉ cho Mist direct relay |

### 1.3 Ngoài phạm vi (nghiêm cấm thực hiện)
- TPC, PWM tần số cao, `lamp_pwm_cycle_s`, `lamp_min_on_s`, hoặc thay đổi SSR/phần cứng
- Tuning blackout, bio threshold (`ThTOP`, `ThBOT`, `HmTOP`, `HmBOT`), pin mapping, manual override, `SystemProtector`
- Auto-apply, seasonal heuristics, thay đổi crop profile/setpoint trong cùng command tuning
- Thêm `HWat` vào UI/recommendation (HWat không lắp đặt)

---

## 2. Techstack Cốt Lõi

### 2.1 Firmware — ESP32-S3 (C++17, FreeRTOS)
| Layer | Technology | Ghi chú |
|---|---|---|
| **Language** | C++17 (no RTTI, no exceptions) | Dùng `static_assert`, `constexpr`; tránh STL allocating |
| **RTOS** | FreeRTOS (ESP-IDF v5.x) | Queue depth 1 (`xQueueCreate(1, …)`), `xQueueOverwrite` |
| **JSON parse** | ArduinoJson v7 (StaticDocument) | Bounded parse trên stack, không heap JSON |
| **MQTT** | PubSubClient | Callback nhẹ: chỉ copy bytes → `g_network_worker_queue` |
| **NVS** | ESP-IDF NVS | Two-slot CRC32 envelope; không dùng `nvs_flash_erase` cho tuning |
| **Fuzzy/Control** | Custom `FuzzyController` + `AdaptiveTuner` | Hard clamp `[0,1]`; `SystemProtector` override cuối |

### 2.2 Backend — NestJS (Node.js, TypeScript)
| Layer | Technology | Ghi chú |
|---|---|---|
| **Language** | TypeScript 5.x (strict mode) | `noImplicitAny`, `strictNullChecks` bật |
| **Framework** | NestJS 10.x | Module: `TuningModule`, `AnalyticsModule` |
| **ORM** | TypeORM 0.3.x | Migration prefix `1720656000006-*` và sau; entity riêng |
| **Database** | PostgreSQL 15+ | `device_tuning_configurations`, `tuning_audit_logs` |
| **Time-series** | InfluxDB 2.x (Flux) | Bucket `mushroom_iot` (raw), `mushroom_analytics` (KPI) |
| **MQTT** | Backend MQTT client (MqttService) | Subscribe reported, publish desired QoS 1 retained |
| **Auth** | JWT + Role Guard (hiện hữu) | Bổ sung device/house ownership check |
| **SSE** | NestJS SSE (`@Sse`) | Subject `tuningSync$`, phát sau DB commit |

### 2.3 Frontend — Next.js (TypeScript, React)
| Layer | Technology | Ghi chú |
|---|---|---|
| **Framework** | Next.js 14+ (App Router) | Reuse `app/page.tsx`, `useSelectedDevice` |
| **Data fetch** | Same-origin proxy `/api/backend/[...path]` | Không tạo base URL hoặc EventSource độc lập |
| **State** | `RealTelemetryProvider` + React Context | Không dùng external state library mới |
| **UI** | Vanilla CSS + existing design system | Không thêm TailwindCSS hoặc CSS-in-JS mới |
| **SSE** | Native `EventSource` (pattern hiện hữu) | Refetch sau reconnect, không optimistic success |

---

## 3. Quy Tắc Viết Code Toàn Cục (Coding Conventions)

> Tất cả Agent thực thi phải tuân theo các quy tắc sau. Vi phạm bất kỳ quy tắc nào là không chấp nhận được.

### 3.1 Kiến trúc & Tổ chức (Clean Architecture)

```
Firmware:
  core/         ← Business logic, không phụ thuộc network/NVS API trực tiếp
  network/      ← MQTT, HTTP, WiFi: không gọi GPIO
  protocols/    ← Parse/dispatch callback; giữ callback nhẹ
  storage/      ← NVS helpers; không trộn tuning key với baseline/crop key

Backend:
  src/tuning/          ← Module riêng: entity, service, controller, DTOs
  src/analytics/       ← Module riêng: InfluxDB query, recommender engine
  src/common/          ← Guards, interceptors, helpers (escapeFluxString, etc.)
  src/migrations/      ← TypeORM migrations duy nhất nguồn thật

Frontend:
  app/                 ← Page components, reuse existing providers
  components/tuning/   ← TuningAdvisoryPanel và sub-components riêng biệt
  hooks/               ← Custom hooks, reuse useSelectedDevice
```

**Quy tắc phân tầng:**
- Firmware: Core 1 **không** gọi MQTT/NVS; Core 0 **không** gọi GPIO/control-state
- Backend: Controller chỉ validate DTO + gọi Service; Service chứa business logic
- Frontend: Component không gọi API trực tiếp; dùng custom hook hoặc provider

### 3.2 Quy Tắc Đặt Tên

**Firmware (C++17):**
```cpp
// Class: PascalCase
class TuningConfigManager { ... };

// Hàm/phương thức: camelCase
bool validateTuningPayload(const JsonDocument& doc);

// Hằng số: SCREAMING_SNAKE_CASE
constexpr float LAMP_GAIN_SCALE_MIN = 0.80f;
constexpr float LAMP_GAIN_SCALE_MAX = 1.20f;

// Biến global chia sẻ: tiền tố g_
extern QueueHandle_t g_tuning_config_queue;

// Struct POD: PascalCase, không có thành viên pointer/String
struct DynamicTuningParams { ... };
```

**Backend (TypeScript):**
```typescript
// Class/Interface/Type: PascalCase
class TuningConfigurationService { ... }
interface TuningDesiredPayload { ... }

// Phương thức/biến: camelCase
async findLatestByDeviceId(deviceId: string): Promise<DeviceTuningConfiguration>

// Hằng số module: SCREAMING_SNAKE_CASE
const MAX_LAMP_GAIN_SCALE = 1.20;

// Enum: PascalCase với values SCREAMING_SNAKE_CASE
enum SyncStatus { PENDING = 'PENDING', IN_SYNC = 'IN_SYNC', REJECTED = 'REJECTED' }

// DTO: suffix Dto
class CreateTuningConfigurationDto { ... }

// Entity: suffix Entity hoặc không suffix (theo TypeORM convention)
@Entity('device_tuning_configurations')
class DeviceTuningConfiguration { ... }
```

**Frontend (TypeScript/React):**
```typescript
// Component: PascalCase
export function TuningAdvisoryPanel() { ... }

// Hook: tiền tố use + PascalCase
export function useTuningStatus(deviceId: string) { ... }

// Props interface: suffix Props
interface TuningAdvisoryPanelProps { ... }
```

### 3.3 Quy Tắc Xử Lý Lỗi

**Firmware:**
- Mọi lỗi parse JSON → `REJECTED` với `reason_code` ổn định (`INVALID_SCHEMA`, `OUT_OF_RANGE`, v.v.)
- Không ghi NVS nếu chưa pass validation đầy đủ
- Không publish `ACCEPTED` nếu `xQueueOverwrite()` hoặc NVS write thất bại
- Lỗi persistence → `PERSISTENCE_FAILED`; queue unavailable → `CONTROL_QUEUE_UNAVAILABLE`
- Không panic/crash trên input bất kỳ từ MQTT; log và tiếp tục

**Backend (TypeScript):**
```typescript
// Dùng custom exception class kế thừa HttpException
throw new TuningValidationException('CROSS_FIELD_INVALID', 'mist_off_threshold >= mist_on_threshold');

// Service phải wrap DB operation trong try/catch và rethrow domain exception
// Không để raw DB error rò rỉ ra HTTP response

// Tất cả async function phải có kiểu return rõ ràng
async applyTuningCommand(dto: CreateTuningConfigurationDto): Promise<TuningCommandResult>
```

**Frontend:**
- Hiển thị lý do thất bại cụ thể từ API response
- Không optimistic success: chỉ hiển thị success sau SSE `IN_SYNC`
- Timeout confirmation: nếu không nhận SSE trong 30s, hiển thị trạng thái "Chờ xác nhận từ thiết bị"

### 3.4 Quy Tắc Bảo Mật

- **Không hard-code** device ID, tenant, topic, secret, credential trong source code; dùng biến môi trường
- **Không interpolate raw string** vào Flux query; luôn dùng `escapeFluxString()` hiện có
- **Không tin client** về `requested_by`; lấy actor identity từ JWT token đã verify
- **Cross-device isolation**: Mọi endpoint phải verify `deviceId` thuộc quyền sở hữu của actor
- **ACK lạ/sai device**: Chỉ security log, không clear retained topic, không đổi shadow state

### 3.5 Quy Tắc Hiệu Năng

- Firmware: Callback MQTT chỉ copy bytes vào `g_network_worker_queue`; mọi JSON parse xảy ra trên worker task
- Backend: MQTT reported handler phải xử lý idempotent; QoS-1 duplicate chỉ tạo một DB state transition
- InfluxDB: Dùng Task Flux hourly với offset 5 phút; không query raw bucket trong recommender
- Frontend: Không polling; dùng SSE `EventSource` và refetch sau reconnect

### 3.6 Quy Tắc Test Bắt Buộc

- Mỗi `Service` backend phải có unit test riêng (Jest)
- Firmware validation logic phải có test fixture: valid, invalid_schema, out_of_range, cross_field, duplicate, concurrent_burst
- Mọi PR không được giảm coverage dưới baseline hiện tại của module liên quan
- Acceptance criteria trong PLAN.md Section 9 là danh sách test cases bắt buộc

---

## 4. Cấu Trúc Sprint

| Sprint | Phạm vi | Thời gian |
|---|---|---|
| **Sprint 1** | Contract, telemetry completeness và Edge path | Ngày 1–7 |
| **Sprint 2** | Analytics, advisory, UI và E2E | Ngày 8–14 |

Xem chi tiết:
- [`sprint_1.md`](./sprint_1.md) — Contract, MQTT, InfluxDB writer, Firmware POD/NVS/queue, Mist hysteresis, DB shadow service
- [`sprint_2.md`](./sprint_2.md) — Influx Task, KPI aggregation, Recommender, Auth/authz, REST/SSE, TuningAdvisoryPanel, E2E fault injection

---

## 5. Kiến Trúc Đích (Tổng quan)

```
Edge telemetry (live + offline replay, setpoint + final relay states)
                         |
                         v
          InfluxDB mushroom_iot  ← ControlHistoryInfluxWriter (mới)
                         |
                         v
       Influx Task hourly → mushroom_analytics / kpi_metrics_1h
                         |
                         v
NestJS ControlAnalyticsService → TuningRecommenderEngine (advisory)
             |                                 |
             v                                 v
 PostgreSQL device_tuning_configurations + tuning_audit_logs
             ^                                 |
             |                    Next.js TuningAdvisoryPanel (approve)
             |                                 |
             +------ MQTT desired, QoS 1, retained ------+
                                                           v
ESP32 Core 0: parse/validate → durable tuning NVS → queue depth 1
                                                           v
ESP32 Core 1 tick: adopt tuning → fuzzy/arbitration → protector → direct relay GPIO
                                                           |
             +----- MQTT reported, QoS 1 -----------------+
             v
NestJS transaction: validate ACK → durable state → SSE → UI
             |
             +-- clear retained desired only if still newest pending command
```

---

## 6. Tài Liệu Tham Chiếu

| Tài liệu | Vị trí |
|---|---|
| Big Plan gốc | [PLAN.md](./PLAN.md) |
| Sprint 1 chi tiết | [sprint_1.md](./sprint_1.md) |
| Sprint 2 chi tiết | [sprint_2.md](./sprint_2.md) |
