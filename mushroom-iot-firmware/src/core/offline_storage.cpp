#include "core/offline_storage.h"

#include <cmath>
#include <cstring>
#include <cstdlib>

#include "config.h"
#include "core/storage.h"

#ifndef UNIT_TEST
#include <LittleFS.h>
#include <esp_heap_caps.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

namespace offline_storage {
namespace {
constexpr const char* kJournalPath = "/offline-v1.bin";
constexpr const char* kTempJournalPath = "/offline-v1.tmp";
constexpr size_t kFlushBatchRecords = 128;
constexpr size_t kHighWatermark = kRingCapacity * 3 / 4;

#ifndef UNIT_TEST
void powerLossTaskEntry(void* arg)
{
    auto* storage = static_cast<OfflineStorage*>(arg);
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        // This runs outside the ISR. It is intentionally the only power-loss path
        // that touches flash/LittleFS, which are not ISR/cache-safe.
        storage->flushAllPendingToLittleFs();
    }
}
#endif
} // namespace

OfflineStorage& OfflineStorage::getInstance()
{
    static OfflineStorage instance;
    return instance;
}

OfflineStorage::~OfflineStorage()
{
    if (ring_ != nullptr) {
        free(ring_);
        ring_ = nullptr;
    }
}

bool OfflineStorage::mountLittleFs()
{
#ifndef UNIT_TEST
    if (!LittleFS.begin(false, "/littlefs", 5, "littlefs")) {
        Serial.println("[OFFLINE] LittleFS mount failed; refusing to format existing telemetry.");
        return false;
    }
#endif
    return true;
}

bool OfflineStorage::recoverJournal()
{
#ifndef UNIT_TEST
    File file = LittleFS.open(kJournalPath, FILE_READ);
    if (!file) return true; // First use.
    const size_t valid_bytes = file.size() - (file.size() % sizeof(OfflineTelemetryStruct));
    const size_t original_bytes = file.size();
    file.close();
    if (valid_bytes == original_bytes) return true;

    File source = LittleFS.open(kJournalPath, FILE_READ);
    File temp = LittleFS.open(kTempJournalPath, FILE_WRITE);
    if (!source || !temp) {
        if (source) source.close();
        if (temp) temp.close();
        return false;
    }
    uint8_t buffer[256];
    size_t remaining = valid_bytes;
    while (remaining > 0) {
        const size_t want = remaining > sizeof(buffer) ? sizeof(buffer) : remaining;
        const size_t got = source.read(buffer, want);
        if (got != want || temp.write(buffer, want) != want) {
            source.close(); temp.close(); LittleFS.remove(kTempJournalPath);
            return false;
        }
        remaining -= want;
    }
    temp.flush(); source.close(); temp.close();
    LittleFS.remove(kJournalPath);
    return LittleFS.rename(kTempJournalPath, kJournalPath);
#else
    return true;
#endif
}

bool OfflineStorage::begin()
{
    if (!storage::StorageManager::get_instance().increment_boot_count(boot_count_)) {
        return false;
    }
#ifndef UNIT_TEST
    if (!psramFound()) {
        Serial.println("[OFFLINE] PSRAM unavailable; offline logging disabled.");
        return false;
    }
    ring_ = static_cast<OfflineTelemetryStruct*>(ps_malloc(kRingCapacity * sizeof(OfflineTelemetryStruct)));
    if (ring_ == nullptr || !esp_ptr_external_ram(ring_)) {
        Serial.println("[OFFLINE] Failed to allocate ring entirely in PSRAM.");
        if (ring_ != nullptr) free(ring_);
        ring_ = nullptr;
        return false;
    }
#else
    ring_ = static_cast<OfflineTelemetryStruct*>(std::malloc(kRingCapacity * sizeof(OfflineTelemetryStruct)));
    if (ring_ == nullptr) return false;
#endif
    if (!mountLittleFs() || !recoverJournal()) {
        free(ring_); ring_ = nullptr;
        return false;
    }
    littlefs_ready_ = true;
    enabled_ = true;
#ifndef UNIT_TEST
    Serial.printf("[OFFLINE] Ready: boot=%lu PSRAM ring=%u records (%u bytes).\n",
                  static_cast<unsigned long>(boot_count_), static_cast<unsigned>(kRingCapacity),
                  static_cast<unsigned>(kRingCapacity * sizeof(OfflineTelemetryStruct)));
#endif
    return true;
}

