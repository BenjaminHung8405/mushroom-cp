# Hardware deployment safety requirements

## Relay default-off requirement

Every production SSR/relay driver must include an **external 10 kΩ pull-down resistor** on each ESP32 GPIO-to-relay gate/base path (GPIO 10, 11, 12, 13).

During bootloader execution, brown-in, watchdog reset, and power loss, ESP32 GPIOs can be high-impedance or indeterminate before firmware configures them LOW. Active-high relay circuits without an external pull-down can momentarily energize mist, heating, or fan loads.

The pull-down is mandatory hardware protection; firmware setting GPIO LOW after boot is not a substitute.

## Edge control safety

- Core 1 owns SSR state through fuzzy control, output arbitration, hardware protection, and direct ON/OFF dispatch.
- MQTT/backend targets are advisory inputs; persisted baseline and manual override commands are validated before they affect Core 1 state.
- Invalid sensor values produce fail-safe fuzzy demands and the biosafety interlock forces HWat/Mist OFF when RTC time is invalid or during the blackout window.
- The direct relay dispatcher is the only SSR GPIO writer. It applies stable ON/OFF states and writes a GPIO only when that state changes; there is no PWM or pulse scheduling.
- Core 1 registers with the explicit Task Watchdog and resets it after a completed control iteration.

## Time integrity

Live telemetry uses backend `receivedAt`. Offline binary sync uses `boot_count` + `delta_time_s`; the backend stores an explicitly interpolated timestamp rather than claiming device UTC.


## Offline telemetry power-loss capture

- GPIO **14** is dedicated to the active-LOW power-loss detector. Do not share it
  with a button or relay signal. The firmware wakes a high-priority task from its
  ISR; it never writes LittleFS from interrupt context.
- The power-fail circuit needs a measured hold-up budget sufficient for the
  **worst-case 4.5 MiB PSRAM ring flush** plus LittleFS write/flush latency. A
  capacitor/UPS that only holds the detector signal is insufficient.
- Flash writes cannot be guaranteed after the rail collapses. The journal is
  append-only and recovers complete records after an interrupted write, but a
  hold-up test on production hardware remains mandatory.
