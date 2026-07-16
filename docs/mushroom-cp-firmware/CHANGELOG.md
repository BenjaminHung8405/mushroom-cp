# Changelog

Dự án: Điều khiển nhà trồng nấm rơm IoT (ESP32)

## [2026-07-16T11:22:27+07:00]
- [Feature] Cập nhật logic điều khiển bằng tay (Manual Control): Tạm thời vô hiệu hóa tín hiệu từ bộ lọc `SlowSchmittTrigger`. Chuyển sang cơ chế kích hoạt Toggle trực tiếp từ `FastSchmittTrigger` (`btnMist`, `btnLamp`, `btnFan`). Mỗi lần phát hiện nút được nhấn (`EVENT_ON`), trạng thái hiện tại của Relay sẽ được đọc lại qua `digitalRead` và đảo ngược (`digitalWrite(..., !currentState)`).

## [2026-07-16T11:06:39+07:00]
- [Hotfix] Sửa cảnh báo `[-Wattributes] ignoring attribute 'section (".iram1.x")'`. Nguyên nhân: Trình biên dịch Xtensa GCC của ESP32 phát hiện xung đột khi từ khóa `IRAM_ATTR` được sử dụng ở cả phần khai báo (`.h`) và phần định nghĩa hàm. Giải pháp: Loại bỏ `IRAM_ATTR` khỏi tất cả các khai báo nguyên mẫu hàm trong `timer.h` và `manualcontrol.h`, chỉ giữ lại thuộc tính này ở nơi thực sự định nghĩa nội dung hàm (file `.cpp` hoặc `.ino`).

## [2026-07-16T11:01:11+07:00]
- [Refactor] Tiếp tục tinh gọn cấu trúc mã nguồn bằng cách bóc tách toàn bộ logic xử lý điều khiển bằng tay (Nút bấm, bộ lọc Fast/Slow Schmitt Trigger, điều khiển Relay) ra khỏi `mushroom-cp-firmware.ino` và chuyển vào module chuyên biệt `manualcontrol.h` / `manualcontrol.cpp`. File `.ino` chính giờ đây vô cùng sạch sẽ (LEAN), chỉ đóng vai trò điều phối hệ thống.

## [2026-07-16T10:58:42+07:00]
- [Refactor] Tách biệt phần thiết lập cấu hình Timer phần cứng của ESP32 ra khỏi luồng chính và đóng gói thành một module độc lập (`timer.h` và `timer.cpp`).
- Kỹ thuật Poka-Yoke & LEAN: Định nghĩa `extern void IRAM_ATTR systemTickISR()` tại module Timer và để file gốc `.ino` thực thi. Cách thiết kế này giúp chia tách trách nhiệm (Separation of Concerns) nhưng lại loại bỏ hoàn toàn độ trễ của việc sử dụng con trỏ hàm (Function Pointer Overhead) trong ngắt, giữ tốc độ thực thi ở mức tối đa.

## [2026-07-16T09:43:04+07:00]
- [Hotfix] Sửa lỗi biên dịch `USBSerial was not declared in this scope`. Nguyên nhân (Root Cause): Trên nền tảng ESP32 Arduino Core 3.x, khi cờ `CDC_ON_BOOT` bị tắt trong IDE, framework sẽ tự động vô hiệu hóa và không khởi tạo đối tượng `USBSerial` (thuộc class `HWCDC`) nhằm mục đích tối ưu bộ nhớ. Giải pháp: Bổ sung chỉ thị `extern HWCDC USBSerial;` vào `logger.h` và chủ động cấp phát thực thể `HWCDC USBSerial;` tại file gốc `mushroom-cp-firmware.ino` thông qua macro điều kiện `#ifdef NEED_HWCDC_INSTANTIATE`.

## [2026-07-16T09:40:34+07:00]
- Bổ sung cấu trúc Poka-Yoke vào `logger.h` để tự động định tuyến (route) toàn bộ log xuất ra cổng USB OTG (Native USB) của mạch ESP32-S3. Hệ thống có khả năng tự động phân tích các cờ biên dịch của IDE (`ARDUINO_USB_CDC_ON_BOOT`, `ARDUINO_USB_MODE`) để ép ép kiểu sang đối tượng `USBSerial` (thông qua `HWCDC.h` hoặc `USB.h`) thay vì `Serial` UART0 mặc định.
- Cập nhật hàm khởi tạo `LOG_BEGIN()` trong `mushroom-cp-firmware.ino` thay thế cho `Serial.begin()`.