bool OfflineStorage::capture(float temp, float humid, bool mist_state, bool lamp_state, uint32_t delta_time_s)
{
    if (!enabled_ || !std::isfinite(temp) || !std::isfinite(humid) || power_loss_requested_) return false;
#ifndef UNIT_TEST
    portENTER_CRITICAL(&mux_);
#endif
    if (count_ == kRingCapacity) {
#ifndef UNIT_TEST
        portEXIT_CRITICAL(&mux_);
#endif
        // Never overwrite an unflushed record. The caller can retry after a flush.
        if (!flushPendingToLittleFs()) {
            ++dropped_records_;
            return false;
        }
#ifndef UNIT_TEST
        portENTER_CRITICAL(&mux_);
#endif
        if (count_ == kRingCapacity) {
#ifndef UNIT_TEST
            portEXIT_CRITICAL(&mux_);
#endif
            ++dropped_records_;
            return false;
        }
    }
    ring_[write_index_] = {boot_count_, delta_time_s, temp, humid,
                           static_cast<uint8_t>(mist_state), static_cast<uint8_t>(lamp_state)};
    write_index_ = (write_index_ + 1U) % kRingCapacity;
    ++count_;
    const bool flush_needed = count_ >= kHighWatermark;
#ifndef UNIT_TEST
    portEXIT_CRITICAL(&mux_);
#endif
    if (flush_needed) return flushPendingToLittleFs();
    return true;
}

bool OfflineStorage::appendRecord(const OfflineTelemetryStruct& record)
{
#ifndef UNIT_TEST
    if (!littlefs_ready_) return false;
    File file = LittleFS.open(kJournalPath, FILE_APPEND);
    if (!file) return false;
    const size_t written = file.write(reinterpret_cast<const uint8_t*>(&record), sizeof(record));
    file.flush();
    file.close();
    return written == sizeof(record);
#else
    (void)record;
    return true;
#endif
}

bool OfflineStorage::flushPendingToLittleFs()
{
    if (!enabled_ || !littlefs_ready_) return false;
    size_t flushed = 0;
    while (flushed < kFlushBatchRecords) {
#ifndef UNIT_TEST
        portENTER_CRITICAL(&mux_);
#endif
        if (count_ == 0) {
#ifndef UNIT_TEST
            portEXIT_CRITICAL(&mux_);
#endif
            return true;
        }
        const OfflineTelemetryStruct record = ring_[read_index_];
#ifndef UNIT_TEST
        portEXIT_CRITICAL(&mux_);
#endif
        if (!appendRecord(record)) return false;
#ifndef UNIT_TEST
        portENTER_CRITICAL(&mux_);
#endif
        // Advance only after a complete durable append; this is the ring ownership boundary.
        read_index_ = (read_index_ + 1U) % kRingCapacity;
        --count_;
#ifndef UNIT_TEST
        portEXIT_CRITICAL(&mux_);
#endif
        ++flushed;
    }
    return true;
}

bool OfflineStorage::flushAllPendingToLittleFs()
{
    if (!enabled_ || !littlefs_ready_) return false;
    while (count_ > 0) {
        if (!flushPendingToLittleFs()) return false;
    }
    return true;
}

bool OfflineStorage::hasPendingData() const
{
#ifndef UNIT_TEST
    File file = LittleFS.open(kJournalPath, FILE_READ);
    const bool journal_data = file && file.size() >= sizeof(OfflineTelemetryStruct);
    if (file) file.close();
    return journal_data || count_ > 0;
#else
    return count_ > 0;
#endif
}

uint32_t OfflineStorage::crc32(const uint8_t* bytes, size_t length) const
{
    uint32_t crc = 0xFFFFFFFFU;
    for (size_t i = 0; i < length; ++i) {
        crc ^= bytes[i];
        for (uint8_t bit = 0; bit < 8; ++bit) crc = (crc >> 1U) ^ (0xEDB88320U & (-(static_cast<int32_t>(crc & 1U))));
    }
    return ~crc;
}

bool OfflineStorage::loadNextDurableRecords(OfflineTelemetryStruct* out, size_t max_records,
                                            size_t& loaded, uint32_t& source_offset)
{
    loaded = 0; source_offset = 0;
#ifndef UNIT_TEST
    File file = LittleFS.open(kJournalPath, FILE_READ);
    if (!file) return false;
    while (loaded < max_records && file.available() >= static_cast<int>(sizeof(OfflineTelemetryStruct))) {
        if (file.read(reinterpret_cast<uint8_t*>(&out[loaded]), sizeof(OfflineTelemetryStruct)) != sizeof(OfflineTelemetryStruct)) break;
        ++loaded;
    }
    file.close();
    return loaded > 0;
#else
    (void)out; (void)max_records;
    return false;
#endif
}

