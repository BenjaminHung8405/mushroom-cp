# Sprint 2 — Analytics, Advisory, UI và E2E

> **Thời gian:** Ngày 8–14
> **Điều kiện tiên quyết:** Sprint 1 done-definition đã pass hoàn toàn. Live controller history trong InfluxDB đã có đủ `target/source/revision/final relay states`. DB shadow đã durable.
> **Nguyên tắc:** Không viết code ứng dụng trong tài liệu này. Đây là tài liệu phân rã kỹ thuật thuần túy.

---

## 1. PHẠM VI & MỤC TIÊU

### 1.1 Phạm vi
Sprint 2 xây dựng tầng analytics/recommender, API/authz, SSE, và UI panel. Các module/component bị tác động trực tiếp:

**Backend Analytics (NestJS):**
- `src/analytics/services/control-analytics.service.ts` (new) — Query KPI từ InfluxDB analytics bucket
- `src/analytics/services/tuning-recommender-engine.service.ts` (new) — Deterministic rule engine
- `src/analytics/interfaces/kpi-metrics.interface.ts` (new) — KPI v1 type definitions
- `src/analytics/analytics.module.ts` (new) — Module declaration
- `src/influx/tasks/kpi-hourly.flux` (new) — Influx Task Flux script
- `src/influx/services/influx-task-provisioner.service.ts` (new) — Provision Influx Task on startup

**Backend Tuning API (NestJS):**
- `src/tuning/controllers/tuning.controller.ts` (new) — REST + SSE endpoints
- `src/tuning/dtos/create-tuning-configuration.dto.ts` (new) — Request DTO với class-validator
- `src/tuning/dtos/tuning-recommendation-response.dto.ts` (new) — Response DTO
- `src/tuning/guards/device-ownership.guard.ts` (new/verify) — Auth/authz cross-device
- `src/tuning/tuning.module.ts` (modify) — Thêm controller, analytics imports
- `src/app.module.ts` (modify) — Import TuningModule

**Frontend (Next.js):**
- `app/components/tuning/TuningAdvisoryPanel.tsx` (new) — Main panel component
- `app/components/tuning/TuningDiffView.tsx` (new) — Diff visualization
- `app/components/tuning/TuningStatusBadge.tsx` (new) — Status badge component
- `app/components/tuning/CoverageWarning.tsx` (new) — Coverage insufficient warning
- `app/hooks/useTuningStatus.ts` (new) — SSE hook cho tuning stream
- `app/hooks/useTuningRecommendation.ts` (new) — Fetch KPI + advisory
- `app/page.tsx` (modify) — Thêm TuningAdvisoryPanel

**Testing & E2E:**
- `test/tuning/fault-injection.e2e-spec.ts` (new) — Offline, retain, ACK duplicate, reboot, corrupt NVS

### 1.2 Mục tiêu Done-Definition của Sprint 2
| # | Done khi |
|---|---|
| S2-1 | Coverage gate/RMSE aggregation/ruleset tests pass |
| S2-2 | Endpoint không cho cross-device/anonymous apply |
| S2-3 | UI không optimistic success; trạng thái durable đúng sau SSE |
| S2-4 | Fault injection: không state drift/unsafe GPIO/flash write thừa |
| S2-5 | Staging 24h dry run hoàn thành; rollback drill thực hiện được |

---

## 2. KIẾN TRÚC & LUỒNG DỮ LIỆU

### 2.1 Luồng Analytics: InfluxDB → KPI → Recommendation

```
[InfluxDB mushroom_iot bucket]
  measurement: controller_history
  tags: device_id, control_source, data_quality
  fields: temperature_c, humidity_percent, temp_target, humid_target,
          mist_state, lamp_state, fan_state, config_revision
      |
      | (Influx Task: hourly, offset 5 min)
      v
[Flux script: kpi-hourly.flux]
  - Filter: data_quality='good' only (bỏ 'degraded')
  - Aggregate per (device_id, control_source, config_revision) per 1h window:
    * sum_squared_error_temp = sum((temperature_c - temp_target)^2)
    * sum_squared_error_humid = sum((humidity_percent - humid_target)^2)
    * sample_count
    * mist_switch_count (count transitions false→true)
    * mist_on_duration_s
    * lamp_on_duration_s
    * lamp_session_count
    * overshoot_temp_duration_s (temp > target + 0.5)
    * undershoot_temp_duration_s (temp < target - 0.5)
    * expected_samples, valid_samples
      |
      v
[InfluxDB mushroom_analytics bucket]
  measurement: kpi_metrics_1h
  tags: device_id, control_source, config_revision
  fields: sample_count, sum_squared_error_temp, sum_squared_error_humid,
          mist_switch_count, mist_on_duration_s, lamp_on_duration_s,
          lamp_session_count, lamp_avg_on_duration_s, overshoot_duration_s,
          undershoot_duration_s, expected_samples, valid_samples,
          data_coverage_percent
      |
      v
[ControlAnalyticsService.getKpiForDevice(deviceId, window24h)]
  - Query mushroom_analytics bucket: last 24h (hoặc crop batch window)
  - Aggregate: rolling RMSE = sqrt(sum(sum_squared_error) / sum(sample_count))
    * KHÔNG average RMSE theo giờ (sai về mặt thống kê)
  - Tính: mistSwitchCountPerHour = total_switches / hours_covered
  - Tính: lampDutyCyclePercent = lamp_on_duration_s / (hours * 3600) * 100
  - Tính: dataCoveragePercent = valid_samples / expected_samples * 100
  - Return: KpiMetrics object
      |
      v
[TuningRecommenderEngine.generateRecommendation(kpi, currentConfig)]
  - Check coverage gate: dataCoveragePercent < 80% → INSUFFICIENT_DATA
  - Check data quality: trusted target available
  - Check device online: last seen < 5min ago
  - Apply rule table (deterministic, có ruleset_version):
    * Rule R1: mistSwitchCountPerHour > 10 → adjust thresholds
    * Rule R2: tempRmse > 1.5 + lamp duty thấp → increase lamp_gain_scale
    * Rule R3: humidRmse > 5.0 + mist not chattering → increase mist_gain_scale
  - Conflict check: không suggest hai rule conflict nhau cùng lúc
  - Return: TuningRecommendation (hoặc InsufficientDataResult)
```

