# WALKTHROUGH_LOG.md

## [2026-07-11T16:24:28+07:00]
- **Task ID**: B1
- **Trạng thái hiện tại**: Đang chờ QA Review
- **Danh sách file**:
  - [NEW] [FuzzyController.h](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/include/FuzzyController.h)
  - [NEW] [FuzzyController.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/src/FuzzyController.cpp)
  - [MODIFY] [run_tests.cpp](file:///Users/benjaminhung8405/Code/mushroom-cp/mushroom-iot-firmware/test/run_tests.cpp)
  - [MODIFY] [PROGRESS.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/PROGRESS.md)
  - [MODIFY] [WALKTHROUGH_LOG.md](file:///Users/benjaminhung8405/Code/mushroom-cp/.ai/planning/fuzzy-logic-core-1/WALKTHROUGH_LOG.md)
- **Giải trình ngắn gọn**:
  - Tạo module fuzzy thuần, không trạng thái `FuzzyController` và triển khai `executeDualHeaterRules(errorTemp, errorHumid)` theo quy ước lỗi `target - measured`.
  - Nhánh **Lạnh & Khô** ưu tiên sấy khí (`HAir`) và chỉ cấp phần ngân sách còn lại cho phun sương (`Mist`); nhánh **Lạnh & Ẩm ướt** ưu tiên sấy nước (`HWat`) và khóa Mist/ExhTH. Cơ chế ngân sách bảo đảm `HAir + Mist <= 1.0`, tránh kích hoạt đồng thời quá mức hai thiết bị triệt tiêu nhau.
  - Nhiệt độ cao hoặc độ ẩm dư kích hoạt `ExhTH`; tất cả bốn đầu ra được kẹp cứng về `[0.0, 1.0]`. Dữ liệu lỗi NaN/Inf trả về toàn bộ công suất 0 theo fail-safe.
  - Bổ sung unit test độc lập cho hai nhánh bắt buộc, kiểm tra ngân sách công suất, exhaust, clamp, dữ liệu invalid và POD layout.
  - Kết quả tự kiểm tra: test tập trung B1 với `-Wall -Wextra -Werror` cùng AddressSanitizer/UndefinedBehaviorSanitizer PASS; biên dịch và chạy toàn bộ host test suite PASS. `git diff --check` sạch. PlatformIO CLI không có trong môi trường nên chưa thể chạy firmware build trên target.

## [2026-07-11T16:19:56+07:00]
- **Task ID**: A1, A2, A3, A4 (Full Track A Audit)
- **Trạng thái hiện tại**: QA Approved — All LGTM / Done
- **Agent rà soát**: Security Auditor & Senior Code Reviewer
- **Kết quả tổng hợp**:
  - **A1** `calculateFuzzyArea()`: PASS — pure functions, NaN/Inf sanitize, divide-by-zero guard, TB clamp, Pascal equations verified.
  - **A2** `computeMembership(trimf/trapmf)`: PASS — early-exit optimization, degenerate case handling (a==b, b==c, c==d), NaN/Inf validate all params, output clamp [0,1].
  - **A3** `interpolateSetpoints()`: PASS — static constexpr Flash storage, boundary clamp [0,20], NaN→0, linear interpolation correct, POD pass-by-value.
  - **A4** `updateGains()`: PASS — anti-windup ±I_MAX, sensor-loss freeze, dt guard, gain clamp [0.5,2.5], explicit state (no hidden statics).
  - **Kiến trúc**: Toàn bộ Track A tuân thủ Clean Architecture — layer toán học tách biệt hoàn toàn với GPIO/I2C/delay.
  - **Bảo mật**: Không hardcode secret; validate NaN/Inf tại mọi entry point; clamp mọi output range; không raw pointer/heap.
  - **Tối ưu**: O(1) cho A1/A2/A4; O(n=20) cho A3 (acceptable); không vòng lồng; không N+1; không cấp phát động.
- **Xác minh độc lập**: `g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` focused host tests → PASS.
- **Quyết định**: **All Track A LGTM**. Chuyển A1, A2, A3 sang `[x] Done`.

## [2026-07-11T16:14:06+07:00]
- **Task ID**: A4
- **Trạng thái hiện tại**: QA Approved — LGTM / Done
- **Agent rà soát**: Security Auditor & Senior Code Reviewer
- **Kết quả checklist**:
  1. **Kiến trúc & Conventions**: PASS — module thuần toán học, tách khỏi GPIO/I2C/delay, namespace `AdaptiveTuner`, POD `GainsPod`/`IntegralState`, state tường minh (không static ẩn), hàm ngắn gọn, không DRY-break.
  2. **Bảo mật**: PASS — không hardcode secret/.env; validate NaN/Inf cho error/state/dt; clamp anti-windup + gain; chặn dt quá lớn; không raw pointer/heap.
  3. **Logic & Edge-cases**: PASS — anti-windup `±I_MAX`, freeze khi sensor loss/`dt<=0`, repair state hỏng, clamp gain `[0.5, 2.5]`, mapping HAir/HWat/Mist hợp lý; unit tests 24.x phủ cold-start/T/H/windup/NaN/reset/POD.
  4. **Tối ưu**: PASS — O(1), không vòng lồng, không N+1, không cấp phát động.
- **Xác minh độc lập**: `g++ -std=c++11 -Wall -Wextra -Werror -fsanitize=address,undefined` focused host tests cho `AdaptiveTuner` → PASS.
- **Quyết định**: **LGTM**. Chuyển Task A4 sang `[x] Done`.

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
