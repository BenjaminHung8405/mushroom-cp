#!/usr/bin/env bash
# Read and decode an ESP32-S3 core dump on the Orange Pi. This script is
# intentionally manual: it never reflashes a device unless --flash-factory is
# specified explicitly.
set -euo pipefail

readonly COREDUMP_OFFSET=0xFF0000
readonly COREDUMP_SIZE=0x10000

usage() {
    cat <<'EOF'
Usage:
  coredump_recovery.sh --port /dev/ttyACM0 --elf firmware.elf [options]

Options:
  --port PATH            ESP32 serial/USB device (required).
  --elf PATH             Exact firmware.elf from the running firmware (required).
  --out-dir PATH         Directory for raw dump and decoded report (default: ./coredumps).
  --baud RATE            Serial rate for esptool (default: 921600).
  --flash-factory BIN    Explicitly replace app0 with a 3 MiB-compatible app image after capture.
  -h, --help             Show this help.

The script always captures the 64 KiB coredump partition at flash offset
0xFF0000 before decoding. --flash-factory is deliberately opt-in and writes
only app0 (0x10000); it does not erase flash, bootloader, partitions, or NVS.
EOF
}

port=""
elf=""
out_dir="./coredumps"
baud="921600"
factory_bin=""

while (($#)); do
    case "$1" in
        --port) port=${2:?Missing value for --port}; shift 2 ;;
        --elf) elf=${2:?Missing value for --elf}; shift 2 ;;
        --out-dir) out_dir=${2:?Missing value for --out-dir}; shift 2 ;;
        --baud) baud=${2:?Missing value for --baud}; shift 2 ;;
        --flash-factory) factory_bin=${2:?Missing value for --flash-factory}; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[[ -n "$port" ]] || { echo "--port is required." >&2; exit 2; }
[[ -f "$elf" ]] || { echo "ELF not found: $elf" >&2; exit 2; }
[[ -z "$factory_bin" || -f "$factory_bin" ]] || {
    echo "Factory image not found: $factory_bin" >&2
    exit 2
}

command -v esptool.py >/dev/null 2>&1 || {
    echo "Missing esptool.py. Install it on Orange Pi: python3 -m pip install --user esptool" >&2
    exit 1
}
command -v espcoredump.py >/dev/null 2>&1 || {
    echo "Missing espcoredump.py. Install ESP-IDF tools, then expose espcoredump.py in PATH." >&2
    exit 1
}

mkdir -p "$out_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
raw_dump="$out_dir/coredump-${timestamp}.raw"
report="$out_dir/coredump-${timestamp}.txt"

echo "[coredump] Reading ${COREDUMP_SIZE} bytes at ${COREDUMP_OFFSET} from ${port}..."
esptool.py --chip esp32s3 --port "$port" --baud "$baud" \
    read_flash "$COREDUMP_OFFSET" "$COREDUMP_SIZE" "$raw_dump"

if cmp -s "$raw_dump" <(head -c "$((COREDUMP_SIZE))" /dev/zero | tr '\0' '\377'); then
    echo "[coredump] Partition is erased; no core dump to decode." >&2
    exit 3
fi

echo "[coredump] Decoding with ELF: $elf"
if ! espcoredump.py --chip esp32s3 --core "$raw_dump" --core-format raw \
    info_corefile "$elf" >"$report" 2>&1; then
    echo "[coredump] Decode failed. Raw image retained at: $raw_dump" >&2
    echo "[coredump] Report/error log: $report" >&2
    exit 1
fi

echo "[coredump] Raw dump: $raw_dump"
echo "[coredump] Decoded report: $report"

if [[ -n "$factory_bin" ]]; then
    echo "[rescue] Explicit rescue requested: writing app0 at 0x10000."
    esptool.py --chip esp32s3 --port "$port" --baud "$baud" \
        write_flash 0x10000 "$factory_bin"
    echo "[rescue] Factory image flashed. The existing bootloader, partition table, and NVS were preserved."
fi
