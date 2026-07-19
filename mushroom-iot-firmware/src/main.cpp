#include <Arduino.h>
#include <time.h>
#include <cstdlib>

#include "config.h"
#include "core/actuator_controller.h"
#include "core/crop_profile_storage.h"
#include "core/config_manager.h"
#include "core/serial_mutex.h"
#include "core/sensors.h"
#include "core/storage.h"
#include "core/offline_storage.h"
#include "core/system_manager.h"
#include "core/telemetry.h"
#include "core/time_confidence.h"
#include "network/mqtt_manager.h"
#include "network/wifi_manager.h"

void setup()
{
    // Initialize Serial interface
    Serial.begin(115200);
    // 1. Quy trình khởi tạo Fail-Safe: Khởi tạo GPIO cho các Relay ở mức HIGH (OFF) ngay lập tức
    actuators::init_actuators_gpio();

    Serial.println("[MAIN] ESP32 Firmware Starting...");
    setenv("TZ", "UTC-7", 1);
    tzset();

    // 2. Khởi tạo I2C bus và cảm biến SHT30
    sensors::init_sensors_placeholder();

    // 3. Initialize NVS Storage
    storage::StorageManager &storage = storage::StorageManager::get_instance();
    if (storage.init())
    {
        Serial.println("[MAIN] NVS Storage initialized successfully.");
    }
    else
    {
        Serial.println("[MAIN] ERROR: NVS Storage initialization failed!");
    }
    storage::CropProfileStorage::getInstance().init();

    // Offline journal must be ready before WiFi/MQTT tasks can start.
    if (!offline_storage::OfflineStorage::getInstance().begin())
    {
        Serial.println("[MAIN] WARNING: Edge offline storage is unavailable.");
    }
    else
    {
        // The GPIO ISR was configured during fail-safe GPIO init; only now is
        // the PSRAM/LittleFS-backed task allowed to receive its notification.
        offline_storage::OfflineStorage::getInstance().startPowerLossTask();
    }

    // This node has no hardware RTC. Persisted time is retained only for audit;
    // it must never make the safety interlock permissive after a reboot.
    time_conf::initializeTimeConfidence(false);

    // 4. Initialize ConfigManager to load and cache configuration
    storage::ConfigManager::getInstance().init();

    // 5. Create Serial mutex (protects UART from concurrent Core 0/Core 1 writes)
    init_serial_mutex();

    // 6. Create queues and semaphores
    initQueues();
    initSemaphores();

    // Hydrate setpoints from NVS to queues
    hydrateSetpointsFromNVS();

    // Core 1 hydrates the persisted operating-mode mirror before its first
    // control tick. No Core 0/bootstrap path writes control state directly.

    // 7. Initialize and activate WiFi
    wifi::init_wifi();

    // 8. Create tasks
    createCoreTasks();
}

void loop()
{
    // The main loop is running on Core 1 by default in Arduino-ESP32,
    // but we can delay or delete it since logic is delegated to FreeRTOS tasks.
    #ifndef UNIT_TEST
    vTaskDelay(pdMS_TO_TICKS(1000));
    #else
    // Trong môi trường UNIT_TEST, ta chạy loop của Core 0 để kiểm thử đồng bộ
    // (như duy trì Webserver, MQTT loop, check delta telemetry)
    // Điều này đảm bảo biên dịch thành công và kiểm chứng được các luồng logic trong test suite.
    wifi::check_wifi_connection();
    mqtt::MqttManager::getInstance().loop();

    static unsigned long last_delta_scan = 0;
    unsigned long now = millis();
    if (now - last_delta_scan >= 5000)
    {
        last_delta_scan = now;
        static Telemetry::TelemetryState telemetryState = Telemetry::makeInitialState();
        TelemetryData mock_tel = {25.0f, 80.0f, NAN, {false, false, false, false, false, false, {0, 0}}};
        processTelemetryPublication(now, mock_tel, telemetryState);
    }
    #endif
}
