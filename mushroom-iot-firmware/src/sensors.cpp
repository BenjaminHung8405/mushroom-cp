#include "sensors.h"
#include <Arduino.h>

namespace sensors
{
    // Cờ kiểm tra trạng thái khởi tạo hệ thống cảm biến
    static bool sensors_initialized = false;

    bool init_sensors_placeholder()
    {
        Serial.println("[SENSORS] Initializing HAL Sensor Placeholders...");
        
        // Giả lập quá trình bắt tay với các cảm biến I2C/OneWire
        // Ở giai đoạn mock, chúng ta chỉ đánh dấu trạng thái khởi tạo thành công
        sensors_initialized = true;
        
        Serial.println("[SENSORS] HAL Sensor Placeholders initialized successfully.");
        return true;
    }

    bool read_sht30(float &temp, float &hum)
    {
        if (!sensors_initialized)
        {
            Serial.println("[SENSORS] ERROR: SHT30 read attempted before initialization!");
            temp = NAN;
            hum = NAN;
            return false;
        }

        // Placeholder trả về giá trị mặc định an toàn.
        // Logic mock chi tiết và sinh dữ liệu động sẽ được thực hiện ở Task F2.
        temp = 25.0f; 
        hum = 60.0f;
        return true;
    }

    bool read_ds18b20(float &temp)
    {
        if (!sensors_initialized)
        {
            Serial.println("[SENSORS] ERROR: DS18B20 read attempted before initialization!");
            temp = NAN;
            return false;
        }

        // Placeholder trả về giá trị mặc định an toàn.
        // Logic mock chi tiết và sinh dữ liệu động sẽ được thực hiện ở Task F2.
        temp = 28.0f;
        return true;
    }

    bool read_scd30(float &co2)
    {
        if (!sensors_initialized)
        {
            Serial.println("[SENSORS] ERROR: SCD30 read attempted before initialization!");
            co2 = NAN;
            return false;
        }

        // Placeholder trả về giá trị mặc định an toàn.
        // Logic mock chi tiết và sinh dữ liệu động sẽ được thực hiện ở Task F2.
        co2 = 800.0f;
        return true;
    }

    bool read_all_telemetry(TelemetryData &data)
    {
        bool success = true;

        float sht_temp = NAN;
        float sht_hum = NAN;
        if (read_sht30(sht_temp, sht_hum))
        {
            data.humidity_air = sht_hum;
        }
        else
        {
            data.humidity_air = NAN;
            success = false;
        }

        float ds_temp = NAN;
        if (read_ds18b20(ds_temp))
        {
            data.temp_substrate = ds_temp;
        }
        else
        {
            data.temp_substrate = NAN;
            success = false;
        }

        float scd_co2 = NAN;
        if (read_scd30(scd_co2))
        {
            data.co2_level = scd_co2;
        }
        else
        {
            data.co2_level = NAN;
            success = false;
        }

        return success;
    }

} // namespace sensors
