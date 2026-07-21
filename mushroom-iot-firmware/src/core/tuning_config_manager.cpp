#include "core/tuning_config_manager.h"
#include <cstring>
#include "Arduino.h"
#include "config.h"
#include <Preferences.h>
#include "core/system_manager.h"

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

namespace storage {
namespace {
constexpr uint32_t TUNING_NVS_VERSION = 2;
constexpr uint8_t TUNING_NVS_PENDING_COMMIT = 1;
// READY_DISPATCH is fully durable and boot-hydrateable. It is written before
// the Core 0 -> Core 1 handoff so a failed NVS finalization can never expose a
// rejected candidate to the relay loop.
constexpr uint8_t TUNING_NVS_READY_DISPATCH = 2;

/// Key for the bounded command-identity receipt (no-change commands only).
constexpr const char* TUNING_RECEIPT_KEY = "tune_rcpt";

/// CRC-protected envelope for a single command_id receipt. Stored as raw bytes
/// under TUNING_RECEIPT_KEY. Version guard prevents loading stale/corrupted
/// receipts written by older firmware.
struct TuningReceiptRecord {
    uint32_t version;    ///< Must equal TUNING_NVS_VERSION
    char command_id[37]; ///< UUID string, null-terminated
    uint8_t padding[3];  ///< Alignment
    uint32_t crc32;      ///< CRC32 of all fields except crc32 itself
} __attribute__((aligned(4)));

struct NvsSlots {
    TuningNvsRecord records[2];
    bool valid[2];
};

uint32_t calculateRecordCrc(const TuningNvsRecord& record)
{
    uint32_t crc = 0xFFFFFFFF;
    const uint8_t* data = reinterpret_cast<const uint8_t*>(&record);
    for (size_t i = 0; i < offsetof(TuningNvsRecord, crc32); ++i) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 1U) ? (crc >> 1U) ^ 0xEDB88320U : crc >> 1U;
        }
    }
    return ~crc;
}

bool isValidRecord(const TuningNvsRecord& record)
{
    return record.version == TUNING_NVS_VERSION &&
           (record.commit_state == TUNING_NVS_PENDING_COMMIT ||
            record.commit_state == TUNING_NVS_READY_DISPATCH) &&
           calculateRecordCrc(record) == record.crc32;
}

void readNvsSlots(Preferences& prefs, NvsSlots& slots)
{
    std::memset(&slots, 0, sizeof(slots));
    const char* const keys[] = {"tune_s0", "tune_s1"};
    for (uint8_t slot = 0; slot < 2; ++slot) {
        const size_t bytes = prefs.getBytes(keys[slot], &slots.records[slot], sizeof(TuningNvsRecord));
        slots.valid[slot] = bytes == sizeof(TuningNvsRecord) && isValidRecord(slots.records[slot]);
    }
}

int newestCommittedSlot(const NvsSlots& slots)
{
    const bool committed0 = slots.valid[0] && slots.records[0].commit_state == TUNING_NVS_READY_DISPATCH;
    const bool committed1 = slots.valid[1] && slots.records[1].commit_state == TUNING_NVS_READY_DISPATCH;
    if (committed0 && committed1)
        return slots.records[0].generation >= slots.records[1].generation ? 0 : 1;
    return committed0 ? 0 : committed1 ? 1 : -1;
}

bool samePersistedParams(const DynamicTuningParams& lhs, const DynamicTuningParams& rhs)
{
    return std::strcmp(lhs.command_id, rhs.command_id) == 0 &&
           lhs.revision == rhs.revision &&
           lhs.lamp_gain_scale == rhs.lamp_gain_scale &&
           lhs.mist_gain_scale == rhs.mist_gain_scale &&
           lhs.mist_on_threshold == rhs.mist_on_threshold &&
           lhs.mist_off_threshold == rhs.mist_off_threshold;
}