### 2.2 Luồng API: Operator Approve → Shadow Update

```
[Operator: UI TuningAdvisoryPanel]
      |
      | (xem diff: current config vs recommended config)
      | (bấm "Xác nhận áp dụng")
      v
[POST /devices/:id/tuning-configurations]
  Body: { commandId (idempotency key), config: TuningConfigSnapshot }
      |
      v
[TuningController.createTuningConfiguration(req, dto)]
      |
      v
[DeviceOwnershipGuard: verify req.user owns deviceId]
      |
      +-- [DENY] 403 Forbidden
      |
      v
[TuningConfigurationService.createPendingCommand(dto, actor)]
  (logic đã định nghĩa Sprint 1 Track F3.2)
      |
      v
[Response 202 Accepted: { commandId, status: 'PENDING' }]
      |
      v
[UI: poll SSE stream]
      |
      v
[GET /devices/:id/tuning-configurations/stream] (SSE)
      |
      v
[TuningController.streamTuningStatus()]
      |
      v
[tuningSync$ Observable → filter deviceId → SSE push]
      |
      v
[UI nhận event: { commandId, status: 'IN_SYNC'/'REJECTED', appliedAt }]
      |
      v
[Hiển thị success badge hoặc rejection reason]
      Nếu timeout 30s không có event → hiển thị "Chờ xác nhận từ thiết bị"
```

### 2.3 Luồng UI: Fetch → Display → Confirm

```
[app/page.tsx mount]
      |
      v
[useSelectedDevice() → deviceId]
      |
      v
[useTuningRecommendation(deviceId)]
      |
      | (fetch GET /api/backend/devices/:id/analytics/tuning-recommendations)
      v
[TuningRecommendationResponse]:
  - kpi: KpiMetrics (tempRmse, humidRmse, mistSwitchCountPerHour,
                      lampDutyCyclePercent, dataCoveragePercent, ...)
  - currentConfig: TuningConfigSnapshot
  - recommendation: TuningAdvisory | null
  - blockReason: 'INSUFFICIENT_DATA' | 'DEVICE_OFFLINE' | 'NO_SUGGESTION' | null
      |
      v
[TuningAdvisoryPanel]:
  - Nếu blockReason != null: render <CoverageWarning reason={blockReason} />
  - Nếu recommendation != null: render <TuningDiffView current={currentConfig} suggested={recommendation.suggestedConfig} />
  - Render confirm button (disabled khi blockReason != null)
      |
      | (user click confirm)
      v
[POST /api/backend/devices/:id/tuning-configurations]
  Body: { config: recommendation.suggestedConfig }
      |
      v
[useTuningStatus(deviceId)] → SSE stream
      |
      v
[TuningStatusBadge]: PENDING → IN_SYNC / REJECTED / TIMEOUT
```

### 2.4 Luồng Fault Injection E2E

```
Scenario: Device offline khi desired được publish
[Backend publish desired retained QoS 1]
      |
      v
[Device offline: không nhận được]
      |
      v
[Device reconnect]
      |
      v
[MQTT broker deliver retained desired] → [Core 0 process normally] → [reported ACCEPTED]
      |
      v
[Backend ACK → IN_SYNC] (verify không duplicate DB transition)

Scenario: ACK duplicate (QoS-1 redelivery)
[Backend nhận reported ACCEPTED lần 1 → IN_SYNC + audit]
      |
      v
[MQTT redelivery: Backend nhận lại reported ACCEPTED]
      |
      v
[handleReportedAck(): SELECT FOR UPDATE → status đã IN_SYNC → skip (idempotent)]
      |
      v
[Không tạo thêm audit log, không phát SSE lần 2, không clear retained lại]

Scenario: ACK cũ sau desired mới
[Command A: IN_SYNC. Command B: PENDING]
      |
      v
[Nhận ACK của command A lại (QoS-1 redelivery hoặc network delay)]
      |
      v
[command_id A không phải latest PENDING → skip retain-clear]
      |
      v
[Desired B vẫn còn retained trên broker → device sẽ nhận đúng]
```

---

## 3. PHÂN RÃ CHI TIẾT TÁC VỤ

---

