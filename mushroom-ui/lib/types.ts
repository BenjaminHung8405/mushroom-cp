/**
 * 1. REAL-TIME SENSOR METRICS SCHEMA
 * Captures real-time environment metrics from the 3 critical high-humidity sensor nodes.
 */
export interface SensorTelemetry {
  // Relative Air Humidity measured by the SHT30 air sensor probe
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
    batteryBackupPercent: number;
    sdCardLoggingActive: boolean;
    cloudSyncStatus: "CONNECTED" | "DEGRADED" | "DISCONNECTED";
  };
}
