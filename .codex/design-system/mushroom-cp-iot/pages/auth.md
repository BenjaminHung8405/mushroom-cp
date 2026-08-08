# Auth Page Overrides

> **PROJECT:** Mushroom CP IoT
> **Page Type:** Auth / Fast Kiosk Login

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 800px (Centered card/kiosk container layout)
- **Grid:** 1-column mobile, 2 to 3-column user avatar selection grid
- **Touch Target Minimum:** 64px for Numpad key buttons, 44px for secondary action buttons

### Typography Overrides

- **Headings:** Fira Code (Technical, precise)
- **Body & Labels:** Fira Sans
- **Descriptions Minimum Font Size:** `text-sm` (14px) to ensure high visibility in outdoor farm sunlight conditions
- **Descriptions Minimum Color:** `text-slate-300` for WCAG AAA outdoor contrast ratio (≥ 7:1)

### Interaction Model (Touchscreen Kiosk)

- **Active-First Interaction:** Prioritize `:active` states over `:hover` states since kiosks are touchscreen devices.
- **Haptic Feedback:** Trigger `navigator.vibrate(50)` on key press where supported.
- **Motion Accessibility:** All animations (shake, bounce, spin) must use `motion-safe:` guards to respect `prefers-reduced-motion`.
- **Keyboard Input:** Force numeric keyboard on mobile/tablet via `inputMode="numeric"` and `pattern="[0-9]*"` for all SĐT and PIN input fields.

### Style Guidelines

- **Avatar Selection:** Fixed 8 Preset Agriculture Lucide Icons (no arbitrary upload). Display initial letters (2 caps) inside 80px circle, full name capped at 2 lines below.
- **Visual Step Indicator:** Clear dot progress indicator (`StepProgress`) for multi-step modals.
- **Farmer-Friendly Language:** Avoid technical jargon (no "Argon2id", "Cryptographic Device Binding", or "Primary Password"). Use clear, friendly Vietnamese terms ("Số điện thoại", "Mật khẩu", "AgriSmart OS").