### TRACK G — INFLUX TASK & KPI PROVISIONING (Ngày 8–9)

#### G1 — Flux Script Hourly Aggregation

> **File:** `src/influx/tasks/kpi-hourly.flux` (new)

**G1.1** — Viết Flux Task script
- **File:** `src/influx/tasks/kpi-hourly.flux` (new)
- **Nội dung cần định nghĩa (pseudo-Flux, không phải code thực):**
  - `option task = { name: "kpi_hourly_aggregation", every: 1h, offset: 5m }`
  - `data = from(bucket: INFLUXDB_BUCKET)` — không hard-code bucket name
  - Filter: `data_quality == "good"` — loại bỏ `degraded`
  - Filter: window `-1h to now`
  - Group by: `device_id`, `control_source`, `config_revision`
  - Tính `sum_squared_error_temp`:
    - `(temperature_c - temp_target)^2` per row → `sum()`
  - Tính `mist_switch_count`:
    - Detect transitions trong `mist_state` field: false → true = 1 switch
    - Dùng `derivative()` hoặc `difference()` + filter positives
  - Tính `lamp_on_duration_s`:
    - Khi `lamp_state = true`: count ticks * 5s (sensor sample interval)
    - **Không** average; accumulate `sum`
  - Tính `data_coverage_percent`:
    - `expected_samples = 3600 / 5 = 720` per giờ
    - `valid_samples = count(temperature_c)`
    - `data_coverage_percent = valid_samples / expected_samples * 100`
  - Write to `mushroom_analytics` bucket, measurement `kpi_metrics_1h`

**G1.2** — Influx Task Provisioner Service
- **File:** `src/influx/services/influx-task-provisioner.service.ts` (new)
- **Phương thức:**
  - `onApplicationBootstrap(): Promise<void>` — gọi `ensureKpiTask()` khi app start
  - `private ensureKpiTask(): Promise<void>`:
    - Gọi InfluxDB Tasks API: list tasks với name `kpi_hourly_aggregation`
    - Nếu đã tồn tại và active: log và return (idempotent)
    - Nếu không tồn tại: create task với Flux script content đọc từ `kpi-hourly.flux`
    - Nếu tồn tại nhưng disabled: re-enable
  - `private readFluxScript(): string` — đọc file `kpi-hourly.flux` tương đối với `__dirname`

---

### TRACK H — CONTROL ANALYTICS SERVICE (Ngày 8–9)

#### H1 — KPI Interface Definitions

> **File:** `src/analytics/interfaces/kpi-metrics.interface.ts` (new)

**H1.1** — Định nghĩa `KpiMetrics` interface
- **File:** `src/analytics/interfaces/kpi-metrics.interface.ts` (new)
- **Fields (KPI v1):**
  ```typescript
  interface KpiMetrics {
    deviceId: string;
    windowStart: Date;
    windowEnd: Date;
    tempRmse: number;                  // sqrt(sum_squared_error / sample_count)
    humidRmse: number;
    mistSwitchCountPerHour: number;
    lampDutyCyclePercent: number;
    lampAvgOnDurationSec: number;
    overshootDurationSec: number;
    undershootDurationSec: number;
    dataCoveragePercent: number;
    sampleCount: number;
    configRevision: number | null;
    dataQualityWarning: boolean;       // true nếu có mixed quality trong window
  }
  ```

**H1.2** — Định nghĩa `TuningAdvisory` interface
- **File:** `src/analytics/interfaces/tuning-advisory.interface.ts` (new)
- **Fields:**
  ```typescript
  interface TuningAdvisory {
    rulesetVersion: string;            // e.g. "v1.0.0"
    suggestedConfig: TuningConfigSnapshot;
    delta: Partial<TuningConfigSnapshot>; // chỉ keys thay đổi
    triggeredRules: string[];          // e.g. ['R1_MIST_CHATTERING']
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    expectedBenefit: string;           // human-readable
    kpiSnapshot: KpiMetrics;
    currentConfig: TuningConfigSnapshot;
    observationWindowRequired: boolean; // true nếu cần window trước next suggestion
  }
  
  type RecommendationResult =
    | { status: 'ADVISORY'; advisory: TuningAdvisory }
    | { status: 'INSUFFICIENT_DATA'; reason: string }
    | { status: 'NO_SUGGESTION'; reason: string }
    | { status: 'CONFLICT'; conflictingRules: string[] };
  ```

#### H2 — ControlAnalyticsService

> **File:** `src/analytics/services/control-analytics.service.ts` (new)

**H2.1** — Implement `getKpiForDevice()`
- **Signature:** `async getKpiForDevice(deviceId: string, windowHours: number): Promise<KpiMetrics | null>`
- **Logic:**
  1. Build Flux query: query `mushroom_analytics` bucket, measurement `kpi_metrics_1h`
  2. Filter: `device_id = escapeFluxString(deviceId)` — **bắt buộc** dùng `escapeFluxString()`
  3. Filter: window `last ${windowHours}h`
  4. Aggregate: `sum_squared_error_temp`, `sum_squared_error_humid`, `sample_count` tổng cộng
  5. Tính rolling RMSE:
     - `tempRmse = Math.sqrt(totalSumSquaredErrorTemp / totalSampleCount)`
     - **Không** `sum(rmse_per_hour) / count` (sai thống kê)
  6. Tính `mistSwitchCountPerHour = totalMistSwitchCount / windowHours`
  7. Tính `lampDutyCyclePercent = lampOnDurationS / (windowHours * 3600) * 100`
  8. Tính `lampAvgOnDurationSec = lampOnDurationS / lampSessionCount` (nếu sessions > 0)
  9. Tính `dataCoveragePercent = validSamples / expectedSamples * 100`
  10. Return `KpiMetrics` hoặc `null` nếu không có data

