# WALKTHROUGH_LOG.md

## [2026-07-11T16:01:00+07:00]
- **Task ID**: A1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [MathEngine.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/MathEngine.h)
  - [NEW] [MathEngine.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/MathEngine.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm `calculateFuzzyArea()` giải mờ thuật toán Pascal gốc trong `MathEngine.h` và `MathEngine.cpp`.
  - Các hàm tích phân `Fz1`, `Fz2`, `Fz3` và `Fu1`, `Fu2`, `Fu3` được viết chính xác theo cấu trúc toán học của Pascal gốc, sử dụng kiểu dữ liệu `float` tối ưu cho FPU của ESP32.
  - Áp dụng các quy tắc bảo vệ: hàm thuần túy (pure functions/stateless), kiểm tra và loại trừ các giá trị NaN/Infinity, kiểm tra mẫu số khác không trước khi chia centroid `Kz / K` để tránh chia cho 0, clamp kết quả `TB < 1.0` về `0.0` theo logic Pascal gốc.
  - Bổ sung 4 kịch bản kiểm thử độc lập cho `MathEngine` vào file `run_tests.cpp` (giá trị chuẩn, giá trị bằng 0, chèn lỗi NaN/Infinity, clamp giá trị centroid nhỏ hơn 1.0).
  - Tự kiểm tra: Biên dịch lại toàn bộ test code bằng `g++` local và chạy `./run_tests` thành công 100%, tất cả các assert đều đạt yêu cầu mà không làm ảnh hưởng đến các tính năng cũ.
