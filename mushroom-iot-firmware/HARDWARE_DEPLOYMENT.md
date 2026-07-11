# Hardware deployment safety requirements

## Relay default-off requirement

Every production SSR/relay driver must include an **external 10 kΩ pull-down resistor** on each ESP32 GPIO-to-relay gate/base path (GPIO 10, 11, 12, 13).

During bootloader execution, brown-in, watchdog reset, and power loss, ESP32 GPIOs can be high-impedance or indeterminate before firmware configures them LOW. Active-high relay circuits without an external pull-down can momentarily energize mist, heating, or fan loads.

The pull-down is mandatory hardware protection; firmware setting GPIO LOW after boot is not a substitute.

## Edge control safety

- Core 1 owns relay state using local hysteresis and max-on timers.
- MQTT/backend targets are advisory only.
- A failed humidity reading immediately forces mist OFF.
- SHT30 defog heater state holds the last relay outputs while heater is active and for a 30-second cooldown, because heater-biased measurements are not environmental truth.
- Core 1 registers with the explicit Task Watchdog and resets it after a completed control iteration.

## Time integrity

The backend currently records `receivedAt`, not device sample time. Do not add offline store-and-forward telemetry until firmware has NTP/RTC and sends `sampled_at`; delayed samples otherwise receive an incorrect timestamp.