**H2.2** — Implement `checkCoverageGate()`
- **Signature:** `checkCoverageGate(kpi: KpiMetrics): { passed: boolean; reason?: string }`
- **Logic:**
  - `dataCoveragePercent < 80` → `{ passed: false, reason: 'COVERAGE_BELOW_80_PERCENT' }`
  - `kpi.dataQualityWarning && kpi.sampleCount < 100` → `{ passed: false, reason: 'INSUFFICIENT_TRUSTED_SAMPLES' }`
  - `kpi.configRevision === null` → `{ passed: false, reason: 'CONFIG_REVISION_UNAVAILABLE' }`
  - Else: `{ passed: true }`

**H2.3** — Implement `checkDeviceOnline()`
- **Signature:** `async checkDeviceOnline(deviceId: string): Promise<boolean>`
- **Logic:** Query device last telemetry timestamp; return `lastSeen > now - 5 minutes`

---

### TRACK I — TUNING RECOMMENDER ENGINE (Ngày 9)

#### I1 — TuningRecommenderEngine Service

> **File:** `src/analytics/services/tuning-recommender-engine.service.ts` (new)

**I1.1** — Định nghĩa constants và rule metadata
- **File:** `src/analytics/services/tuning-recommender-engine.service.ts` (new)
- **Constants:**
  ```typescript
  const RULESET_VERSION = 'v1.0.0';
  
  const RULE_THRESHOLDS = {
    MIST_CHATTERING_SWITCHES_PER_HOUR: 10,
    TEMP_RMSE_HIGH: 1.5,
    HUMID_RMSE_HIGH: 5.0,
    MIN_LAMP_DUTY_CYCLE_PERCENT: 30,   // "lamp duty thấp"
    GAIN_SCALE_STEP: 0.05,             // mỗi recommendation tối đa 0.05
    MIST_THRESHOLD_STEP: 0.02,         // threshold step cho chattering
  } as const;
  ```

**I1.2** — Implement `generateRecommendation()`
- **Signature:** `generateRecommendation(kpi: KpiMetrics, currentConfig: TuningConfigSnapshot): RecommendationResult`
- **Logic (pure function, không async, không side effects):**
  1. Kiểm tra pre-conditions: kpi và currentConfig không null
  2. Gọi coverage gate (inject từ `ControlAnalyticsService` hoặc pass result)
  3. Evaluate rules theo thứ tự priority:
     - **Rule R1 (MIST_CHATTERING):** `kpi.mistSwitchCountPerHour > 10`
       - `suggestedMistOn = clamp(currentConfig.mist_on_threshold + 0.02, 0.20, 0.35)`
       - `suggestedMistOff` giữ nguyên hoặc giảm một bước nếu cần maintain hysteresis
       - Validate: `suggestedMistOff < suggestedMistOn`
     - **Rule R2 (TEMP_HIGH_LAMP_LOW):** `kpi.tempRmse > 1.5 && kpi.lampDutyCyclePercent < 30`
       - `suggestedLampGain = clamp(currentConfig.lamp_gain_scale + 0.05, 0.80, 1.20)`
     - **Rule R3 (HUMID_HIGH_MIST_OK):** `kpi.humidRmse > 5.0 && kpi.mistSwitchCountPerHour <= 10`
       - `suggestedMistGain = clamp(currentConfig.mist_gain_scale + 0.05, 0.80, 1.20)`
  4. Conflict check: nếu R1 và R3 cùng trigger → return `CONFLICT` (chattering + gain tăng mâu thuẫn)
  5. Nếu không rule nào trigger: return `NO_SUGGESTION`
  6. Build `TuningAdvisory` với:
     - `suggestedConfig`: merge currentConfig với các delta
     - `delta`: chỉ keys thay đổi
     - `triggeredRules`: array tên rule đã trigger
     - `rulesetVersion: RULESET_VERSION`
     - `kpiSnapshot`: tham chiếu kpi đầu vào
  7. Return `{ status: 'ADVISORY', advisory }`

**I1.3** — Implement helper `clampToHardBounds()`
- **Signature:** `private clampToHardBounds(key: keyof TuningConfigSnapshot, value: number): number`
- **Logic:** map key → [min, max] từ PLAN hard bounds; `Math.max(min, Math.min(max, value))`

**I1.4** — Implement helper `validateHysteresis()`
- **Signature:** `private validateHysteresis(on: number, off: number): boolean`
- **Logic:** `off < on` — đơn giản, không silently fix

---

### TRACK J — AUTHZ & REST/SSE TUNING MODULE (Ngày 9–10)

#### J1 — Device Ownership Guard

> **File:** `src/tuning/guards/device-ownership.guard.ts` (new)

