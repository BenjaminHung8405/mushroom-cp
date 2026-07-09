# Biological Guardrails & Operational Constraints

[cite_start]This document details the strict biological thresholds for tropical Straw Mushroom (_Volvariella volvacea_) cultivation and the localized operational guardrails for the Mekong Delta climate[cite: 26, 59]. The AI Agent must enforce these rules as hardcoded boundaries for default parameters, form validations, UI status indicators, and automation feedback systems inside the frontend.

---

## 1. Environmental Thresholds for Straw Mushroom (_Volvariella volvacea_)

[cite_start]Straw mushrooms are highly sensitive tropical fungi[cite: 56, 59]. [cite_start]Unlike button or oyster mushrooms, they require high-temperature and high-humidity environments to survive and yield premium quality[cite: 110, 112].

### A. Temperature Guardrails (DS18B20 Substrate Probe)

- [cite_start]**Mycelial Growth Phase (Giai đoạn nuôi tơ)**: The optimal temperature must be maintained strictly between 30°C and 35°C[cite: 110].
- [cite_start]**Fruiting Body Phase (Giai đoạn ra quả thể)**: The optimal temperature shifts slightly down to a range of 28°C to 30°C[cite: 110].
- [cite_start]**Absolute Display Range on Equalizer**: 20°C to 40°C[cite: 111].
- **UI Status Mappings**:
  - [cite_start]**Optimal (Emerald)**: 28°C to 35°C[cite: 110].
  - [cite_start]**Warning (Amber)**: 20°C to 27°C (slow growth) or 36°C to 38°C (heat stress)[cite: 111].
  - **Critical Dangerous Frost (Crimson)**: <20°C (causes permanent mycelium death).

### B. Relative Humidity (RH) Guardrails (SHT30 Air Sensor)

- [cite_start]**Optimal Target Range**: Relative humidity must be tightly controlled between 70% and 90% across all growth stages[cite: 112].
- **Absolute Display Range on Equalizer**: 50% to 100%.
- **UI Status Mappings**:
  - [cite_start]**Optimal (Emerald)**: 70% to 90%[cite: 112].
  - **Warning (Amber)**: 60% to 69% (drying risk) or 91% to 95% (oversaturation risk).
  - [cite_start]**Critical (Crimson)**: <60% or >95% (triggers contamination and pinhead abortion)[cite: 62].

### C. Ventilation & Air Quality Guardrails (SCD30 CO2 Sensor)

- **Optimal Range**: 800 ppm to 1200 ppm (ensures fresh air circulation without dropping internal moisture).
- **UI Status Mappings**:
  - **Optimal (Emerald)**: 800 to 1200 ppm.
  - **Warning (Amber)**: 1201 to 1500 ppm (inadequate fresh air interchange).
  - **Critical (Crimson)**: >1500 ppm (high risk of elongated, deformed mushroom stalks).

---

## 2. Actuator Hardware Operational Rules

[cite_start]The infrastructure layout uses a strict set of low-cost, high-humidity resistant physical actuators arranged for a facility with exactly 35 growing pillars[cite: 9, 13]. The UI elements must realistically display the state transitions of these components.

### A. Reversible Motorized Rail Misting System

- [cite_start]**Hardware Setup**: The system completely eliminates traditional rigid PVC distribution pipelines[cite: 12]. [cite_start]Instead, it uses a 6-viss ultrasonic mist generator unit [cite: 4, 7] [cite_start]mounted on a wheeled platform that physically moves back and forth on a sliding rail track[cite: 17].
- [cite_start]**Drive Mechanism**: Driven by a 220V reversible motor operating at a fixed rate of 60 RPM, utilizing a pulley and pull-cord mechanism[cite: 16].
- **UI Control & Feedback State Rules**:
  - [cite_start]**Travel Control**: Must show directional vector flags: `FORWARD`, `BACKWARD`, or `IDLE`[cite: 16].
  - [cite_start]**Position Slider Tracker**: A 0% to 100% linear track indicator representing the current physical location of the mister container inside the 4m x 6m room layout[cite: 9, 17].
  - [cite_start]**End-Limit Trigger Flags**: Must render interactive status indicators for physical end-limit touch switches located at both extremities of the rail track[cite: 8, 18]. [cite_start]When a switch state hits `true`, the UI must show automated direction reversal[cite: 8, 18].

### B. Convection and Air Circulation Fans

- [cite_start]**Operational Goal**: The dual convection fans run to uniformly distribute the dense fog emitted by the mobile ultrasonic mister throughout the air space, achieving ideal environment homogenization without localized cold-wet spots[cite: 7, 11].
- **UI Rule**: Toggles or automated progress sliders must indicate duty cycle percentages (0-100% intensity output) linked directly to the fuzzy system inferences.

### C. Dedicated Heating Lamps

- [cite_start]**Hardware Lifecycle**: The facility equips exactly 2 heating bulbs[cite: 14].
- [cite_start]**Time-Lock Window**: These lamps are strictly used during the initial spawn-running phase (the first 7 to 8 days of the cycle) to induce fast colonization[cite: 14]. [cite_start]Once the cycle enters the fruiting phase, the lamps must automatically lock to `OFF` to avoid causing premature drying or heat defects[cite: 14].

---

## 3. Intraday Protection & System Safeguards

Beyond the macroeconomic 21-day profile adjustments, the dashboard software core must enforce micro-safeguards to protect the delicate mushroom ecosystem from local daily weather extremes.

### A. Midday Thermal Shock Protection Window (Blackout Zone)

- [cite_start]**Biological Context**: During peak ambient heat intervals in the western provinces (such as An Giang, Dong Thap, and Can Tho), triggering high-intensity cold-water misting introduces extreme, sudden microclimatic temperature drops[cite: 5, 15]. [cite_start]This shifts mushrooms rapidly out of their optimal range, inducing severe thermal shock[cite: 15].
- [cite_start]**Software Rule**: The actuator dashboard and equalizer profiles must visually flag or programmatically enforce a **Misting Blackout Window between 11:00 AM and 1:30 PM**[cite: 15]. [cite_start]During this automated interval, automatic misting functions are locked out, and a protective shield badge labeled "Midday Thermal Guard Active" must appear on screen[cite: 15].

---

## 4. Hardware Fail-Safe & Telemetry Mapping

The frontend application operates alongside local gateway safety mechanisms designed for high-availability agricultural logging.

### A. Data Continuity & Logging Frequency

- [cite_start]**Interval Constraints**: The physical IoT nodes query environmental parameters and log telemetry points locally onto a physical SD card storage system at fixed 5-minute intervals[cite: 159, 160]. [cite_start]This process ensures continuous historical data preservation during local Wi-Fi or internet provider outages[cite: 160, 161].
- [cite_start]**UI Sync Indicator**: Display status flags reflecting backup states: `SD CARD: OK (LOGGING LOCAL)` and `CLOUD DATABASES: SYNCED`[cite: 160, 161].

### B. Auxiliary Power Source Telemetry (UPS Integration)

- [cite_start]**Infrastructure Rule**: The control system is equipped with an Uninterruptible Power Supply (UPS) / backup battery framework[cite: 25].
- [cite_start]**UI Element**: The top navigation status bar must clearly map power states[cite: 25]:
  - **Grid Power (Emerald)**: Default optimal operating electricity source.
  - [cite_start]**UPS Battery Active (Amber)**: Triggered immediately upon main grid failure[cite: 25]. [cite_start]The UI must flash an alert indicating that system sensors and essential controllers are drawing power from emergency battery modules to prevent complete environmental collapse[cite: 25].
