#pragma once

// ota_manager.h — Public API for OTA update orchestration.
// All functions must be called from Core 0 context only,
// except request_ota_update() which is safe to call from MQTT callback.

#ifndef UNIT_TEST
#include <Arduino.h>
#include <WString.h>
#else
#include <Arduino.h>
#endif

namespace ota {

    struct OtaRequest {
        String command_id;
        String url;
        String sha256;
        String version;
        size_t size = 0;
    };

    /// @brief Khởi tạo Mutex Semaphore cho OTA. Gọi trong wifi::init_wifi() hoặc setup().
    void init();

    /// @brief Lưu request OTA đã được MQTT xác thực. An toàn từ MQTT worker.
    void request_ota_update(const OtaRequest& request);

    /// @brief Kiểm tra request OTA pending. Gọi định kỳ từ Core 0 loop.
    /// @return true nếu có OTA pending, false if not.
    bool check_ota_trigger(OtaRequest& request);

    /// @brief Thực hiện toàn bộ quy trình OTA: Safety → Interlock → Download.
    ///        Chạy đồng bộ trên Core 0. Chip sẽ reboot nếu thành công.
    ///        Nếu thất bại, Core 1 tasks sẽ được Resume lại.
    void perform_ota_update(const OtaRequest& request);

    /// @brief Start rollback health validation if this app booted pending verification.
    void begin_boot_validation();

    /// @brief Confirm the pending OTA image after SHT30 and MQTT are both healthy.
    void process_boot_validation(bool sensor_healthy, bool mqtt_connected);

} // namespace ota