**J1.1** — Implement `DeviceOwnershipGuard`
- **File:** `src/tuning/guards/device-ownership.guard.ts` (new)
- **Class:** `@Injectable() class DeviceOwnershipGuard implements CanActivate`
- **Phương thức:**
  - `canActivate(context: ExecutionContext): Promise<boolean>`
  - Extract `deviceId` từ `req.params.id`
  - Extract `userId` từ JWT payload (`req.user.sub`)
  - Gọi `DevicesService.isDeviceOwnedByUser(deviceId, userId)`
  - Return `true` nếu owned; throw `ForbiddenException` nếu không

**J1.2** — Implement `DevicesService.isDeviceOwnedByUser()`
- **File:** `src/devices/devices.service.ts` (modify)
- **Phương thức mới:**
  - `async isDeviceOwnedByUser(deviceId: string, userId: string): Promise<boolean>`
  - Query: `SELECT 1 FROM devices WHERE device_id = $1 AND owner_user_id = $2`
  - Return boolean

#### J2 — DTOs

> **File:** `src/tuning/dtos/create-tuning-configuration.dto.ts` (new)
> **File:** `src/tuning/dtos/tuning-recommendation-response.dto.ts` (new)

**J2.1** — `CreateTuningConfigurationDto`
- **File:** `src/tuning/dtos/create-tuning-configuration.dto.ts` (new)
- **Fields với decorators:**
  ```typescript
  class TuningConfigSnapshotDto {
    @IsNumber() @Min(0.80) @Max(1.20) lamp_gain_scale: number;
    @IsNumber() @Min(0.80) @Max(1.20) mist_gain_scale: number;
    @IsNumber() @Min(0.20) @Max(0.35) mist_on_threshold: number;
    @IsNumber() @Min(0.10) @Max(0.20) mist_off_threshold: number;
  }
  
  class CreateTuningConfigurationDto {
    @IsUUID('4')          commandId: string;   // idempotency key
    @ValidateNested()
    @Type(...)            config: TuningConfigSnapshotDto;
    @IsOptional()
    @IsString()           recommendationSnapshotRef?: string; // optional ref to recommendation
  }
  ```
- **Custom validator:** `@IsMistHysteresisValid()` — `mist_off_threshold < mist_on_threshold`

**J2.2** — `TuningRecommendationResponseDto`
- **File:** `src/tuning/dtos/tuning-recommendation-response.dto.ts` (new)
- **Fields:**
  ```typescript
  class TuningRecommendationResponseDto {
    deviceId: string;
    kpi: KpiMetrics | null;
    currentConfig: TuningConfigSnapshot | null;
    recommendation: TuningAdvisory | null;
    blockReason: 'INSUFFICIENT_DATA' | 'DEVICE_OFFLINE' | 'NO_SUGGESTION' | 'CONFLICT' | null;
    blockReasonDetail: string | null;
    generatedAt: string;  // ISO8601
  }
  ```

#### J3 — TuningController: REST + SSE Endpoints

> **File:** `src/tuning/controllers/tuning.controller.ts` (new)

**J3.1** — Implement `getTuningRecommendations()`
- **Decorator:** `@Get(':id/analytics/tuning-recommendations')`
- **Guards:** `JwtAuthGuard`, `DeviceOwnershipGuard`
- **Signature:** `async getTuningRecommendations(@Param('id') deviceId: string, @Query('window') windowHours?: string): Promise<TuningRecommendationResponseDto>`
- **Logic:**
  1. Parse `windowHours` → default 24, max 168 (7 ngày)
  2. Gọi `ControlAnalyticsService.getKpiForDevice(deviceId, windowHours)`
  3. Gọi `ControlAnalyticsService.checkDeviceOnline(deviceId)`
  4. Nếu offline: return `{ blockReason: 'DEVICE_OFFLINE' }`
  5. Gọi `ControlAnalyticsService.checkCoverageGate(kpi)`
  6. Nếu không pass: return `{ blockReason: 'INSUFFICIENT_DATA', blockReasonDetail: reason }`
  7. Gọi `TuningRecommenderEngine.generateRecommendation(kpi, currentConfig)`
  8. Map result sang `TuningRecommendationResponseDto`

**J3.2** — Implement `createTuningConfiguration()`
- **Decorator:** `@Post(':id/tuning-configurations')`
- **Guards:** `JwtAuthGuard`, `DeviceOwnershipGuard`
- **Signature:** `async createTuningConfiguration(@Param('id') deviceId: string, @Body() dto: CreateTuningConfigurationDto, @Request() req): Promise<{ commandId: string; status: string }>`
- **Logic:**
  1. Extract actor từ `req.user` (không trust client-supplied `requestedBy`)
  2. Gọi `TuningConfigurationService.createPendingCommand({ ...dto, deviceId }, actor.email)`
  3. Return `202 Accepted` với `{ commandId, status: 'PENDING' }`
- **Error handling:**
  - `ConflictException` nếu `commandId` đã tồn tại (idempotency: return same row)
  - `NotFoundException` nếu device không tồn tại

**J3.3** — Implement `getLatestTuningConfiguration()`
- **Decorator:** `@Get(':id/tuning-configurations/latest')`
- **Guards:** `JwtAuthGuard`, `DeviceOwnershipGuard`
- **Signature:** `async getLatestTuningConfiguration(@Param('id') deviceId: string): Promise<DeviceTuningConfiguration | null>`
- **Logic:** Gọi `TuningConfigurationService.getLatestByDeviceId(deviceId)`

