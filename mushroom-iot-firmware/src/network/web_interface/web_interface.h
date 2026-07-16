#pragma once

#ifndef UNIT_TEST
#include <WebServer.h>
#endif

namespace web_interface
{
    /**
     * @brief Khởi tạo WebServer nội bộ phục vụ giao diện Dashboard cục bộ.
     */
    void initServer();

    /**
     * @brief Duy trì hoạt động WebServer, cần gọi trong loop Core 0.
     */
    void handleClient();

    /**
     * @brief Dừng WebServer để giải phóng port 80 (khi chuyển qua SoftAP).
     */
    void stopServer();

    /**
     * @brief Kiểm tra xem WebServer cục bộ có đang chạy hay không.
     */
    bool isServerRunning();

    /**
     * @brief Phục vụ trang HTML Dashboard (phương thức GET /) lưu trong Flash.
     */
    void serveDashboardHTML();

    /**
     * @brief Phục vụ API lấy dữ liệu thời gian thực (phương thức GET /data) có giới hạn tần suất.
     */
    void apiGetRealtimeData();

    /**
     * @brief Kiểm tra giới hạn tần suất gửi request (rate limiting).
     * @param now Thời gian hiện tại tính bằng mili-giây (millis()).
     * @return true nếu request được chấp nhận, false nếu bị giới hạn (429).
     */
    bool checkRateLimit(unsigned long now);
}
