# Profile Manager Page Design System Override

> **Page Route:** `/admin/profiles`
> **Master File:** `design-system/mushroom-profile-manager/MASTER.md`

---

## Page-Specific Layout & Hierarchy

1. **Header Zone**:
   - Title: `Profile Manager | Quản Lý Cấu Hình & Tài Khoản`
   - Active Facility Badge: `Nhà Nấm Alpha (35 Trụ)`
   - Current Cycle Indicator: `Ngày 12/21 (Giai đoạn Ra Quả Thể)`
   - Status Indicator: `Sync Status: ACKED` (Emerald `#22C55E` pulse dot)

2. **Tabbed Navigation**:
   - Tab 1: `Hồ Sơ Sinh Học (Crop Growth Profiles)` - Active Icon: `Sprout`
   - Tab 2: `Tài Khoản & An Ninh (Operator Security)` - Active Icon: `ShieldCheck`

3. **Crop Growth Profiles Tab**:
   - **Top Bar**: Preset Quick Select Cards (3 columns desktop, 1 column mobile)
   - **Main Equalizer Grid**:
     - Left (2/3 width): 21-Day Temperature & Humidity Equalizer Curves with draggable checkpoint nodes snapped to `0.5°C` / `1%` increments.
     - Right (1/3 width): Biological Guardrails Live Status & Preset Export/Import Controls.
   - **Bottom Layer**: 21-Day Light Schedule Timeline Block Bar (Day 1 to 21 binary blocks).

4. **Operator & Security Tab**:
   - **Operator Card**: Profile picture / Avatar fallback, Name, Role badge (`Master Operator`), Last Login timestamp.
   - **PIN Management Card**: 4-digit PIN security status, "Đổi mã PIN" button triggering security modal.
   - **Active Sessions & Audit Trail**: Real-time event log stream table with action timestamps.

---

## Color Tokens Specific to Page

| Element | Color | Token |
|---------|-------|-------|
| Temperature Line | `#F97316` (Orange-500) | `--temp-curve-color` |
| Humidity Line | `#38BDF8` (Sky-400) | `--humidity-curve-color` |
| Light Timeline Block ON | `#FBBF24` (Amber-400) | `--light-on-color` |
| Light Timeline Block OFF | `#334155` (Slate-700) | `--light-off-color` |
| Optimal Status | `#22C55E` (Emerald-500) | `--status-optimal` |
| Warning Status | `#F59E0B` (Amber-500) | `--status-warning` |
| Danger Status | `#EF4444` (Red-500) | `--status-danger` |

---

## UX Interactions & Animation Rules

- **Checkpoint Dragging**: 150ms smooth transition, cursor `grab` / `grabbing`.
- **Preset Selection**: Hover scale `1.02` with 200ms ease border color shift to `#22C55E`.
- **Tab Switching**: Fade-in transition (`opacity 0 -> 1`, 200ms duration).
- **Modal Display**: Overlay backdrop blur `blur(8px)` with scale transition (`transform scale(0.95) -> scale(1)`).