## [2026-07-16T09:38:22+07:00]
- [Hotfix] Cập nhật các macro ghi log (`LOG_PRINT`, `LOG_PRINTLN`, `LOG_PRINTF`) trong `logger.h` bằng kỹ thuật bọc `do { ... } while(0)`. Đây là tiêu chuẩn an toàn (Poka-Yoke) của C/C++ dành cho Macro để giải quyết triệt để lỗi logic phân nhánh ngầm ("else without a previous if") khi gọi Macro bên trong các lệnh `if/else` không dùng ngoặc nhọn.

## [2026-07-16T09:34:34+07:00]
- Triển khai tính năng ghi log ra Serial Monitor để phục vụ debug.
- Tạo file `logger.h` sử dụng preprocessor macros để bật/tắt toàn bộ log dễ dàng thông qua biến cấu hình `config::debug::ENABLE_LOGGING` trong `config.h` (Tuân thủ LEAN, zero-cost abstraction khi vô hiệu hóa).
- Cập nhật hàm `loop()` để giám sát song song 2 luồng sự kiện:
  - Tầng 1 (Input Nút bấm): Ghi log khi phát hiện thao tác nhấn (`PRESSED`) hoặc nhả (`RELEASED`).
  - Tầng 2 (Output Relay): Ghi log khi bộ đếm an toàn thỏa mãn và Relay thực sự được bật (`ON`) hoặc tắt (`OFF`).

## [2026-07-16T09:30:05+07:00]
- Tiếp tục xử lý lỗi biên dịch: Trình biên dịch (GCC 12.2.0 của ESP32 Core 3.x) có tính năng tối ưu hóa quá gắt gao nên đã phát sinh cảnh báo `Wattributes` và lỗi Linker khi cố gắng inline các hàm `IRAM_ATTR`. Giải pháp triệt để: Đã chuyển toàn bộ định nghĩa các hàm này sang một file độc lập là `sst.cpp`. 
- Fix warning deprecated `volatile++` và `volatile--` (do C++20 không khuyến khích ghi gộp toán tử lên biến dùng chung) bằng cách viết rõ thành `counter = counter + 1` và `counter = counter - 1`.

## [2026-07-16T09:26:42+07:00]
- [Hotfix] Sửa triệt để lỗi biên dịch `dangerous relocation: l32r` của Xtensa GCC Linker trên ESP32. Lỗi này (được xem là bug của trình biên dịch) xảy ra khi định nghĩa các hàm `IRAM_ATTR` trực tiếp bên trong nội dung class. Giải pháp (Root Cause Analysis): Tách toàn bộ khai báo ra khỏi class body và định nghĩa thành các hàm `inline` độc lập phía dưới file `sst.h`.

## [2026-07-16T09:18:25+07:00]
- Bổ sung cấu hình `config::timing` vào file `config.h` để dễ dàng quản lý thông số thời gian của hệ thống (Nguyên tắc LEAN).
- Triển khai phân tầng bộ lọc trạng thái thiết bị trong `mushroom-cp-firmware.ino`:
  - **Tầng 1 (Fast Trigger)**: `SchmittTriggerInput` lọc nhiễu nút bấm cơ học, với độ trễ ON 100ms và OFF 200ms.
  - **Tầng 2 (Slow Trigger)**: `SlowSchmittTrigger` điều khiển chống "rung lắc" thiết bị ở mức ứng dụng. Pump yêu cầu trễ ON/OFF là 3s, Đèn là 1s, và Quạt là 2s.
- Cập nhật logic trong `loop()` để nhận sự kiện trực tiếp từ bộ lọc Slow, giải quyết triệt để bài toán an toàn vận hành hệ thống.

