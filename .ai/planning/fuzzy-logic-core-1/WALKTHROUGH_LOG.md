# WALKTHROUGH_LOG.md

## [2026-07-11T16:10:21+07:00]
- **Task ID**: A4
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [AdaptiveTuner.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/AdaptiveTuner.h)
  - [NEW] [AdaptiveTuner.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/AdaptiveTuner.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai module `AdaptiveTuner` với hàm `updateGains()` tính toán sai số bề mặt tích phân của nhiệt độ và độ ẩm, sau đó điều chỉnh `gain_HAir`, `gain_HWat`, `gain_Mist`.
  - Anti-windup: tích phân bị kẹp cứng ở `I_MAX_TEMP = ±15 °C·s` và `I_MAX_HUMID = ±30 %·s`; khi cảm biến NaN/Inf hoặc `dt <= 0` thì đóng băng tích phân tương ứng để tránh windup do mất tín hiệu / scheduler trễ.
  - Ràng buộc gain: mọi kênh gain được clamp cứng về dải an toàn phần cứng `[0.5, 2.5]`.
  - Thiết kế state tường minh qua `IntegralState` (không dùng static toàn cục), trả `GainsPod` dạng POD pass-by-value, phù hợp FreeRTOS Core 1.
  - Ánh xạ điều khiển: `gain_HAir` theo I_T, `gain_Mist` theo I_H, `gain_HWat` theo I_T + 0.25·I_H để ưu tiên sấy nước khi lạnh & ẩm.
  - Bổ sung unit tests Task A4 trong `test/run_tests.cpp` (cold-start, tăng gain theo T/H, bão hòa anti-windup, freeze khi NaN/dt invalid, reset, kiểm tra layout POD).
  - Kết quả tự kiểm tra: biên dịch host `g++ -Wall -Wextra -Werror -fsanitize=address,undefined` cho `AdaptiveTuner.cpp` + test focused và chạy PASS 100%.

## [2026-07-11T16:05:00+07:00]
- **Task ID**: A3
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [Trajectory.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/Trajectory.h)
  - [NEW] [Trajectory.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/Trajectory.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm `interpolateSetpoints()` nhận đầu vào là `currentDay` (float), thực hiện nội suy tuyến tính từ mảng Waypoints 20 ngày.
  - Tối ưu hóa bộ nhớ: Mảng Waypoints 20 ngày được khai báo dưới dạng mảng `static constexpr` trong file `Trajectory.cpp`, lưu trữ trực tiếp trên bộ nhớ Flash tĩnh (RODATA), hoàn toàn không chiếm dụng dung lượng Heap/RAM khi thực thi.
  - Bảo vệ biên: Thực hiện kiểm tra biên đầu vào nghiêm ngặt, tự động clamp `currentDay` về khoảng `[0.0, 20.0]` trước khi tính toán. Hỗ trợ xử lý an toàn cho trường hợp đầu vào là `NaN` hoặc `Inf`.
  - Interface thiết kế dạng POD (`SetpointPod`) được pass-by-value, loại bỏ việc dùng con trỏ thô để triệt tiêu nguy cơ rò rỉ bộ nhớ.
  - Bổ sung Test Case 23 vào file kiểm thử `test/run_tests.cpp` bao phủ các kịch bản: kiểm tra biên ngoài dải, kiểm tra NaN, kiểm tra các điểm checkpoint chính xác và kiểm tra nội suy giữa hai checkpoint.
  - Kết quả kiểm tra nội bộ: Biên dịch offline bằng `g++` thành công và vượt qua 100% các xác nhận (assertions) trong test suite mà không làm ảnh hưởng đến các tính năng cũ.

## [2026-07-11T16:03:00+07:00]
- **Task ID**: A2
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [MODIFY] [MathEngine.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/MathEngine.h)
  - [MODIFY] [MathEngine.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/MathEngine.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
- **Giải trình ngắn gọn**:
  - Triển khai thành công hàm nạp chồng `computeMembership()` cho hàm thuộc tính tam giác (`trimf`) và hình thang (`trapmf`) trong `MathEngine.h` và `MathEngine.cpp`.
  - Logic tính toán được tối ưu CPU tối đa: kiểm tra và thoát sớm khi $x$ nằm ngoài miền xác định, chỉ thực hiện phép chia tại sườn dốc tương ứng (không tính toán dư thừa).
  - Ép kết quả đầu ra luôn nằm trong khoảng `[0.0, 1.0]` bằng cơ chế kẹp an toàn.
  - Xử lý mượt mà và đúng đắn các trường hợp suy biến biên trùng nhau ($a == b$ hoặc $c == d$) để tránh lỗi chia cho 0.
  - Tích hợp cơ chế kiểm duyệt dữ liệu đầu vào (NaN/Inf) để trả về `0.0f` fallback an toàn.
  - Viết bộ unit tests phủ toàn bộ các trường hợp biên của hàm tam giác & hình thang (gồm sườn dốc, đỉnh, ngoài khoảng, trường hợp suy biến và kiểm thử NaN/Inf) trong `run_tests.cpp`.
  - Kết quả kiểm tra nội bộ: Biên dịch bằng `g++` local thành công 100%, vượt qua toàn bộ test suite hiện có của dự án.

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
