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

    /// @brief Khởi tạo Mutex Semaphore cho OTA. Gọi trong wifi::init_wifi() hoặc setup().
    void init();

    /// @brief Lưu URL OTA một cách thread-safe. An toàn để gọi từ MQTT Callback.
    /// @param url URL HTTPS trỏ đến file firmware .bin mới.
    void request_ota_update(const String& url);

    /// @brief Kiểm tra xem có OTA pending không và lấy URL ra. Gọi định kỳ từ Core 0 loop.
    /// @param[out] url Nếu trả về true, url chứa địa chỉ firmware cần tải.
    /// @return true nếu có OTA pending, false if not.
    bool check_ota_trigger(String& url);

    /// @brief Thực hiện toàn bộ quy trình OTA: Safety → Interlock → Download.
    ///        Chạy đồng bộ trên Core 0. Chip sẽ reboot nếu thành công.
    ///        Nếu thất bại, Core 1 tasks sẽ được Resume lại.
    /// @param url URL HTTPS đến file .bin firmware.
    void perform_ota_update(const String& url);

} // namespace ota