**J3.4** — Implement `getTuningHistory()`
- **Decorator:** `@Get(':id/tuning-history')`
- **Guards:** `JwtAuthGuard`, `DeviceOwnershipGuard`
- **Signature:** `async getTuningHistory(@Param('id') deviceId: string, @Query('limit') limit?: string, @Query('offset') offset?: string): Promise<TuningAuditLog[]>`
- **Logic:**
  - Parse limit (default 20, max 100), offset (default 0)
  - Gọi `TuningConfigurationService.getTuningHistory(deviceId, limit, offset)`

**J3.5** — Implement `streamTuningStatus()`
- **Decorator:** `@Sse(':id/tuning-configurations/stream')`
- **Guards:** `JwtAuthGuard`, `DeviceOwnershipGuard`
- **Signature:** `streamTuningStatus(@Param('id') deviceId: string): Observable<MessageEvent>`
- **Logic:**
  - `return this.tuningService.tuningSync$.pipe(filter(e => e.deviceId === deviceId), map(e => ({ data: e })))`
  - Không tạo Observable mới mỗi request; filter từ shared Subject

---

### TRACK K — FRONTEND: TUNING ADVISORY PANEL (Ngày 10–11)

#### K1 — Custom Hooks

> **File:** `app/hooks/useTuningRecommendation.ts` (new)
> **File:** `app/hooks/useTuningStatus.ts` (new)

**K1.1** — `useTuningRecommendation(deviceId: string)`
- **File:** `app/hooks/useTuningRecommendation.ts` (new)
- **Returns:** `{ data: TuningRecommendationResponseDto | null, isLoading: boolean, error: Error | null, refetch: () => void }`
- **Logic:**
  - Fetch `GET /api/backend/devices/${deviceId}/analytics/tuning-recommendations`
  - Không tạo base URL độc lập; reuse same-origin proxy pattern
  - `refetch()` gọi lại fetch và update state
  - Abort controller khi unmount

**K1.2** — `useTuningStatus(deviceId: string)`
- **File:** `app/hooks/useTuningStatus.ts` (new)
- **Returns:** `{ latestEvent: TuningStatusEvent | null, connectionState: 'connected' | 'reconnecting' | 'error' }`
- **Logic:**
  - Create `EventSource('/api/backend/devices/${deviceId}/tuning-configurations/stream')`
  - Không tạo EventSource độc lập; đi qua `/api/backend/` proxy
  - `onmessage`: parse JSON, update state
  - `onerror`: reconnect sau exponential backoff (500ms, 1s, 2s, max 10s)
  - Sau reconnect: gọi `refetch()` từ `useTuningRecommendation` để sync latest state
  - Cleanup `EventSource.close()` khi unmount hoặc `deviceId` đổi

#### K2 — Components

> **File:** `app/components/tuning/TuningAdvisoryPanel.tsx` (new)
> **File:** `app/components/tuning/TuningDiffView.tsx` (new)
> **File:** `app/components/tuning/TuningStatusBadge.tsx` (new)
> **File:** `app/components/tuning/CoverageWarning.tsx` (new)

**K2.1** — `TuningAdvisoryPanel`
- **File:** `app/components/tuning/TuningAdvisoryPanel.tsx` (new)
- **Props:** `{ deviceId: string }`
- **Phương thức/logic:**
  - Sử dụng `useSelectedDevice()` để verify `deviceId` hợp lệ
  - Sử dụng `useTuningRecommendation(deviceId)` để fetch data
  - Sử dụng `useTuningStatus(deviceId)` để nhận SSE
  - `handleConfirm()`:
    - Tạo `commandId = crypto.randomUUID()` phía client (idempotency)
    - POST `/api/backend/devices/${deviceId}/tuning-configurations`
    - Set state `pendingCommandId = commandId`
    - Disable confirm button cho đến khi nhận SSE hoặc timeout
  - `handleTimeout()`: sau 30s không có SSE event matching `pendingCommandId` → hiển thị "Chờ xác nhận từ thiết bị"
  - Render logic:
    - Loading skeleton khi `isLoading = true`
    - `<CoverageWarning />` khi `blockReason != null`
    - `<TuningDiffView />` khi có recommendation
    - Confirm button (disabled khi blockReason != null hoặc đang pending)
    - `<TuningStatusBadge />` khi có pending command

**K2.2** — `TuningDiffView`
- **File:** `app/components/tuning/TuningDiffView.tsx` (new)
- **Props:** `{ current: TuningConfigSnapshot, suggested: TuningConfigSnapshot, delta: Partial<TuningConfigSnapshot> }`
- **Render:** Table 4 hàng (lamp_gain_scale, mist_gain_scale, mist_on_threshold, mist_off_threshold)
  - Mỗi hàng: key | current value | → | suggested value | [changed badge] nếu trong delta
  - Hiển thị hard bounds range dưới mỗi row
  - Color code: xanh nếu tăng, cam nếu giảm, xám nếu không đổi

