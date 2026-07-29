# Alerts Page Overrides

> **PROJECT:** Mushroom CP IoT
> **Generated:** 2026-07-29 12:25:08
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility
- **Sections:** 1. Hero (Topic + Timer + Form), 2. What you'll learn, 3. Speaker Bio, 4. Urgency/Bonuses, 5. Form (again)

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Urgency: Red/Orange. Professional: Blue/Navy. Form: High contrast white.

### Component Overrides

- Avoid: No feedback after submit
- Avoid: No feedback during loading
- Avoid: Single row actions only

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Real-time chart animations, alert pulse/glow, status indicator blink animation, smooth data stream updates, loading effect
- Forms: Show loading then success/error state
- Feedback: Show spinner/skeleton for operations > 300ms
- Data Entry: Allow multi-select and bulk edit
- CTA Placement: Hero (Right side form) + Bottom anchor
