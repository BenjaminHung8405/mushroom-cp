#pragma once

#include <Arduino.h>

namespace wifi
{

    /**
     * @brief Các trạng thái hoạt động của WiFi Manager
     */
    enum class WifiState
    {
        IDLE,             // Trạng thái khởi đầu chưa kết nối/chưa khởi tạo
        STA_CONNECTING,   // Đang cố gắng kết nối vào mạng WiFi
        STA_CONNECTED,    // Đã kết nối thành công vào WiFi STA và có IP
        STA_DISCONNECTED, // Mất kết nối WiFi STA
        STA_RECONNECTING, // Trạng thái thử lại kết nối ngầm (Exponential Backoff)
        SOFTAP_ACTIVE,    // Kích hoạt trạm phát AP cấu hình (Captive Portal)
        AP_PROVISIONING   // Trạng thái cấu hình AP chủ động (khóa channel hopping)
    };

    /**
     * @brief Tính toán khoảng thời gian chờ (ms) theo thuật toán Exponential Backoff
     * @param attempt Số lần thử lại (1-indexed)
     * @return unsigned long Thời gian chờ (ms): Lần 1-3: 10s, 4-6: 30s, 7-10: 60s, >10: 300s
     */
    unsigned long get_reconnect_backoff_interval_ms(int attempt);

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
