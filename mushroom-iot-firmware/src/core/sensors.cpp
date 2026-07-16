#include "core/sensors.h"
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

    // Cờ giả lập trạng thái hoạt động của cảm biến SHT30 (Fault Injection)
    static bool sht30_healthy = true;

    // Lưu mã lỗi cuối cùng của SHT30
    static SensorError sht30_last_error = SensorError::SUCCESS;

    // SHT30 defog heater state — heater biases temp UP / RH DOWN (finite, not NAN).
    // Control loops must hold last outputs for heater ON + cool-down.
    static bool sht30_heater_active = false;
    static unsigned long sht30_defog_hold_until = 0;
    constexpr unsigned long SHT30_DEFOG_COOLDOWN_MS = 30000UL;

#ifndef UNIT_TEST
    static Adafruit_SHT31 sht30 = Adafruit_SHT31();
#endif

    bool init_sensors_placeholder()
    {
#ifndef UNIT_TEST
        Serial.println("[SENSORS] Initializing Real I2C Bus and SHT30...");
        
#if defined(ESP32)
        // Thiết lập chân I2C tùy chỉnh trước khi gọi begin của thư viện ngoài
        Wire.setPins(config::pins::PIN_I2C_SDA, config::pins::PIN_I2C_SCL);
#endif
        
        if (!sht30.begin(0x44))
        {
            Serial.println("[SENSORS] ERROR: SHT30 not found at 0x44!");
            sht30_healthy = false;
            return false;
        }
        
        // Thiết lập tần số I2C bus ở mức 50kHz sau khi khởi tạo thành công
        Wire.setClock(50000);
        
#if defined(ESP32)
        Wire.setTimeOut(3); // 3ms timeout corresponding to 3000us
#else
        Wire.setWireTimeout(3000, true);
#endif
        
        sht30.heater(false);
        
        sensors_initialized = true;
        sht30_healthy = true;

        sht30_last_error = SensorError::SUCCESS;
        
        Serial.println("[SENSORS] Real I2C Bus and SHT30 initialized successfully.");
        return true;
#else
        Serial.println("[SENSORS] Initializing HAL Sensor Placeholders...");
        
        // Giả lập quá trình bắt tay với cảm biến I2C (SHT30)
        sensors_initialized = true;
        sht30_healthy = true;

        sht30_last_error = SensorError::SUCCESS;
        
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
        // NOTE: SHT30 heater does NOT return NAN. It returns biased finite values
        // (temp +1..3°C, RH drops). We mark defogging and blank temp for telemetry
        // consumers that still check isnan; the Core 1 direct relay pipeline owns SSR safety.
        static unsigned long humidity_saturated_start = 0;
        static unsigned long heat_start_time = 0;

        unsigned long now = millis();

        if (!sht30_heater_active)
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
                    sht30_heater_active = true;
                    heat_start_time = now;
                    sht30_defog_hold_until = now + SHT30_DEFOG_COOLDOWN_MS;
                }
            }
            else
            {
                humidity_saturated_start = 0;
            }
        }
        else
        {
            // Blank temperature while heating so naive consumers don't chase bias.
            temp = NAN;
            sht30_defog_hold_until = now + SHT30_DEFOG_COOLDOWN_MS;

            if ((now - heat_start_time > 300000UL) || (hum < 90.0f)) // 5 minutes OR humidity < 90%
            {
                Serial.println("[SENSORS] INFO: Disabling SHT30 heater, entering cool-down.");
                sht30.heater(false);
                sht30_heater_active = false;
                humidity_saturated_start = 0;
                sht30_defog_hold_until = now + SHT30_DEFOG_COOLDOWN_MS;
            }
        }
#else
        // Tạo dữ liệu giả lập động chạy theo thời gian (sử dụng hàm lượng giác sine/cosine)
        unsigned long m = millis();
        // Nhiệt độ không khí dao động trong khoảng [23.0, 27.0] °C
        temp = 25.0f + 2.0f * std::sin(m / 10000.0f);
        // Độ ẩm không khí dao động trong khoảng [75.0, 85.0] %
        hum = 80.0f + 5.0f * std::cos(m / 15000.0f);
        // Host tests may force defogging via set_simulated_health + hold timer.
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



    bool read_scd30(float &co2)
    {
        // SCD30 chưa được tích hợp phần cứng — trả về NAN (N/A).
        // Khi SCD30 có mặt, thay thế block này bằng driver thật.
        co2 = NAN;
        return false;
    }

    bool read_all_telemetry(TelemetryData &data)
    {
        bool success = true;
        data.actuators = RelayOutputsPod{false, false, false, false, false, false, {0, 0}};

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

        // DS18B20 không được sử dụng — SHT30 đã đủ cho nhiệt độ và độ ẩm.
        // SCD30 chưa tích hợp — co2_level luôn là NAN.
        float scd_co2 = NAN;
        read_scd30(scd_co2);
        data.co2_level = scd_co2; // NAN — omitted from MQTT publish by isnan() guard

        return success;
    }

    // --- API bổ sung cho fault injection và kiểm toán SHT30 ---
    
    SensorError get_last_error_sht30()
    {
        return sht30_last_error;
    }

    void set_simulated_health_sht30(bool healthy)
    {
        sht30_healthy = healthy;
    }

    bool is_sht30_defogging()
    {
        return sht30_heater_active || (millis() < sht30_defog_hold_until);
    }

#ifdef UNIT_TEST
    void reset_sensors_initialized_for_test()
    {
        sensors_initialized = false;
    }
#endif

} // namespace sensors