int selectWriteSlot(const NvsSlots& slots, const DynamicTuningParams& params, uint8_t commit_state)
{
    if (commit_state == TUNING_NVS_READY_DISPATCH) {
        const bool pending0 = slots.valid[0] && slots.records[0].commit_state == TUNING_NVS_PENDING_COMMIT &&
                              samePersistedParams(slots.records[0].params, params);
        const bool pending1 = slots.valid[1] && slots.records[1].commit_state == TUNING_NVS_PENDING_COMMIT &&
                              samePersistedParams(slots.records[1].params, params);
        if (pending0 && (!pending1 || slots.records[0].generation >= slots.records[1].generation)) return 0;
        if (pending1) return 1;
    }
    if (!slots.valid[0]) return 0;
    if (!slots.valid[1]) return 1;
    return slots.records[0].generation <= slots.records[1].generation ? 0 : 1;
}

uint32_t generationForWrite(const NvsSlots& slots, int slot, uint8_t commit_state)
{
    if (commit_state == TUNING_NVS_READY_DISPATCH && slots.valid[slot] &&
        slots.records[slot].commit_state == TUNING_NVS_PENDING_COMMIT) {
        return slots.records[slot].generation;
    }
    const uint32_t gen0 = slots.valid[0] ? slots.records[0].generation : 0;
    const uint32_t gen1 = slots.valid[1] ? slots.records[1].generation : 0;
    return (gen0 > gen1 ? gen0 : gen1) + 1;
}

TuningNvsRecord makeRecord(const DynamicTuningParams& params, uint8_t commit_state, uint32_t generation)
{
    TuningNvsRecord record{};
    record.version = TUNING_NVS_VERSION;
    record.commit_state = commit_state;
    record.generation = generation;
    record.params = params;
    record.crc32 = calculateRecordCrc(record);
    return record;
}

bool verifyReadback(Preferences& prefs, const char* key, const TuningNvsRecord& expected)
{
    TuningNvsRecord readback{};
    if (prefs.getBytes(key, &readback, sizeof(readback)) != sizeof(readback)) return false;
    return isValidRecord(readback) &&
           readback.crc32 == expected.crc32 &&
           readback.generation == expected.generation &&
           readback.commit_state == expected.commit_state;
}
} // namespace

TuningConfigManager& TuningConfigManager::getInstance() {
    static TuningConfigManager instance;
    return instance;
}

TuningConfigManager::TuningConfigManager() {
#ifndef UNIT_TEST
    _mutex = xSemaphoreCreateMutex();
#endif
    // Set safe defaults for _active_params
    std::memset(&_active_params, 0, sizeof(_active_params));
    _active_params.revision = 0;
    _active_params.lamp_gain_scale = 1.0f;
    _active_params.mist_gain_scale = 1.0f;
    _active_params.mist_on_threshold = 0.25f;
    _active_params.mist_off_threshold = 0.15f;
}

void TuningConfigManager::lock() {
#ifndef UNIT_TEST
    if (_mutex != nullptr) {
        xSemaphoreTake((SemaphoreHandle_t)_mutex, portMAX_DELAY);
    }
#endif
}

void TuningConfigManager::unlock() {
#ifndef UNIT_TEST
    if (_mutex != nullptr) {
        xSemaphoreGive((SemaphoreHandle_t)_mutex);
    }
#endif
}

bool TuningConfigManager::init() {
    lock();
    _has_pending_dispatch = false;
    // RAM fast-path cleared on every boot; durable receipt is loaded from NVS below.
    std::memset(_last_no_change_command_id, 0, sizeof(_last_no_change_command_id));
    std::memset(_durable_receipt_command_id, 0, sizeof(_durable_receipt_command_id));
    // Load durable receipt first so post-reboot DUPLICATE_UUID works immediately.
    loadDurableReceipt();
    DynamicTuningParams loaded;
    if (loadFromNvs(loaded)) {
        _active_params = loaded;
    } else {
        // Fallback to default values (already set in constructor or resetForTest)
        _active_params.revision = 0;
        _active_params.lamp_gain_scale = 1.0f;
        _active_params.mist_gain_scale = 1.0f;
        _active_params.mist_on_threshold = 0.25f;
        _active_params.mist_off_threshold = 0.15f;
        std::memset(_active_params.command_id, 0, sizeof(_active_params.command_id));
    }
    _initialized = true;
    unlock();
    return true;
}

