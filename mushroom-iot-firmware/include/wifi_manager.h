#pragma once

#include <Arduino.h>

namespace wifi
{
    // Hằng số cho mạng SoftAP cứu hộ cấu hình dự phòng
    constexpr const char* AP_SSID = "TraiNam_Setup_KhongDay";
    constexpr const char* AP_PASS = "12345678";

    /**
     * @brief Các trạng thái hoạt động của WiFi Manager
     */
    enum class WifiState
    {
        IDLE,               // Trạng thái khởi đầu chưa kết nối/chưa khởi tạo
        STA_CONNECTING,     // Đang cố gắng kết nối vào mạng WiFi lưu trong NVS
        STA_CONNECTED,      // Đã kết nối thành công vào WiFi STA và có IP
        STA_DISCONNECTED,   // Mất kết nối WiFi STA
        SOFTAP_ACTIVE       // Kích hoạt trạm phát AP cứu cấu hình (Captive Portal)
    };

    /**
     * @brief Khởi tạo hệ thống WiFi.
     * Hàm này sẽ đọc NVS Flash trước để tìm SSID/PASS.
     * Nếu không có thông tin mạng STA, nó sẽ báo hiệu để sẵn sàng kích hoạt SoftAP.
     * 
     * @return WifiState Trạng thái hiện tại sau khi chạy init
     */
    WifiState init_wifi();

    /**
     * @brief Hàm non-blocking kiểm tra trạng thái mạng định kỳ.
     * Cần được gọi trong vòng lặp chính (Core 0 Task) để duy trì kết nối.
     */
    void check_wifi_connection();

    /**
     * @brief Hàm non-blocking thực hiện kết nối lại WiFi khi gặp sự cố ngắt kết nối.
     */
    void reconnect_wifi();

    /**
     * @brief Lấy trạng thái hoạt động hiện thời của WiFi.
     * @return WifiState Trạng thái WiFi hiện tại
     */
    WifiState get_wifi_state();

} // namespace wifi
