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

## Lean OTA and edge recovery (ESP32-S3 N16R8)

### Hardware and initial provisioning

This firmware target is for **ESP32-S3-WROOM N16R8**: 16 MiB flash and 8 MiB
OPI PSRAM. PlatformIO prints the generic `ESP32-S3-DevKitC-1-N8` board label,
but the project overrides the flash size and PSRAM type for N16R8. Do **not**
flash this image to an N8/no-PSRAM device.

The partition table is `partitions/partitions.csv`:

| Partition | Offset | Size | Purpose |
| --- | ---: | ---: | --- |
| `nvs` | `0x9000` | 20 KiB | Provisioning and OTA command state |
| `otadata` | `0xE000` | 8 KiB | OTA slot state / rollback flags |
| `app0` | `0x10000` | 3 MiB | Factory/current OTA application |
| `app1` | `0x310000` | 3 MiB | Alternate OTA application |
| `littlefs` | `0x610000` | 9.875 MiB | Offline storage |
| `coredump` | `0xFF0000` | 64 KiB | Panic dump for Orange Pi extraction |

The first deployment, and every migration from the old Arduino-only build,
**must be a full flash**. It writes the ESP-IDF-built bootloader that contains
the rollback feature, the partition table, and the application. Sending only
an OTA image cannot upgrade an already-flashed precompiled Arduino bootloader.

```bash
cd mushroom-iot-firmware
pio run -e otg
pio run -e otg --target upload
```

Use the appropriate `uart` environment and serial port when connected through
the CH343P bridge instead of native USB OTG. Keep the mandatory 10 kΩ external
pull-down on relay inputs; during OTA the firmware drives GPIO 10, 11, 12, and
13 HIGH (relay OFF for this active-low board) before it writes flash.

### OTA command contract

The Orange Pi hosts the image using local HTTP (for example Lighttpd) and
publishes the command on:

```text
{tenant}/esp32/{device_id}/down/command
```

Example payload:

```json
{
  "command_id": "ota_req_1029",
  "action": "OTA_UPDATE",
  "url": "http://192.168.1.50/firmware_v3.1.0.bin",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "size": 1450240,
  "version": "3.1.0"
}
```

`url`, `sha256`, and `size` may also be placed in the command's `parameters`
object. The device accepts **only `http://`** URLs because the endpoint is the
trusted, isolated farm LAN; integrity is provided by the required SHA-256 in
the MQTT command. Do not expose that HTTP server to an untrusted network.

Create metadata for the exact build artifact—not the ELF:

```bash
cd .pio/build/otg
sha256sum firmware.bin
stat -c%s firmware.bin
```

The firmware streams the response to the inactive OTA slot while calculating
SHA-256. It requires HTTP 200, a content length equal to `size`, a valid ESP
image, and an exact hash match. A failed stream or mismatch aborts the OTA
transaction and reports a `FAILED` command ACK; it does not reboot or switch
the boot slot.

### Native rollback health gate

The custom ESP-IDF bootloader is built with
`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`. A successfully downloaded image
boots as `ESP_OTA_IMG_PENDING_VERIFY`.

For the next 45 seconds, Core 0 requires both conditions:

1. A valid SHT30 measurement (not `NaN`).
2. A completed MQTT reconnection.

When both pass, it calls `esp_ota_mark_app_valid_cancel_rollback()` and sends
the successful OTA ACK. If either does not pass before the timeout, it calls
`esp_ota_mark_app_invalid_rollback_and_reboot()`. A panic, watchdog reset, or
other reset before validation also leaves the image pending, so the bootloader
returns to the previously valid OTA slot.

Before production rollout, test: a correct SHA update, a deliberately wrong
SHA (must remain on the old image), and a build with SHT30 or MQTT intentionally
broken (must return to the previous image after the health timeout).

### Orange Pi core-dump capture and rescue

The ESP32 writes panic data to the 64 KiB `coredump` partition. It does not
parse or publish a dump itself. Keep the **matching `firmware.elf`** for every
released `.bin`; symbols from another build are not reliable.

Install the ESP-IDF host tools on the Orange Pi so `esptool.py` and
`espcoredump.py` are in `PATH`, then capture/decode a device after a heartbeat
loss or panic:

```bash
./scripts/coredump_recovery.sh \
  --port /dev/ttyACM0 \
  --elf /srv/mushroom/releases/3.1.0/firmware.elf \
  --out-dir /var/lib/mushroom/coredumps
```

The script reads exactly `0x10000` bytes from `0xFF0000`, retains a raw dump,
and creates a decoded stack-trace report. A 64 KiB partition limits the amount
of task stack data retained; keep the core-dump task count/stack settings
within that budget and verify capture with `esp_system_abort()` on target
hardware.

Rescue flashing is intentionally never automatic. After capturing diagnostics,
an operator can explicitly write a known-good **3 MiB-compatible** application
image to `app0`:

```bash
./scripts/coredump_recovery.sh \
  --port /dev/ttyACM0 \
  --elf /srv/mushroom/releases/3.1.0/firmware.elf \
  --flash-factory /srv/mushroom/releases/3.1.0/firmware.bin
```

This writes only `app0` at `0x10000` and preserves bootloader, partition table,
and NVS. If the bootloader or partition table itself is damaged, use a wired
full flash from a verified release instead.
