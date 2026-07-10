-- Kích hoạt extension TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- PHẦN 1: BẢNG QUAN HỆ (REGULAR POSTGRESQL TABLES)
-- ============================================================================

-- 1. Quản lý các nhà nấm vật lý trong trang trại
CREATE TABLE mushroom_houses (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    area_meters VARCHAR(20) DEFAULT '4x6', -- Diện tích tiêu chuẩn 4m x 6m
    pillar_count INT DEFAULT 35,          -- Thiết kế chứa đúng 35 trụ nấm
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Thư viện lưu trữ các Profile cấu hình mẫu (Presets)
CREATE TABLE growth_profiles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL, -- Ví dụ: "Dry Season Optimization", "Rainy Season"
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Quản lý vụ nuôi thực tế (Mỗi vụ gắn với 1 nhà nấm và áp dụng 1 cấu hình ngày)
CREATE TABLE crop_batches (
    id VARCHAR(50) PRIMARY KEY,
    house_id VARCHAR(50) REFERENCES mushroom_houses(id) ON DELETE RESTRICT,
    profile_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, COMPLETED, ABORTED
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_crop_days INT NOT NULL CHECK (total_crop_days BETWEEN 10 AND 45), -- Thay đổi động 10-45 ngày
    spawn_running_end_day INT DEFAULT 8,  -- Ngày kết thúc nuôi tơ (Mặc định là ngày 8)
    
    -- Cấu hình dải tối ưu động cho vụ nuôi này (Cho phép chủ trại tinh chỉnh trực tiếp trên UI)
    temp_optimal_min NUMERIC(3,1) DEFAULT 28.0,
    temp_optimal_max NUMERIC(3,1) DEFAULT 35.0,
    humidity_optimal_min NUMERIC(3,1) DEFAULT 70.0,
    humidity_optimal_max NUMERIC(3,1) DEFAULT 90.0,
    
    -- Cấu hình khung giờ khóa tưới sốc nhiệt động
    thermal_shock_protection BOOLEAN DEFAULT TRUE,
    thermal_shock_start TIME DEFAULT '11:00:00',
    thermal_shock_end TIME DEFAULT '13:30:00',
    
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Lưu trữ các điểm mốc (Checkpoints) của đường cong Nhiệt độ & Độ ẩm
-- Bảng này thiết kế đa năng, dùng chung cho cả Profile mẫu và Vụ nuôi thực tế
CREATE TABLE curve_checkpoints (
    id BIGSERIAL PRIMARY KEY,
    profile_id VARCHAR(50) REFERENCES growth_profiles(id) ON DELETE CASCADE,
    batch_id VARCHAR(50) REFERENCES crop_batches(id) ON DELETE CASCADE,
    metric_type VARCHAR(20) NOT NULL CHECK (metric_type IN ('TEMPERATURE', 'HUMIDITY')),
    crop_day INT NOT NULL CHECK (crop_day BETWEEN 1 AND 45),
    target_value NUMERIC(4,1) NOT NULL, -- Giá trị được snap bám biên độ 0.5
    
    -- Ràng buộc: Một ngày trong 1 profile/batch chỉ có duy nhất 1 mốc cấu hình cho từng loại metric
    CONSTRAINT unique_checkpoint_per_day UNIQUE (profile_id, batch_id, metric_type, crop_day),
    -- Đảm bảo điểm mốc phải thuộc về Profile HOẶC thuộc về Batch cụ thể, không mập mờ
    CONSTRAINT check_origin CHECK (
        (profile_id IS NOT NULL AND batch_id IS NULL) OR 
        (profile_id IS NULL AND batch_id IS NOT NULL)
    )
);

-- 5. Lịch biểu quản lý các khối trạng thái Bật/Tắt ánh sáng (Đèn gia nhiệt)
CREATE TABLE light_schedule_blocks (
    id BIGSERIAL PRIMARY KEY,
    profile_id VARCHAR(50) REFERENCES growth_profiles(id) ON DELETE CASCADE,
    batch_id VARCHAR(50) REFERENCES crop_batches(id) ON DELETE CASCADE,
    start_day INT NOT NULL CHECK (start_day BETWEEN 1 AND 45),
    end_day INT NOT NULL CHECK (end_day BETWEEN 1 AND 45),
    status VARCHAR(5) NOT NULL CHECK (status IN ('ON', 'OFF')),
    
    CONSTRAINT check_light_origin CHECK (
        (profile_id IS NOT NULL AND batch_id IS NULL) OR 
        (profile_id IS NULL AND batch_id IS NOT NULL)
    ),
    CONSTRAINT check_days_order CHECK (start_day <= end_day)
);


-- ============================================================================
-- PHẦN 2: BẢNG DỮ LIỆU THỜI GIAN THỰC (TIMESCALEDB HYPERTABLE)
-- ============================================================================

-- 6. Bảng tổng hợp log Telemetry cảm biến và trạng thái điều chế thiết bị
CREATE TABLE telemetry_logs (
    time TIMESTAMPTZ NOT NULL, -- Khóa thời gian bắt buộc của TimescaleDB
    batch_id VARCHAR(50) NOT NULL,
    house_id VARCHAR(50) NOT NULL,
    crop_day_int INT NOT NULL, -- Ngày hiện tại của vụ nuôi phục vụ vẽ biểu đồ nhanh
    
    -- Cảm biến thực tế thu thập (Measured Values - SM_đo)
    humidity_measured NUMERIC(4,1),    -- Cảm biến SHT30 (Độ ẩm)
    temperature_measured NUMERIC(4,1), -- Cảm biến SHT30 (Nhiệt độ)
    co2_measured INT,                  -- Cảm biến SCD30
    
    -- Mục tiêu nội suy từ Equalizer tại thời điểm găm máy ($SM_{set}$)
    humidity_setpoint NUMERIC(4,1),
    temperature_setpoint NUMERIC(4,1),
    
    -- Sai số mờ tính toán tự động ($E = SM_{set} - SM_{đo}$)
    humidity_error_delta NUMERIC(4,1),
    temperature_error_delta NUMERIC(4,1),
    
    -- Trạng thái bật/tắt thiết bị chấp hành (ON/OFF)
    mist_generator_active BOOLEAN DEFAULT FALSE,  -- Máy phun sương siêu âm trung tâm
    convection_fan_active BOOLEAN DEFAULT FALSE,  -- Quạt đối lưu
    heating_lamp_active BOOLEAN DEFAULT FALSE,    -- Đèn sưởi
    
    -- Trạng thái kích hoạt cơ chế an toàn
    midday_blackout_active BOOLEAN DEFAULT FALSE -- Báo hiệu kích hoạt khóa sốc nhiệt
);

-- Biến đổi bảng telemetry_logs thành một Hypertable phân mảnh theo thời gian (7 ngày/chunk)
SELECT create_hypertable('telemetry_logs', 'time', chunk_time_interval => INTERVAL '7 days');


-- ============================================================================
-- PHẦN 3: TẠO HỆ THỐNG CHỈ MỤC TỐI ƯU (INDEXING STRATEGY)
-- ============================================================================

-- Index phục vụ tải nhanh danh sách mốc điểm để render đường cong đồ thị theo vụ nuôi
CREATE INDEX idx_checkpoints_batch ON curve_checkpoints (batch_id, metric_type) INCLUDE (crop_day, target_value);

-- Index phức hợp (Composite Index) dành riêng cho TimescaleDB 
-- Giúp tăng tốc hiển thị Card Telemetry trang chủ (Lấy bản ghi mới nhất của nhà nấm)
CREATE INDEX idx_telemetry_latest ON telemetry_logs (house_id, time DESC);

-- Index phục vụ vẽ biểu đồ lịch sử xả sương/quạt đối lưu trong ngày của Sandbox
CREATE INDEX idx_telemetry_batch_analytics ON telemetry_logs (batch_id, time DESC);