TuningResult TuningConfigManager::processCommand(const JsonVariant& doc, TuningReason& reason) {
    lock();
    DynamicTuningParams incoming_params;
    const TuningReason validation = validateAndParse(doc, incoming_params);
    TuningResult result = TuningResult::REJECTED;
    reason = validation;
    if (validation == TuningReason::OK && _isExactDuplicate(incoming_params.command_id)) {
        reason = TuningReason::DUPLICATE_UUID;
        result = TuningResult::DUPLICATE;
    } else if (validation == TuningReason::OK && !_isSemanticDiff(incoming_params)) {
        result = recordNoChangeReceipt(incoming_params, reason);
    } else if (validation == TuningReason::OK) {
        result = persistThenDispatch(incoming_params, reason);
    }
    unlock();
    return result;
}

DynamicTuningParams TuningConfigManager::getActiveParams() {
    lock();
    DynamicTuningParams copy = _active_params;
    unlock();
    return copy;
}

bool TuningConfigManager::retryPendingDispatch(DynamicTuningParams& dispatched_params) {
    lock();
    if (!_has_pending_dispatch || g_tuning_config_queue == nullptr ||
        xQueueOverwrite(g_tuning_config_queue, &_pending_params) != pdTRUE) {
        unlock();
        return false;
    }
    _active_params = _pending_params;
    _has_pending_dispatch = false;
    dispatched_params = _active_params;
    unlock();
    return true;
}

void TuningConfigManager::resetForTest() {
    lock();
    std::memset(&_active_params, 0, sizeof(_active_params));
    _active_params.revision = 0;
    _active_params.lamp_gain_scale = 1.0f;
    _active_params.mist_gain_scale = 1.0f;
    _active_params.mist_on_threshold = 0.25f;
    _active_params.mist_off_threshold = 0.15f;
    std::memset(&_pending_params, 0, sizeof(_pending_params));
    std::memset(_last_no_change_command_id, 0, sizeof(_last_no_change_command_id));
    std::memset(_durable_receipt_command_id, 0, sizeof(_durable_receipt_command_id));
    _has_pending_dispatch = false;
    _initialized = false;
    unlock();
}

TuningReason TuningConfigManager::validateAndParse(const JsonVariant& doc, DynamicTuningParams& out_params) {
    if (doc.isNull() || !doc.is<JsonObject>()) {
        return TuningReason::INVALID_SCHEMA;
    }
    const char* command_id = nullptr;
    uint32_t revision = 0;
    const TuningReason envelope = validateCommandEnvelope(doc, command_id, revision);
    if (envelope != TuningReason::OK) return envelope;
    JsonVariant config = doc["config"];
    const TuningReason parsed = parseConfig(config, out_params);
    if (parsed != TuningReason::OK) return parsed;
    std::strncpy(out_params.command_id, command_id, sizeof(out_params.command_id) - 1);
    out_params.command_id[sizeof(out_params.command_id) - 1] = '\0';
    out_params.revision = revision;
    return TuningReason::OK;
}

TuningReason TuningConfigManager::validateCommandEnvelope(const JsonVariant& doc, const char*& command_id,
                                                           uint32_t& revision) {
    if (!_validateSchemaVersion(doc)) return TuningReason::INVALID_SCHEMA;
    if (!_validateDeviceId(doc)) return TuningReason::INVALID_DEVICE_ID;
    JsonVariant command = doc["command_id"];
    if (command.isNull() || !command.is<const char*>()) return TuningReason::INVALID_UUID;
    command_id = command.as<const char*>();
    if (!_validateCommandIdFormat(command_id)) return TuningReason::INVALID_UUID;
    const JsonVariant value = doc["revision"];
    if (value.is<int32_t>()) {
        const int32_t signed_revision = value.as<int32_t>();
        if (signed_revision < 0) return TuningReason::INVALID_SCHEMA;
        revision = static_cast<uint32_t>(signed_revision);
        return TuningReason::OK;
    }
    if (!value.is<uint32_t>()) return TuningReason::INVALID_SCHEMA;
    revision = value.as<uint32_t>();
    return TuningReason::OK;
}