**K2.3** — `TuningStatusBadge`
- **File:** `app/components/tuning/TuningStatusBadge.tsx` (new)
- **Props:** `{ status: 'PENDING' | 'IN_SYNC' | 'REJECTED' | 'TIMEOUT', rejectionReason?: string }`
- **Render:**
  - `PENDING`: spinning indicator + "Đang chờ xác nhận từ thiết bị"
  - `IN_SYNC`: checkmark + "Đã áp dụng thành công"
  - `REJECTED`: ❌ + "Thiết bị từ chối: {rejectionReason}"
  - `TIMEOUT`: ⚠️ + "Chưa nhận phản hồi sau 30 giây"

**K2.4** — `CoverageWarning`
- **File:** `app/components/tuning/CoverageWarning.tsx` (new)
- **Props:** `{ reason: string, detail?: string }`
- **Render:** Banner màu vàng với icon cảnh báo, text giải thích lý do chặn recommendation

#### K3 — Tích hợp vào app/page.tsx

> **File:** `app/page.tsx` (modify)

**K3.1** — Import và render `TuningAdvisoryPanel`
- **Cần sửa:** phần render trong `app/page.tsx` (hoặc dashboard layout)
- **Cần thêm:**
  - Import `TuningAdvisoryPanel`
  - Render `<TuningAdvisoryPanel deviceId={selectedDeviceId} />` trong sidebar hoặc tab mới
  - Phải reuse `useSelectedDevice()` đã có; không tạo state riêng cho deviceId
  - Không auto-trigger fetch khi không có device được chọn

---

### TRACK L — E2E FAULT INJECTION TESTING (Ngày 12–13)

#### L1 — Test Suite: Fault Injection

> **File:** `test/tuning/fault-injection.e2e-spec.ts` (new)

**L1.1** — Scenario: Device offline → reconnect → receive retained desired
- **Test name:** `'should deliver retained desired to device on reconnect'`
- **Setup:** Backend publish desired retained; mock device disconnect; reconnect
- **Assert:** Device processes payload; reports ACCEPTED; Backend transitions to IN_SYNC

**L1.2** — Scenario: QoS-1 ACK duplicate
- **Test name:** `'should handle duplicate reported ACK idempotently'`
- **Setup:** Backend nhận reported ACCEPTED → IN_SYNC; inject same reported message lại
- **Assert:** DB vẫn là IN_SYNC; không thêm audit log; không phát SSE event thứ 2; không clear retained lại

**L1.3** — Scenario: ACK cũ sau desired mới
- **Test name:** `'should not clear retained desired when old ACK arrives after new command'`
- **Setup:** Command A (IN_SYNC); Command B (PENDING); inject ACK của A lại
- **Assert:** Retained desired B vẫn còn trên broker (verify `mqttClient.getRetained(topic)` != null)

**L1.4** — Scenario: NVS corrupt → safe defaults
- **Test name (firmware):** `'should load safe defaults when both NVS slots have invalid CRC'`
- **Setup:** Mock NVS read để return garbage bytes cho cả 2 slots
- **Assert:** `hydrateFromNvs()` return false; active config = defaults; không crash; log warning

**L1.5** — Scenario: Burst desired liên tục
- **Test name (firmware):** `'should not block Core 1 during MQTT desired burst'`
- **Setup:** Gửi 20 desired messages liên tiếp trong 1s
- **Assert:** Queue depth luôn ≤ 1; Core 1 chỉ apply effective config cuối; không heap allocation; không crash

**L1.6** — Scenario: Invalid desired payload variants
- **Test name:** `'should reject all invalid payload variants'`
- **Variants cần test:**
  - `NaN` trong field
  - `Infinity` trong field
  - String number (`"1.05"`) thay vì number
  - null field
  - missing required key
  - schema_version ≠ 1
  - wrong device_id
  - invalid UUID format
  - `mist_off_threshold >= mist_on_threshold`
  - value ngoài hard bounds
- **Assert mỗi variant:** reported REJECTED với đúng reason_code; RAM/NVS không đổi

**L1.7** — Scenario: Hysteresis tuning Mist không ảnh hưởng lamp/fan
- **Test name (firmware):** `'should not change lamp/fan thresholds when Mist hysteresis is tuned'`
- **Setup:** Apply config với `mist_on_threshold=0.30`, `mist_off_threshold=0.18`
- **Assert:** Lamp/fan vẫn dùng `FUZZY_ON_THRESHOLD=0.25`, `FUZZY_OFF_THRESHOLD=0.15`

#### L2 — Staging Dry Run Checklist

> **File:** `test/tuning/staging-checklist.md` (new)

**L2.1** — Định nghĩa staging checklist
- **File:** `test/tuning/staging-checklist.md` (new)
- **Nội dung checklist:**
  - [ ] Deploy backend với DB migration mới; verify migration chạy không lỗi
  - [ ] Provision InfluxDB analytics bucket và Influx Task
  - [ ] Connect ESP32 firmware đã flash v2.2; verify subscribe desired topic
  - [ ] Gửi 1 desired command từ UI; verify ACK nhận được trong 10s
  - [ ] Verify DB: `device_tuning_configurations` có row PENDING → IN_SYNC
  - [ ] Verify audit log: actor, config_before, config_after điền đúng
  - [ ] Verify SSE: browser nhận IN_SYNC event sau commit
  - [ ] Disconnect device 5 phút; verify desired retained vẫn còn
  - [ ] Reconnect device; verify ACK nhận và IN_SYNC
  - [ ] Kiểm tra lamp/fan behavior không thay đổi sau tuning Mist
  - [ ] Thực hiện rollback drill: gửi factory-safe snapshot; verify flow hoàn chỉnh
  - [ ] 24h dry run không có state drift hoặc memory leak
  - [ ] Review checklist và ký duyệt bởi operator

