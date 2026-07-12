#pragma once

#ifndef UNIT_TEST
#include <WebServer.h>
#endif

namespace web_interface
{
    /**
     * @brief Khởi tạo WebServer nội bộ phục vụ giao diện Dashboard cục bộ.
     */
    void init_server();

    /**
     * @brief Duy trì hoạt động WebServer, cần gọi trong loop Core 0.
     */
    void handle_client();

    /**
     * @brief Dừng WebServer để giải phóng port 80 (khi chuyển qua SoftAP).
     */
    void stop_server();

    /**
     * @brief Kiểm tra xem WebServer cục bộ có đang chạy hay không.
     */
    bool is_server_running();

    /**
     * @brief Phục vụ trang HTML Dashboard (phương thức GET /) lưu trong Flash.
     */
    void serveDashboardHTML();
}
