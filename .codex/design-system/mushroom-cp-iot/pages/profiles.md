# Profiles Page Overrides

> **PROJECT:** Mushroom CP IoT
> **Page Type:** Profile Manager (Biological Growth Curves & Operator Security)
> **Route:** `/admin/profiles`

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`.codex/design-system/mushroom-cp-iot/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout & Architecture

- **Max Width:** 1400px (Full dashboard container)
- **Navigation:** Dual-tab layout (`Hồ sơ Sinh học` & `Tài khoản Operator`)
- **Structure:**
  - **Header**: Active Farm House (35-Pillar Alpha), active crop day indicator (e.g. Day 12/21), and device sync status.
  - **Preset Bar**: Quick preset selection grid (Mùa Khô, Mùa Mưa, High Yield, Custom).
  - **Equalizer Editor Grid**:
    - **Main Area (8 Cols)**: Interactive 21-day Temperature (°C) & Relative Humidity (%) equalizer curves.
    - **Side Area (4 Cols)**: Real-time Biological Guardrails Status & Preset Export/Import controls.
  - **Light Schedule Layer**: 21-Day visual timeline block editor for heating/growth lamps.

### Spacing & Touch Targets

- **Draggable Checkpoint Handles**: 24px diameter touch targets with 44px hit-box for precise manipulation on field tablets.
- **Content Density**: Optimised for high information display while preserving high contrast ratios.

### Typography & Display Specs

- **Data Values & Setpoints**: `Fira Code` (Monospace font for numerical precision: 28.5°C, 85%, Day 14).
- **Labels & UI Control Text**: `Fira Sans` / `Inter`.
- **Text Color Minimum Ratio**: Contrast ratio ≥ 7:1 for outdoor visibility in greenhouse environments.

### Color Assignments

| Control | Color Token | Hex |
|---------|-------------|-----|
| Temperature Curve | `--temp-curve` | `#F97316` (Warm Orange) |
| Humidity Curve | `--humidity-curve` | `#38BDF8` (Sky Blue) |
| Light Block ON | `--light-on` | `#FBBF24` (Amber Gold) |
| Light Block OFF | `--light-off` | `#334155` (Slate-700) |
| Biological Guardrail Optimal | `--status-emerald` | `#22C55E` (Emerald Green) |
| Biological Guardrail Warning | `--status-amber` | `#F59E0B` (Amber) |
| Biological Guardrail Critical | `--status-crimson` | `#EF4444` (Crimson Red) |

---

## Component Requirements

- **Interactive 21-Day Curve Equalizer**: Snapping to `0.5°C` and `1%` increments, smooth line rendering (cubic bezier interpolation).
- **Biological Guardrail Indicator**: Live check against *Volvariella volvacea* thresholds (Temp 28-35°C mycelium / 28-30°C fruiting, Humidity 70-90%, CO2 800-1200ppm).
- **Operator Security Card**: Operator avatar, role badge (`Master Operator`), quick PIN update trigger.
- **1-to-N Farm Binding Modal**: Confirmation dialog displaying hardware sync status (`ACKED`, `APPLIED`, `PENDING`).