bool OfflineStorage::prepareNextBurst(uint8_t*& payload, size_t& length, uint32_t& boot_count,
                                      uint32_t& chunk_index, uint32_t& crc)
{
    payload = nullptr; length = 0;
    if (!enabled_ || burst_in_flight_) return false;
    flushPendingToLittleFs(); // Durable journal always precedes any volatile tail.
    auto* header = reinterpret_cast<OfflineBurstHeader*>(burst_buffer_);
    auto* records = reinterpret_cast<OfflineTelemetryStruct*>(burst_buffer_ + sizeof(OfflineBurstHeader));
    size_t records_loaded = 0; uint32_t source_offset = 0;
    if (!loadNextDurableRecords(records, kMaxRecordsPerBurst, records_loaded, source_offset)) return false;
    const uint32_t session_boot = records[0].boot_count;
    size_t same_session = 1;
    while (same_session < records_loaded && records[same_session].boot_count == session_boot) ++same_session;
    records_loaded = same_session;
    const uint32_t body_crc = crc32(reinterpret_cast<const uint8_t*>(records), records_loaded * sizeof(OfflineTelemetryStruct));
    *header = {kBurstMagic, kBurstSchemaVersion, sizeof(OfflineBurstHeader), static_cast<uint16_t>(records_loaded),
               session_boot, next_chunk_index_, records[records_loaded - 1].delta_time_s, body_crc};
    length = sizeof(OfflineBurstHeader) + records_loaded * sizeof(OfflineTelemetryStruct);
    payload = burst_buffer_;
    burst_in_flight_ = true;
    inflight_record_count_ = records_loaded;
    inflight_source_offset_ = source_offset;
    inflight_boot_count_ = session_boot;
    inflight_chunk_index_ = next_chunk_index_;
    inflight_crc32_ = body_crc;
    boot_count = session_boot; chunk_index = next_chunk_index_; crc = body_crc;
    return true;
}

bool OfflineStorage::rewriteJournalAfterAck(size_t bytes_to_drop)
{
#ifndef UNIT_TEST
    File source = LittleFS.open(kJournalPath, FILE_READ);
    File temp = LittleFS.open(kTempJournalPath, FILE_WRITE);
    if (!source || !temp) { if (source) source.close(); if (temp) temp.close(); return false; }
    if (!source.seek(bytes_to_drop)) { source.close(); temp.close(); return false; }
    uint8_t buffer[256];
    while (source.available()) {
        const size_t got = source.read(buffer, sizeof(buffer));
        if (got == 0 || temp.write(buffer, got) != got) { source.close(); temp.close(); LittleFS.remove(kTempJournalPath); return false; }
    }
    temp.flush(); source.close(); temp.close();
    LittleFS.remove(kJournalPath);
    return LittleFS.rename(kTempJournalPath, kJournalPath);
#else
    (void)bytes_to_drop;
    return true;
#endif
}

bool OfflineStorage::acknowledgeBurst(uint32_t boot_count, uint32_t chunk_index, uint32_t crc)
{
    if (!burst_in_flight_ || boot_count != inflight_boot_count_ || chunk_index != inflight_chunk_index_ || crc != inflight_crc32_) return false;
    if (!rewriteJournalAfterAck(inflight_record_count_ * sizeof(OfflineTelemetryStruct))) return false;
    burst_in_flight_ = false;
    ++next_chunk_index_;
    return true;
}

void OfflineStorage::cancelInFlightBurst()
{
    burst_in_flight_ = false;
}

void IRAM_ATTR OfflineStorage::notifyPowerLossFromISR()
{
    power_loss_requested_ = true;
#ifndef UNIT_TEST
    if (power_loss_task_ != nullptr) {
        BaseType_t higher_priority_task_woken = pdFALSE;
        vTaskNotifyGiveFromISR(power_loss_task_, &higher_priority_task_woken);
        if (higher_priority_task_woken) portYIELD_FROM_ISR();
    }
#endif
}

void OfflineStorage::startPowerLossTask()
{
#ifndef UNIT_TEST
    if (!enabled_ || power_loss_task_ != nullptr) return;
    if (xTaskCreatePinnedToCore(powerLossTaskEntry, "PowerLossFlush", 4096, this, 4,
                                &power_loss_task_, 0) != pdPASS) {
        Serial.println("[OFFLINE] Unable to create power-loss flush task.");
        power_loss_task_ = nullptr;
    }
#endif
}
} // namespace offline_storage
