#pragma once

#include <Arduino.h>
#include <stdint.h>

/**
 * Binary telemetry stored locally and sent verbatim in sync-burst chunks.
 * ESP32-S3 and the backend contract use little-endian IEEE-754 floats.
 */
struct __attribute__((packed)) OfflineTelemetryStruct {
    uint32_t boot_count;
    uint32_t delta_time_s;
    float temp;
    float humid;
    uint8_t mist_state;
    uint8_t lamp_state;
};
static_assert(sizeof(OfflineTelemetryStruct) == 18, "Offline telemetry ABI must remain 18 bytes");

struct __attribute__((packed)) OfflineBurstHeader {
    uint32_t magic;
    uint8_t schema_version;
    uint8_t header_size;
    uint16_t record_count;
    uint32_t boot_count;
    uint32_t chunk_index;
    uint32_t session_last_delta_s;
    uint32_t chunk_crc32;
};
static_assert(sizeof(OfflineBurstHeader) == 24, "Offline burst header ABI must remain 24 bytes");

namespace offline_storage {
constexpr uint32_t kBurstMagic = 0x4D535442U; // "BTSM" in little-endian byte order
constexpr uint8_t kBurstSchemaVersion = 1;
constexpr size_t kRingCapacity = 262144;
constexpr size_t kMaxRecordsPerBurst = 96;
constexpr size_t kMaxBurstBytes = sizeof(OfflineBurstHeader) + kMaxRecordsPerBurst * sizeof(OfflineTelemetryStruct);

class OfflineStorage {
public:
    static OfflineStorage& getInstance();
    OfflineStorage(const OfflineStorage&) = delete;
    OfflineStorage& operator=(const OfflineStorage&) = delete;

    bool begin();
    bool enabled() const { return enabled_; }
    uint32_t bootCount() const { return boot_count_; }
    bool capture(float temp, float humid, bool mist_state, bool lamp_state, uint32_t delta_time_s);

    /** Moves volatile records into the append-only LittleFS journal. */
    bool flushPendingToLittleFs();
    /** Drains the complete volatile ring; reserved for the power-loss task. */
    bool flushAllPendingToLittleFs();
    bool hasPendingData() const;

    /** Builds one oldest durable-first chunk. The returned buffer remains valid until next call. */
    bool prepareNextBurst(uint8_t*& payload, size_t& length, uint32_t& boot_count,
                          uint32_t& chunk_index, uint32_t& crc32);
    /** Only matching application ACKs may reclaim the in-flight records. */
    bool acknowledgeBurst(uint32_t boot_count, uint32_t chunk_index, uint32_t crc32);
    void cancelInFlightBurst();

    void IRAM_ATTR notifyPowerLossFromISR();
    void startPowerLossTask();

private:
    OfflineStorage() = default;
    ~OfflineStorage();

    bool mountLittleFs();
    bool recoverJournal();
    bool appendRecord(const OfflineTelemetryStruct& record);
    bool loadNextDurableRecords(OfflineTelemetryStruct* out, size_t max_records,
                                size_t& loaded, uint32_t& source_offset);
    bool rewriteJournalAfterAck(size_t bytes_to_drop);
    uint32_t crc32(const uint8_t* bytes, size_t length) const;

    OfflineTelemetryStruct* ring_ = nullptr; // allocated once with ps_malloc; never resized
    volatile size_t read_index_ = 0;          // oldest volatile record not yet durable
    volatile size_t write_index_ = 0;         // next free slot
    volatile size_t count_ = 0;               // number of volatile records
    uint32_t boot_count_ = 0;
    bool enabled_ = false;
    bool littlefs_ready_ = false;
    volatile bool power_loss_requested_ = false;
    uint32_t dropped_records_ = 0;

    uint8_t burst_buffer_[kMaxBurstBytes]{};
    bool burst_in_flight_ = false;
    size_t inflight_record_count_ = 0;
    size_t inflight_source_offset_ = 0;
    uint32_t inflight_boot_count_ = 0;
    uint32_t inflight_chunk_index_ = 0;
    uint32_t inflight_crc32_ = 0;
    uint32_t next_chunk_index_ = 0;
#ifndef UNIT_TEST
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
    TaskHandle_t power_loss_task_ = nullptr;
#endif
};
} // namespace offline_storage