TuningReason TuningConfigManager::parseConfig(const JsonVariant& config, DynamicTuningParams& out_params) {
    if (config.isNull() || !config.is<JsonObject>()) return TuningReason::INVALID_SCHEMA;
    if (!_validateConfigBounds(config)) return TuningReason::OUT_OF_BOUNDS;
    const float mist_on = config["mist_on_threshold"].as<float>();
    const float mist_off = config["mist_off_threshold"].as<float>();
    if (!_validateCrossField(mist_on, mist_off)) return TuningReason::CROSS_FIELD_VIOLATION;
    std::memset(&out_params, 0, sizeof(out_params));
    out_params.lamp_gain_scale = config["lamp_gain_scale"].as<float>();
    out_params.mist_gain_scale = config["mist_gain_scale"].as<float>();
    out_params.mist_on_threshold = mist_on;
    out_params.mist_off_threshold = mist_off;
    return TuningReason::OK;
}

TuningResult TuningConfigManager::persistThenDispatch(const DynamicTuningParams& incoming, TuningReason& reason) {
    if (!writeRecord(incoming, TUNING_NVS_PENDING_COMMIT)) {
        reason = TuningReason::NVS_WRITE_ERROR;
        return TuningResult::REJECTED;
    }
    // Do not publish to Core 1 until the final durable record has been
    // read-back verified. This is the transaction barrier that prevents a
    // rejected command from influencing even one relay-control tick.
    if (!saveToNvs(incoming)) {
        reason = TuningReason::NVS_WRITE_ERROR;
        return TuningResult::REJECTED;
    }
    _pending_params = incoming;
    _has_pending_dispatch = true;
    if (g_tuning_config_queue != nullptr &&
        xQueueOverwrite(g_tuning_config_queue, &_pending_params) == pdTRUE) {
        _active_params = _pending_params;
        _has_pending_dispatch = false;
        reason = TuningReason::OK;
        return TuningResult::ACCEPTED;
    }
    // Persistence succeeded, so this command is not rejected. Core 0 retains
    // the durable candidate and retries it; boot also hydrates READY_DISPATCH.
    reason = TuningReason::QUEUE_FULL_ERROR;
    return TuningResult::PENDING;
}

TuningResult TuningConfigManager::recordNoChangeReceipt(const DynamicTuningParams& incoming,
                                                         TuningReason& reason) {
    // A semantically identical command must not rewrite the effective-config
    // envelope: doing so would consume a two-slot NVS generation and wear
    // flash without changing Core 1 state.
    //
    // However, per PLAN.md:264 and sprint_1.md:74, command identity (UUID)
    // MUST be persisted durably so that post-reboot redelivery of the same
    // retained desired message is correctly identified as DUPLICATE_UUID
    // and does not trigger an NVS config write or Core 1 handoff.
    //
    // FAIL-CLOSED: if NVS write fails, we MUST NOT update the in-RAM cache.
    // Updating cache without durable persistence creates a window where:
    //   - Reboot clears the RAM cache.
    //   - Post-reboot retained command is processed again as a new command.
    //   - This violates the durable identity guarantee.
    //
    // Wear impact: one putBytes write per genuinely novel no-change command.
    // Same-session QoS-1 redelivery is short-circuited by _last_no_change_command_id.
    if (!saveDurableReceipt(incoming.command_id)) {
        // Persistence failed: do NOT cache in RAM, return NVS error.
        // The broker will redeliver QoS-1, which will be processed again on next
        // delivery — after the NVS fault clears or on the next genuinely different command.
        reason = TuningReason::NVS_WRITE_ERROR;
        return TuningResult::REJECTED;
    }
    // Only update the RAM caches after durable write has been confirmed.
    // Warm the session-only fast path to avoid an extra NVS read for immediate redelivery.
    std::strncpy(_last_no_change_command_id, incoming.command_id,
                 sizeof(_last_no_change_command_id) - 1);
    _last_no_change_command_id[sizeof(_last_no_change_command_id) - 1] = '\0';
    // Also update the durable receipt cache so _isExactDuplicate is consistent
    // without requiring a full NVS re-read within the same boot session.
    std::strncpy(_durable_receipt_command_id, incoming.command_id,
                 sizeof(_durable_receipt_command_id) - 1);
    _durable_receipt_command_id[sizeof(_durable_receipt_command_id) - 1] = '\0';
    reason = TuningReason::NO_CHANGE;
    return TuningResult::DUPLICATE;
}