## [2026-07-16T09:05:59+07:00]
- Refactor file `sst.h`: Khởi tạo base class `SlowSchmittTrigger` xử lý tín hiệu lọc dựa trên biến đầu vào `bool` thay vì đọc trực tiếp từ pin phần cứng.
- Điều chỉnh class `SchmittTriggerInput`: Kế thừa từ `SlowSchmittTrigger` (áp dụng triệt để nguyên tắc LEAN để tái sử dụng lõi logic), vẫn giữ nguyên cách gọi đối với phần cứng.
- Chức năng mới `SlowSchmittTrigger` hỗ trợ lọc nhiễu (debounce) lớp thứ 2, ứng dụng cho các tác vụ điều khiển đòi hỏi thời gian xác nhận dài (ví dụ: nhấn/nhả nút bơm lâu hơn 2 giây, loại bỏ mọi rung lắc do thao tác click chập chờn liên tục của user).

## [2026-07-16T08:25:39+07:00]
- Khởi tạo 4 Relay Output (Mist, Fan, Lamp, HWat) với trạng thái mặc định tắt (HIGH) và kích hoạt bật (LOW).
- Áp dụng Poka-Yoke: Khởi tạo mức tín hiệu HIGH cho các Relay trước khi cấu hình `pinMode(OUTPUT)` để tránh hiện tượng kích hoạt thiết bị ngoài ý muốn (Glitch) khi vi điều khiển khởi động.
- Khởi tạo 3 Input nút bấm sử dụng class `SchmittTriggerInput` với cấu hình chống dội phím theo yêu cầu: 200ms detect ON và 50ms detect OFF.
- Kết nối logic sự kiện của nút bấm điều khiển trực tiếp các Relay tương ứng trong `loop()`.

## [2026-07-16T08:11:32+07:00]
- Rà soát code và áp dụng Poka-Yoke cho file `sst.h`:
  - Phát hiện lỗi mất đồng bộ (Race Condition) khi cấu trúc `noInterrupts()` của Arduino không khoá được ngắt hoàn toàn trên vi xử lý đa nhân (Symmetric Multiprocessing - ESP32). Đã thay thế bằng `portMUX_TYPE` (Spinlock) để đảm bảo an toàn tuyệt đối.
  - Thêm tiền tố `IRAM_ATTR` vào các hàm `tickISR()` và `processLogic()` để tránh lỗi crash (`InstrFetchProhibited`) nếu ngắt xảy ra khi bộ nhớ flash bị vô hiệu hoá.

## [2026-07-16T08:07:55+07:00]
- Refactor: Tách toàn bộ namespace `config` (định nghĩa Pin, Timer, Hardware) từ file `.ino` chính sang file `config.h` để tuân thủ nguyên tắc LEAN, giúp file chính gọn gàng và dễ bảo trì hơn.

## [2026-07-16T07:52:35+07:00]
- Khởi tạo ngắt Timer 1 với chu kỳ 1ms (`config::timer::PERIOD_US = 1000`).
- Áp dụng Poka-Yoke: Hàm `initTimer1` tự động chọn cấu hình tương thích cho cả Arduino Core ESP32 2.x và 3.x bằng macro `#if ESP_ARDUINO_VERSION_MAJOR >= 3`.
- Bổ sung cảnh báo Poka-Yoke trong hàm ngắt ISR (`onTimer1`) để ngăn chặn việc gọi `Serial.print` hay `delay`.

## [2026-07-16T07:48:09+07:00]
- Định nghĩa các chân tín hiệu (Pins & Hardware) trong `config::pins` và `config::hardware` áp dụng nguyên tắc LEAN (sử dụng `constexpr uint8_t` thay vì `#define` để tối ưu an toàn kiểu dữ liệu và bộ nhớ).

## [2026-07-16T07:24:20+07:00]
- Khởi tạo dự án theo chuẩn cấu trúc Arduino IDE.
- Cấu hình file `AGENTS.md` thiết lập các quy tắc bắt buộc cho AI:
  - Tuân thủ Poka-Yoke và LEAN.
  - Luôn tìm root cause.
  - Bắt buộc cập nhật CHANGELOG.md.
  - Tạo test case khi có thể.
- Tạo file `CHANGELOG.md` ghi nhận lịch sử thay đổi.
