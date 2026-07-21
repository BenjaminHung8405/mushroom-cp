#!/usr/bin/env bash
# ==============================================================================
# HƯỚNG DẪN VẬN HÀNH & PHỤC HỒI (OPERATIONAL & RECOVERY GUIDE)
# ==============================================================================
# Script này được thiết kế để tự động tạo bucket InfluxDB v2 (idempotent)
# phục vụ cho việc lưu trữ dữ liệu Analytics.
#
# Cách thức hoạt động:
#   1. Đọc biến môi trường từ file `.env` ở thư mục gốc (nếu có).
#   2. Gọi REST API của InfluxDB v2 để kiểm tra sự tồn tại của bucket.
#   3. Nếu bucket đã tồn tại, script sẽ bỏ qua một cách an toàn (idempotent).
#   4. Nếu chưa tồn tại, script sẽ lấy Org ID tương ứng và tiến hành tạo bucket
#      với chính sách lưu trữ (retention policy) cấu hình qua biến:
#      `INFLUXDB_ANALYTICS_RETENTION_DAYS` (mặc định = 0 tức là vô hạn).
#
# Cách chạy trực tiếp:
#   chmod +x scripts/provision-influx.sh
#   ./scripts/provision-influx.sh
#
# Các biến môi trường hỗ trợ:
#   - INFLUXDB_URL: URL API InfluxDB (mặc định: http://localhost:8086)
#   - INFLUXDB_TOKEN: Admin Token để xác thực (bắt buộc)
#   - INFLUXDB_ORG: Tên organization (mặc định: mushroom)
#   - INFLUXDB_ANALYTICS_BUCKET: Tên bucket analytics cần tạo (mặc định: mushroom_analytics)
#   - INFLUXDB_ANALYTICS_RETENTION_DAYS: Số ngày lưu trữ tối đa (0 = vô hạn, mặc định: 0)
#
# Xử lý sự cố / Recovery:
#   - Lỗi "INFLUXDB_TOKEN is required": Hãy chắc chắn rằng bạn đã khai báo INFLUXDB_TOKEN
#     trong file `.env` hoặc truyền trực tiếp qua môi trường.
#   - Lỗi kết nối (Connection refused): Đảm bảo container `mushroom_influxdb` đang chạy
#     và URL/Cổng cấu hình chính xác. Chạy `docker compose ps` để kiểm tra.
#   - Lỗi "Organization ... not found": Kiểm tra cấu hình `INFLUXDB_ORG` xem đã khớp
#     với Org khởi tạo của InfluxDB chưa.
# ==============================================================================

set -euo pipefail

