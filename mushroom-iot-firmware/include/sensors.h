#pragma once

#include <stdint.h>
#include "models.h"

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
     * @brief Khởi tạo các placeholder cho cảm biến (SHT30, DS18B20, SCD30).
     * Thiết kế theo dạng HAL, cô lập với logic chính.
     * @return true nếu khởi tạo thành công, false nếu có lỗi.
     */
    bool init_sensors_placeholder();

    /**
     * @brief Đọc nhiệt độ và độ ẩm không khí giả lập từ cảm biến SHT30.
     * @param[out] temp Nhiệt độ không khí (°C)
     * @param[out] hum Độ ẩm không khí (%)
     * @return true nếu đọc thành công, false nếu cảm biến lỗi.
     */
    bool read_sht30(float &temp, float &hum);

    /**
     * @brief Đọc nhiệt độ cơ chất giả lập từ cảm biến DS18B20.
     * @param[out] temp Nhiệt độ cơ chất (°C)
     * @return true nếu đọc thành công, false nếu cảm biến lỗi.
     */
    bool read_ds18b20(float &temp);

    /**
     * @brief Đọc nồng độ CO2 giả lập từ cảm biến SCD30.
     * @param[out] co2 Nồng độ CO2 (ppm)
     * @return true nếu đọc thành công, false nếu cảm biến lỗi.
     */
    bool read_scd30(float &co2);

    /**
     * @brief Đọc đồng thời toàn bộ telemetry từ các cảm biến vào struct TelemetryData.
     * @param[out] data Struct chứa dữ liệu telemetry đầu ra.
     * @return true nếu toàn bộ dữ liệu hợp lệ, false nếu bất kỳ cảm biến nào lỗi.
     */
    bool read_all_telemetry(TelemetryData &data);

    // --- Các API bổ sung cho việc giả lập lỗi và kiểm toán độc lập ---
    
    /**
     * @brief Lấy mã lỗi cuối cùng của cảm biến SHT30.
     */
    SensorError get_last_error_sht30();

    /**
     * @brief Lấy mã lỗi cuối cùng của cảm biến DS18B20.
     */
    SensorError get_last_error_ds18b20();

    /**
     * @brief Lấy mã lỗi cuối cùng của cảm biến SCD30.
     */
    SensorError get_last_error_scd30();

    /**
     * @brief Giả lập trạng thái phần cứng của cảm biến SHT30 (Fault Injection).
     * @param healthy true: cảm biến hoạt động bình thường, false: giả lập lỗi chập mạch/mất kết nối.
     */
    void set_simulated_health_sht30(bool healthy);

    /**
     * @brief Giả lập trạng thái phần cứng của cảm biến DS18B20 (Fault Injection).
     * @param healthy true: cảm biến hoạt động bình thường, false: giả lập lỗi chập mạch/mất kết nối.
     */
    void set_simulated_health_ds18b20(bool healthy);

    /**
     * @brief Giả lập trạng thái phần cứng của cảm biến SCD30 (Fault Injection).
     * @param healthy true: cảm biến hoạt động bình thường, false: giả lập lỗi chập mạch/mất kết nối.
     */
    void set_simulated_health_scd30(bool healthy);

} // namespace sensors