---

## 4. TIÊU CHUẨN RÀ SOÁT CỨNG

### 4.1 Bảo mật & Authz

**SEC-S2-01 — Actor identity bắt buộc từ JWT, không từ client body:**
> `TuningController.createTuningConfiguration()` phải extract `actor` từ `req.user.email` (JWT payload đã verify), **không** nhận `requestedBy` từ request body. Reviewer kiểm tra `CreateTuningConfigurationDto` không có field `requestedBy`; Service nhận `actor` từ controller parameter, không từ DTO.

**SEC-S2-02 — DeviceOwnershipGuard không bao giờ bypass:**
> Mọi endpoint trong `TuningController` phải có decorator `@UseGuards(JwtAuthGuard, DeviceOwnershipGuard)`. Reviewer đọc controller và verify không có endpoint nào thiếu guard. Test E2E: anonymous request → 401; authenticated nhưng wrong device → 403.

**SEC-S2-03 — Flux query không interpolate raw deviceId:**
> `ControlAnalyticsService.getKpiForDevice()` phải dùng `escapeFluxString(deviceId)` cho mọi filter theo `device_id`. Reviewer grep `control-analytics.service.ts` cho pattern `${deviceId}` trong Flux template literals và verify không tồn tại. Tất cả string params vào Flux phải qua escape helper.

**SEC-S2-04 — SSE stream filter theo deviceId, không broadcast:**
> `streamTuningStatus()` phải filter `tuningSync$` Subject để chỉ phát events của `deviceId` trong route param. Reviewer verify không thể một operator subscribe SSE của device khác bằng cách thay đổi deviceId trong URL (DeviceOwnershipGuard chặn ở guard level).

### 4.2 Correctness & Data Integrity

**CORR-S2-01 — RMSE tính rolling, không average-of-averages:**
> `ControlAnalyticsService.getKpiForDevice()` phải tính `tempRmse = Math.sqrt(totalSumSquaredError / totalSampleCount)`, với `totalSumSquaredError = SUM(sum_squared_error từ các hourly rows)` và `totalSampleCount = SUM(sample_count từ các hourly rows)`. Reviewer kiểm tra unit test có case: 2 giờ với RMSE khác nhau → verify kết quả rolling RMSE ≠ average của 2 RMSE.

**CORR-S2-02 — Recommendation bị chặn khi coverage không đủ:**
> `getTuningRecommendations()` endpoint phải gọi `checkCoverageGate()` trước `generateRecommendation()`. Nếu coverage < 80%, endpoint phải return `blockReason: 'INSUFFICIENT_DATA'` và không return `TuningAdvisory`. Reviewer verify unit test: mock KPI với `dataCoveragePercent=79` → không có advisory trong response.

**CORR-S2-03 — Rule conflict được detect và return CONFLICT, không silently pick one:**
> `TuningRecommenderEngine.generateRecommendation()` phải detect case R1 (mist chattering) và R3 (mist gain increase) cùng trigger và return `{ status: 'CONFLICT', conflictingRules: ['R1_MIST_CHATTERING', 'R3_HUMID_HIGH_MIST_OK'] }`. Reviewer verify unit test: mock KPI với `mistSwitchCountPerHour=11` và `humidRmse=6.0` → status là CONFLICT.

### 4.3 Hiệu năng & Reliability

**PERF-S2-01 — SSE Subject không leak khi device disconnect:**
> `streamTuningStatus()` dùng `takeUntil` hoặc cleanup trong `@Sse` handler để unsubscribe khi client disconnect. Reviewer verify: không có Observable subscription tích lũy sau nhiều SSE connections. Test: mở 100 SSE connections → close → verify subject subscriber count về 0.

**PERF-S2-02 — Influx Task Provisioner idempotent khi restart:**
> `ensureKpiTask()` phải check tồn tại trước khi create. Reviewer verify: restart backend 3 lần → chỉ 1 Influx Task tồn tại, không duplicate. Unit test: mock InfluxDB API trả task đã tồn tại → `ensureKpiTask()` không gọi create API.

**PERF-S2-03 — Frontend không polling; chỉ SSE + refetch sau reconnect:**
> `useTuningStatus` và `useTuningRecommendation` không được có `setInterval`, `setTimeout` polling loop. Reviewer grep hooks cho `setInterval` và verify chỉ có exponential backoff reconnect. Sau SSE reconnect, `refetch()` được gọi đúng một lần.

**PERF-S2-04 — Tuning history pagination bắt buộc, không query không giới hạn:**
> `getTuningHistory()` phải có `LIMIT` trong query; default 20, max 100. Reviewer verify SQL/TypeORM query có `take()` và `skip()`. Controller parse `limit` query param và clamp `Math.min(parseInt(limit) || 20, 100)`.