uint32_t TuningConfigManager::calculateCRC32(const uint8_t *data, size_t length) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    return ~crc;
}

bool TuningConfigManager::loadFromNvs(DynamicTuningParams& out_params) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) {
        return false;
    }

    NvsSlots slots{};
    readNvsSlots(prefs, slots);
    prefs.end();
    const int slot = newestCommittedSlot(slots);
    if (slot < 0) return false;
    out_params = slots.records[slot].params;
    return true;
}

bool TuningConfigManager::saveToNvs(const DynamicTuningParams& params) {
    return writeRecord(params, TUNING_NVS_READY_DISPATCH);
}

bool TuningConfigManager::writeRecord(const DynamicTuningParams& params, uint8_t commit_state) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    NvsSlots slots{};
    readNvsSlots(prefs, slots);
    const int next_slot = selectWriteSlot(slots, params, commit_state);
    if (next_slot < 0) {
        prefs.end();
        return false;
    }
    const TuningNvsRecord new_rec = makeRecord(
        params, commit_state, generationForWrite(slots, next_slot, commit_state));
    const char* key = next_slot == 0 ? "tune_s0" : "tune_s1";
    size_t written = prefs.putBytes(key, &new_rec, sizeof(TuningNvsRecord));
    if (written != sizeof(TuningNvsRecord)) {
        prefs.end();
        return false;
    }
    const bool verified = verifyReadback(prefs, key, new_rec);
    prefs.end();
    return verified;
}

bool TuningConfigManager::saveDurableReceipt(const char* command_id) {
    if (command_id == nullptr || command_id[0] == '\0') return false;
    TuningReceiptRecord rec{};
    rec.version = TUNING_NVS_VERSION;
    std::strncpy(rec.command_id, command_id, sizeof(rec.command_id) - 1);
    rec.command_id[sizeof(rec.command_id) - 1] = '\0';
    // Compute CRC over all fields except the crc32 tail.
    rec.crc32 = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&rec),
        offsetof(TuningReceiptRecord, crc32));

    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) return false;
    const size_t written = prefs.putBytes(TUNING_RECEIPT_KEY, &rec, sizeof(rec));
    prefs.end();
    return written == sizeof(rec);
}

void TuningConfigManager::loadDurableReceipt() {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) return;
    TuningReceiptRecord rec{};
    const size_t bytes = prefs.getBytes(TUNING_RECEIPT_KEY, &rec, sizeof(rec));
    prefs.end();
    if (bytes != sizeof(rec)) return;
    if (rec.version != TUNING_NVS_VERSION) return;
    const uint32_t expected_crc = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&rec),
        offsetof(TuningReceiptRecord, crc32));
    if (rec.crc32 != expected_crc) return;
    // Full char-by-char UUID format validation: a CRC-valid receipt with a
    // malformed UUID (e.g. all-zero bytes, wrong char class) must be rejected.
    // Reuse the same validator used for incoming commands to prevent any crafted
    // flash content from injecting a bogus duplicate identity into the cache.
    if (!_validateCommandIdFormat(rec.command_id)) return;
    std::strncpy(_durable_receipt_command_id, rec.command_id,
                 sizeof(_durable_receipt_command_id) - 1);
    _durable_receipt_command_id[sizeof(_durable_receipt_command_id) - 1] = '\0';
}

bool TuningConfigManager::_validateSchemaVersion(const JsonVariant& doc) {
    JsonVariant version = doc["schema_version"];
    if (version.isNull()) return false;
    if (version.is<const char*>()) return false;
    if (!version.is<int>()) return false;
    return version.as<int>() == 1;
}

