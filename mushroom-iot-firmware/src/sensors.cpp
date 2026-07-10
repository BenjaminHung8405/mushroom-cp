#include "sensors.h"
#include "config.h"
#ifndef UNIT_TEST
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <cmath>
#else
#include "Arduino.h"  // Mock header from test/Arduino.h
#include <cmath>
#endif

namespace sensors
{
    // Cờ kiểm tra trạng thái khởi tạo hệ thống cảm biến
    static bool sensors_initialized = false;

    // Cờ giả lập trạng thái hoạt động của cảm biến (Fault Injection)
    static bool sht30_healthy = true;
    static bool ds18b20_healthy = true;
    static bool scd30_healthy = true;

    // Lưu mã lỗi cuối cùng của từng cảm biến
    static SensorError sht30_last_error = SensorError::SUCCESS;
    static SensorError ds18b20_last_error = SensorError::SUCCESS;
    static SensorError scd30_last_error = SensorError::SUCCESS;

#ifndef UNIT_TEST
    static Adafruit_SHT31 sht30 = Adafruit_SHT31();
#endif

    bool init_sensors_placeholder()
    {
#ifndef UNIT_TEST
        Serial.println("[SENSORS] Initializing Real I2C Bus and SHT30...");
        
        if (!Wire.begin(config::pins::PIN_I2C_SDA, config::pins::PIN_I2C_SCL, 50000))
        {
            Serial.println("[SENSORS] ERROR: Failed to initialize I2C bus!");
            sht30_healthy = false;
            return false;
        }
        
#if defined(ESP32)
        Wire.setTimeOut(3); // 3ms timeout corresponding to 3000us
#else
        Wire.setWireTimeout(3000, true);
#endif
        
        if (!sht30.begin(0x44))
        {
            Serial.println("[SENSORS] ERROR: SHT30 not found at 0x44!");
            sht30_healthy = false;
            return false;
        }
        
        sht30.heater(false);
        
        sensors_initialized = true;
        sht30_healthy = true;
        ds18b20_healthy = true;
        scd30_healthy = true;

        sht30_last_error = SensorError::SUCCESS;
        ds18b20_last_error = SensorError::SUCCESS;
        scd30_last_error = SensorError::SUCCESS;
        
        Serial.println("[SENSORS] Real I2C Bus and SHT30 initialized successfully.");
        return true;
#else
        Serial.println("[SENSORS] Initializing HAL Sensor Placeholders...");
        
        // Giả lập quá trình bắt tay với các cảm biến I2C/OneWire
        sensors_initialized = true;
        sht30_healthy = true;
        ds18b20_healthy = true;
        scd30_healthy = true;

        sht30_last_error = SensorError::SUCCESS;
        ds18b20_last_error = SensorError::SUCCESS;
        scd30_last_error = SensorError::SUCCESS;
        
        Serial.println("[SENSORS] HAL Sensor Placeholders initialized successfully.");
        return true;
#endif
    }

    bool read_sht30(float &temp, float &hum)
    {
        if (!sensors_initialized)
        {
            sht30_last_error = SensorError::ERR_NOT_INITIALIZED;
            temp = NAN;
            hum = NAN;
            Serial.println("[SENSORS] ERROR: SHT30 read attempted before initialization!");
            return false;
        }

        if (!sht30_healthy)
        {
            sht30_last_error = SensorError::ERR_DISCONNECTED;
            temp = NAN;
            hum = NAN;
            Serial.println("[SENSORS] ERROR: SHT30 sensor disconnected or faulty!");
            return false;
        }

#ifndef UNIT_TEST
        temp = sht30.readTemperature();
        hum = sht30.readHumidity();

        if (std::isnan(temp) || std::isnan(hum))
        {
            sht30_last_error = SensorError::ERR_CRC_MISMATCH;
            temp = NAN;
            hum = NAN;
            return false;
        }

        // --- Heater State Machine (Task D2) ---
        static unsigned long humidity_saturated_start = 0;
        static unsigned long heat_start_time = 0;
        static bool is_heating = false;

        unsigned long now = millis();

        if (!is_heating)
        {
            if (hum >= 99.0f)
            {
                if (humidity_saturated_start == 0)
                {
                    humidity_saturated_start = now;
                }
                else if (now - humidity_saturated_start > 600000UL) // 10 minutes
                {
                    Serial.println("[SENSORS] WARNING: Humidity saturated (>= 99%) for 10 minutes. Enabling SHT30 heater!");
                    sht30.heater(true);
                    is_heating = true;
                    heat_start_time = now;
                }
            }
            else
            {
                humidity_saturated_start = 0;
            }
        }
        else
        {
            // Always set temperature output to NAN while heating
            temp = NAN;

            if ((now - heat_start_time > 300000UL) || (hum < 90.0f)) // 5 minutes OR humidity < 90%
            {
                Serial.println("[SENSORS] INFO: Disabling SHT30 heater, returning to normal operation.");
                sht30.heater(false);
                is_heating = false;
                humidity_saturated_start = 0; // reset saturation timer for cooldown
            }
        }
#else
        // Tạo dữ liệu giả lập động chạy theo thời gian (sử dụng hàm lượng giác sine/cosine)
        unsigned long m = millis();
        // Nhiệt độ không khí dao động trong khoảng [23.0, 27.0] °C
        temp = 25.0f + 2.0f * std::sin(m / 10000.0f);
        // Độ ẩm không khí dao động trong khoảng [75.0, 85.0] %
        hum = 80.0f + 5.0f * std::cos(m / 15000.0f);
#endif

        // Kiểm tra xem dữ liệu có nằm trong dải đo an toàn vật lý hợp lệ không
        if (temp < -40.0f || temp > 125.0f || hum < 0.0f || hum > 100.0f)
        {
            sht30_last_error = SensorError::ERR_OUT_OF_RANGE;
            temp = NAN;
            hum = NAN;
            return false;
        }

        sht30_last_error = SensorError::SUCCESS;
        return true;
    }