# Lấy đường dẫn tới thư mục gốc dự án
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Load file cấu hình .env nếu tồn tại (không ghi đè các biến đã có sẵn trong môi trường)
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Bỏ qua các dòng comment hoặc dòng trống
    if [[ ! "$line" =~ ^[[:space:]]*# ]] && [[ "$line" == *"="* ]]; then
      key="${line%%=*}"
      val="${line#*=}"
      # Xóa khoảng trắng ở đầu/cuối
      key=$(echo "$key" | xargs)
      val=$(echo "$val" | xargs)
      
      # Chỉ export nếu biến chưa được định nghĩa trong môi trường
      if ! printenv "$key" >/dev/null 2>&1; then
        export "$key"="$val"
      fi
    fi
  done < .env
fi

# Các tham số cấu hình
INFL_URL="${INFLUXDB_URL:-http://localhost:8086}"
INFL_TOKEN="${INFLUXDB_TOKEN:-}"
INFL_ORG="${INFLUXDB_ORG:-mushroom}"
ANALYTICS_BUCKET="${INFLUXDB_ANALYTICS_BUCKET:-mushroom_analytics}"
RETENTION_DAYS="${INFLUXDB_ANALYTICS_RETENTION_DAYS:-0}"

# Kiểm tra token bắt buộc
if [ -z "$INFL_TOKEN" ]; then
  echo "[ERROR] INFLUXDB_TOKEN is required but not defined in environment or .env file." >&2
  exit 1
fi

echo "=========================================================="
echo "Starting InfluxDB Analytics Bucket Provisioning"
echo "  URL:              ${INFL_URL}"
echo "  Org:              ${INFL_ORG}"
echo "  Analytics Bucket: ${ANALYTICS_BUCKET}"
echo "  Retention Days:   ${RETENTION_DAYS} (0 = infinite)"
echo "=========================================================="

# 1. Kiểm tra sự tồn tại của bucket
echo "Verifying if bucket '${ANALYTICS_BUCKET}' already exists..."
BUCKET_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Token ${INFL_TOKEN}" \
  "${INFL_URL}/api/v2/buckets?name=${ANALYTICS_BUCKET}&org=${INFL_ORG}")

HTTP_STATUS=$(echo "$BUCKET_RESPONSE" | tail -n 1)
BODY=$(echo "$BUCKET_RESPONSE" | sed '$d')

EXISTS="false"
if [ "$HTTP_STATUS" -eq 404 ]; then
  EXISTS="false"
elif [ "$HTTP_STATUS" -eq 200 ]; then
  # Parse response để xem bucket có trong list không
  EXISTS=$(node -e "
    try {
      const data = JSON.parse(process.argv[1]);
      const exists = Array.isArray(data.buckets) && data.buckets.length > 0;
      console.log(exists ? 'true' : 'false');
    } catch (e) {
      console.log('error');
    }
  " "$BODY")
  if [ "$EXISTS" = "error" ]; then
    echo "[ERROR] Failed to parse InfluxDB buckets JSON response: ${BODY}" >&2
    exit 1
  fi
else
  echo "[ERROR] Failed to query buckets. InfluxDB returned HTTP status ${HTTP_STATUS}." >&2
  echo "Response body: ${BODY}" >&2
  exit 1
fi

if [ "$EXISTS" = "true" ]; then
  echo "[OK] Bucket '${ANALYTICS_BUCKET}' already exists. Skipping creation."
  exit 0
fi

# 2. Nếu chưa tồn tại, lấy Org ID
echo "Bucket does not exist. Fetching ID for Organization '${INFL_ORG}'..."
ORG_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Token ${INFL_TOKEN}" \
  "${INFL_URL}/api/v2/orgs?org=${INFL_ORG}")

ORG_STATUS=$(echo "$ORG_RESPONSE" | tail -n 1)
ORG_BODY=$(echo "$ORG_RESPONSE" | sed '$d')

if [ "$ORG_STATUS" -ne 200 ]; then
  echo "[ERROR] Failed to query organization ID. InfluxDB returned HTTP status ${ORG_STATUS}." >&2
  echo "Response body: ${ORG_BODY}" >&2
  exit 1
fi

ORG_ID=$(node -e "
  try {
    const data = JSON.parse(process.argv[1]);
    console.log(data.orgs?.[0]?.id || '');
  } catch (e) {
    console.log('');
  }
" "$ORG_BODY")

if [ -z "$ORG_ID" ]; then
  echo "[ERROR] Organization '${INFL_ORG}' not found." >&2
  exit 1
fi

echo "Found Organization ID: ${ORG_ID}"

# 3. Chuẩn bị payload và retention rules
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$RETENTION_DAYS" -gt 0 ]; then
  RETENTION_SECONDS=$(( RETENTION_DAYS * 86400 ))
  RULES_JSON="[{\"type\": \"expire\", \"everySeconds\": ${RETENTION_SECONDS}}]"
else
  RULES_JSON="[]"
fi

PAYLOAD=$(cat <<EOF
{
  "orgID": "${ORG_ID}",
  "name": "${ANALYTICS_BUCKET}",
  "retentionRules": ${RULES_JSON}
}
EOF
)

# 4. Thực hiện POST request để tạo bucket
echo "Creating bucket '${ANALYTICS_BUCKET}'..."
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Token ${INFL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${INFL_URL}/api/v2/buckets")

CREATE_STATUS=$(echo "$CREATE_RESPONSE" | tail -n 1)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

if [ "$CREATE_STATUS" -ne 201 ]; then
  echo "[ERROR] Failed to create bucket. InfluxDB returned HTTP status ${CREATE_STATUS}." >&2
  echo "Response body: ${CREATE_BODY}" >&2
  exit 1
fi

NEW_BUCKET_ID=$(node -e "
  try {
    const data = JSON.parse(process.argv[1]);
    console.log(data.id || '');
  } catch (e) {
    console.log('');
  }
" "$CREATE_BODY")

if [ -z "$NEW_BUCKET_ID" ]; then
  echo "[ERROR] Bucket created but response did not contain a valid ID. Response: ${CREATE_BODY}" >&2
  exit 1
fi

echo "[SUCCESS] Successfully provisioned bucket '${ANALYTICS_BUCKET}' with ID '${NEW_BUCKET_ID}'!"
