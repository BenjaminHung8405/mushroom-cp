# Mandatory Data Type Definitions & Frontend Schemas

This document defines the strict TypeScript interfaces and data schemas enforced across the entire smart mushroom house web application. All UI states, form components, local state store schemas (e.g., Zustand/React Context), and API boundaries must strictly implement these interfaces to ensure data integrity and compatibility with the fuzzy logic control core.

## 1. Domain Context Summary

[cite_start]The application tracks indoor agricultural parameters optimized exclusively for the tropical Straw Mushroom (_Volvariella volvacea_) strain[cite: 56, 165, 192].

- [cite_start]**Facility Capacity**: Each default house configuration maps exactly to an indoor layout holding 35 growing pillars[cite: 9, 164, 165].
- [cite_start]**Fuzzy Logic Telemetry**: Giao diện quản lý hiển thị các biến số mờ bao gồm Giá trị đặt ($SM_{set}$), Giá trị thực đo ($SM_{đo}$), và Sai số ($E$)[cite: 224, 225, 226].
- [cite_start]**Crop Cycle**: The production cycle profiles are structured around a multi-week optimization schedule[cite: 52, 143, 163, 182].

---

## 2. Core TypeScript Interfaces

```typescript
/**
 * 1. REAL-TIME SENSOR METRICS SCHEMA
 * Captures real-time environment metrics from the 3 critical high-humidity sensor nodes.
 */
export interface SensorTelemetry {
  // Relative Air Humidity measured by the SHT30 sensor probe
  humidity: {
    measuredValue: number; // Current value ($SM_{đo}$)
    setValue: number; // Target setpoint ($SM_{set}$) from the equalizer curve
    errorDelta: number; // Error value ($E = SM_{set} - SM_{đo}$)
    unit: "%";
    status: "optimal" | "warning" | "critical";
  };
  // Substrate/Compost and Water Temperature measured by the DS18B20 waterproof probe
  substrateTemp: {
    measuredValue: number; // Current value ($SM_{đo}$)
    setValue: number; // Target setpoint ($SM_{set}$) from the equalizer curve
    errorDelta: number; // Error value ($E = SM_{set} - SM_{đo}$)
    unit: "°C";
    status: "optimal" | "warning" | "critical";
  };
  // Carbon Dioxide concentration in the air room measured by the SCD30 sensor
  co2Level: {
    measuredValue: number;
    unit: "ppm";
    status: "optimal" | "warning" | "critical";
  };
  lastUpdated: string; // ISO Timestamp format
}

/**
 * 2. ACTUATOR CONTROL SYSTEM SCHEMA
 * Maps physical infrastructure equipment statuses and programmatic intensity values.
 */
export interface ActuatorSystemState {
  // Advanced Reversible Motor Rail System for the 6-viss ultrasonic mist generator
  movableMister: {
    id: string;
    isActive: boolean;
    currentPositionPercent: number; // Progress bar 0% (Home/Start) to 100% (End) on the rails
    travelDirection: "FORWARD" | "BACKWARD" | "IDLE";
    endLimitSwitches: {
      forwardHit: boolean; // True if the forward mechanical limit contact is touched
      backwardHit: boolean; // True if the backward mechanical limit contact is touched
    };
    dutyCyclePercent: number; // PWM intensity calculated by the fuzzy system (0-100%)
  };
  // Convection and circulation fans
  convectionFan: {
    id: string;
    isActive: boolean;
    dutyCyclePercent: number; // Automatic power speed or binary ON/OFF state mapping
  };
  // Heating Lamps used strictly during the early spawn-running phase
  heatingLamp: {
    id: string;
    isActive: boolean;
    forcedLockout: boolean; // Safety lock flag during the advanced fruiting stages
  };
  // System Protection Safeguard State
  middayMistingBlackoutActive: boolean; // True when forced lock blocks misting between 11:00 AM and 1:30 PM
}

/**
 * 3. INTERACTIVE CHART CHECKPOINT NODE SCHEMA
 * Structure for dynamic draggable equalizer points across the 21-day timeline.
 */
export interface ChartCheckpoint {
  id: string;
  day: number; // Axis-X: Integer value bounded from Day 1 to Day 21
  value: number; // Axis-Y: Target value clamped and snapped perfectly to 0.5 increments
}

/**
 * 4. LIGHT SCHEDULE TIMELINE BLOCK SCHEMA
 * Binary segment definition mimicking a video editing timeline layer for lamp schedules.
 */
export interface LightTimelineBlock {
  id: string;
  startDay: number; // Starting boundary day integer (1-21)
  endDay: number; // Ending boundary day integer (1-21)
  status: "ON" | "OFF"; // Binary state representing lamp power
}

/**
 * 5. MUSHROOM CROP GROWTH PROFILE SCHEMA
 * The unified reusable template object for distributing data-driven configuration curves.
 */
export interface MushroomGrowthProfile {
  id: string;
  name: string; // Profile template identifier, e.g., "Dry Season Optimization Profile"
  createdAt: string;
  lastModified: string;
  // Dynamic arrays used to render the adjustable equalizer grids
  temperatureCurve: ChartCheckpoint[]; // Ordered chronologically by day
  humidityCurve: ChartCheckpoint[]; // Ordered chronologically by day
  lightSchedule: LightTimelineBlock[]; // Non-overlapping array covering Day 1 to Day 21
}

/**
 * 6. FARM HOUSE CONFIGURATION SCHEMA
 * Manages institutional mapping for multiple physical facilities utilizing 1-to-N profile binding.
 */
export interface FarmHouseConfig {
  id: string;
  name: string; // e.g., "Mushroom Growing Room Alpha"
  pillarCount: number; // Static integer set to 35 pillars
  activeProfileId: string | null; // Associated optimization profile template ID
  currentCropDay: number; // Current day within the ongoing 21-day production cycle
  hardwareHealth: {
    powerSource: "GRID_POWER" | "UPS_BATTERY";
    batteryBackupPercent: number;
    sdCardLoggingActive: boolean;
    cloudSyncStatus: "CONNECTED" | "DEGRADED" | "DISCONNECTED";
  };
}
```

---

## 3. Strict State Modification Rules

When the AI Agent or code logic manipulates the states defined above, the following structural constraints must be checked and programmatically satisfied:

### A. Graph Coordinate Mathematical Clamping

- Any updates to `ChartCheckpoint.value` on the Temperature curve must be clamped between `20.0` and `40.0` and mathematically verified via:

$$\text{value} = \frac{\text{Math.round}(\text{inputValue} \times 2)}{2}$$

- Any updates to `ChartCheckpoint.value` on the Humidity curve must be clamped between `50.0` and `100.0` and calculated via the same $0.5$ scaling constraint.
- `ChartCheckpoint.day` must be cast using `Math.round()` to prevent floating-point numbers on the X-axis timeline grid.

### B. Anchor Node Immutable Restrictions

- Checkpoints where `day === 1` (Start anchor) or `day === 21` (Target cycle completion anchor) are completely protected against:

1. Deletion from the array.
2. X-axis positional changes (Modifying the `day` value is strictly blocked).

- Only vertical Y-axis value dragging is unlocked for these anchor elements.

### C. Light Schedule Block Integrity

- The `lightSchedule` blocks array must always represent a continuous timeline from Day 1 to Day 21.
- No two `LightTimelineBlock` objects can possess overlapping day ranges. (e.g., If Block A ends on Day 8, Block B must start precisely on Day 9).