    bool read_ds18b20(float &temp)
    {
        if (!sensors_initialized)
        {
            ds18b20_last_error = SensorError::ERR_NOT_INITIALIZED;
            temp = NAN;
            Serial.println("[SENSORS] ERROR: DS18B20 read attempted before initialization!");
            return false;
        }

        if (!ds18b20_healthy)
        {
            ds18b20_last_error = SensorError::ERR_DISCONNECTED;
            temp = NAN;
            Serial.println("[SENSORS] ERROR: DS18B20 sensor disconnected or faulty!");
            return false;
        }

        // Tạo dữ liệu giả lập động chạy theo thời gian
        unsigned long m = millis();
        // Nhiệt độ cơ chất dao động trong khoảng [20.5, 23.5] °C
        temp = 22.0f + 1.5f * std::sin(m / 20000.0f);

        // Kiểm tra dải đo vật lý DS18B20 [-55.0, 125.0]
        if (temp < -55.0f || temp > 125.0f)
        {
            ds18b20_last_error = SensorError::ERR_OUT_OF_RANGE;
            temp = NAN;
            return false;
        }

        ds18b20_last_error = SensorError::SUCCESS;
        return true;
    }

    bool read_scd30(float &co2)
    {
        if (!sensors_initialized)
        {
            scd30_last_error = SensorError::ERR_NOT_INITIALIZED;
            co2 = NAN;
            Serial.println("[SENSORS] ERROR: SCD30 read attempted before initialization!");
            return false;
        }

        if (!scd30_healthy)
        {
            scd30_last_error = SensorError::ERR_DISCONNECTED;
            co2 = NAN;
            Serial.println("[SENSORS] ERROR: SCD30 sensor disconnected or faulty!");
            return false;
        }

        // Tạo dữ liệu giả lập động chạy theo thời gian
        unsigned long m = millis();
        // Nồng độ CO2 dao động trong khoảng [450, 750] ppm
        co2 = 600.0f + 150.0f * std::sin(m / 30000.0f);

        // Kiểm tra dải đo vật lý SCD30 [0, 40000]
        if (co2 < 0.0f || co2 > 40000.0f)
        {
            scd30_last_error = SensorError::ERR_OUT_OF_RANGE;
            co2 = NAN;
            return false;
        }

        scd30_last_error = SensorError::SUCCESS;
        return true;
    }

    bool read_all_telemetry(TelemetryData &data)
    {
        bool success = true;

        float sht_temp = NAN;
        float sht_hum = NAN;
        if (read_sht30(sht_temp, sht_hum))
        {
            data.temp_air     = sht_temp;
            data.humidity_air = sht_hum;
        }
        else
        {
            data.temp_air     = NAN;
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

    // --- Các API bổ sung cho việc giả lập lỗi và kiểm toán độc lập ---
    
    SensorError get_last_error_sht30()
    {
        return sht30_last_error;
    }

    SensorError get_last_error_ds18b20()
    {
        return ds18b20_last_error;
    }

    SensorError get_last_error_scd30()
    {
        return scd30_last_error;
    }

    void set_simulated_health_sht30(bool healthy)
    {
        sht30_healthy = healthy;
    }

    void set_simulated_health_ds18b20(bool healthy)
    {
        ds18b20_healthy = healthy;
    }

    void set_simulated_health_scd30(bool healthy)
    {
        scd30_healthy = healthy;
    }

} // namespace sensors
