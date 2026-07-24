#pragma once

#include <stdint.h>
#include "core/models.h"

namespace sensors
{
    /**
     * @brief Enum định nghĩa các mã lỗi chi tiết của cảm biến.
     */
    enum class SensorError : uint8_t
    {
        SUCCESS = 0,
        ERR_NOT_INITIALIZED = 1,
        ERR_TIMEOUT = 2,
        ERR_CRC_MISMATCH = 3,
        ERR_DISCONNECTED = 4,
        ERR_OUT_OF_RANGE = 5
    };

    /**
     * @brief Khởi tạo bus I2C và driver SHT30.
     * Thiết kế theo dạng HAL, cô lập với logic chính.
     * @return true nếu khởi tạo thành công, false nếu có lỗi.
     */
    bool init_sensors_placeholder();

    /**
     * @brief Đọc nhiệt độ và độ ẩm không khí từ cảm biến SHT30 thật qua I2C.
     * @param[out] temp Nhiệt độ không khí (°C)
     * @param[out] hum Độ ẩm không khí (%)
     * @return true nếu đọc thành công, false nếu cảm biến lỗi.
     */
    bool read_sht30(float &temp, float &hum);

    /**
     * @brief Đọc nồng độ CO2 từ SCD30.
     * Trả về NAN (N/A) cho đến khi SCD30 được tích hợp phần cứng.
     * @param[out] co2 Nồng độ CO2 (ppm) — luôn NAN hiện tại
     * @return false (chưa có sensor).
     */
    bool read_scd30(float &co2);

    /**
     * @brief Đọc đồng thời toàn bộ telemetry vào struct TelemetryData.
     * @param[out] data Struct chứa dữ liệu telemetry đầu ra.
     * @return true nếu SHT30 hợp lệ, false nếu cảm biến lỗi.
     */
    bool read_all_telemetry(TelemetryData &data);

    /** True after at least one successful SHT30 sample in this boot session. */
    bool has_valid_sht30_read();

    // --- API bổ sung cho fault injection (SHT30) ---
    
    /**
     * @brief Lấy mã lỗi cuối cùng của cảm biến SHT30.
     */
    SensorError get_last_error_sht30();

    /**
     * @brief Giả lập trạng thái phần cứng của SHT30 (Fault Injection).
     * @param healthy true: cảm biến hoạt động bình thường, false: giả lập lỗi.
     */
    void set_simulated_health_sht30(bool healthy);

    /**
     * @brief True while SHT30 internal heater is ON or within post-heater cool-down.
     * Control loops must hold last outputs — heater biases temp up / RH down.
     */
    bool is_sht30_defogging();

#ifdef UNIT_TEST
    /**
     * @brief Reset initialization flag for unit tests.
     */
    void reset_sensors_initialized_for_test();
#endif

} // namespace sensors