bool TuningConfigManager::_validateDeviceId(const JsonVariant& doc) {
    JsonVariant dev_id = doc["device_id"];
    if (dev_id.isNull() || !dev_id.is<const char*>()) return false;
    const char* actual = dev_id.as<const char*>();
    const char* expected = config::network::MQTT_CLIENT_ID_VAL.c_str();
    if (expected == nullptr || expected[0] == '\0') return false;
    return std::strcmp(expected, actual) == 0;
}

bool TuningConfigManager::_validateCommandIdFormat(const char* uuid_str) {
    if (uuid_str == nullptr) return false;
    if (std::strlen(uuid_str) != 36) return false;
    for (int i = 0; i < 36; ++i) {
        char c = uuid_str[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                return false;
            }
        }
    }
    return true;
}

bool TuningConfigManager::_validateConfigBounds(const JsonVariant& config) {
    if (!config.is<JsonObject>()) return false;
    
    JsonVariant lamp = config["lamp_gain_scale"];
    JsonVariant mist = config["mist_gain_scale"];
    JsonVariant mist_on = config["mist_on_threshold"];
    JsonVariant mist_off = config["mist_off_threshold"];
    
    if (!_validateNoNanInfinity(lamp)) return false;
    if (!_validateNoNanInfinity(mist)) return false;
    if (!_validateNoNanInfinity(mist_on)) return false;
    if (!_validateNoNanInfinity(mist_off)) return false;
    
    float l_val = lamp.as<float>();
    float m_val = mist.as<float>();
    float mon_val = mist_on.as<float>();
    float moff_val = mist_off.as<float>();
    
    if (l_val < 0.80f || l_val > 1.20f) return false;
    if (m_val < 0.80f || m_val > 1.20f) return false;
    if (mon_val < 0.20f || mon_val > 0.35f) return false;
    if (moff_val < 0.10f || moff_val > 0.20f) return false;
    
    return true;
}

bool TuningConfigManager::_validateCrossField(float mist_on, float mist_off) {
    return mist_off < mist_on;
}

bool TuningConfigManager::_validateNoNanInfinity(const JsonVariant& v) {
    if (v.isNull()) return false;
    if (v.is<const char*>()) return false; // Reject string-number
    if (!v.is<float>() && !v.is<double>() && !v.is<int>()) return false;
    float val = v.as<float>();
    return std::isfinite(val);
}

bool TuningConfigManager::_isExactDuplicate(const char* command_id) {
    if (command_id == nullptr) return false;
    // 1. Active effective config (survives reboot via NVS hydration in init()).
    if (std::strcmp(_active_params.command_id, command_id) == 0) return true;
    // 2. Durable no-change receipt (loaded from NVS in init(), updated by
    //    recordNoChangeReceipt in the same session). This is the key fix:
    //    enables DUPLICATE_UUID detection for no-change commands after reboot.
    if (_durable_receipt_command_id[0] != '\0' &&
        std::strcmp(_durable_receipt_command_id, command_id) == 0) return true;
    // 3. Session-only fast path (cleared on reboot, only for same-session
    //    same-tick QoS-1 redelivery before saveDurableReceipt completes).
    if (std::strcmp(_last_no_change_command_id, command_id) == 0) return true;

    // 4. Scan NVS config slots for any durable READY_DISPATCH record.
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) return false;
    NvsSlots slots{};
    readNvsSlots(prefs, slots);
    prefs.end();
    for (uint8_t slot = 0; slot < 2; ++slot) {
        if (slots.valid[slot] &&
            slots.records[slot].commit_state == TUNING_NVS_READY_DISPATCH &&
            std::strcmp(slots.records[slot].params.command_id, command_id) == 0) {
            return true;
        }
    }
    return false;
}

bool TuningConfigManager::_isSemanticDiff(const DynamicTuningParams& incoming) {
    if (std::abs(_active_params.lamp_gain_scale - incoming.lamp_gain_scale) >= 0.001f) return true;
    if (std::abs(_active_params.mist_gain_scale - incoming.mist_gain_scale) >= 0.001f) return true;
    if (std::abs(_active_params.mist_on_threshold - incoming.mist_on_threshold) >= 0.001f) return true;
    if (std::abs(_active_params.mist_off_threshold - incoming.mist_off_threshold) >= 0.001f) return true;
    return false;
}

} // namespace storage
