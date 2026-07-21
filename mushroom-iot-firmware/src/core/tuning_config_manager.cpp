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
    TuningReason val_reason = validateAndParse(doc, incoming_params);
    if (val_reason != TuningReason::OK) {
        reason = val_reason;
        unlock();
        return TuningResult::REJECTED;
    }
    
    // Check for duplicate UUID
    if (_isExactDuplicate(incoming_params.command_id)) {
        reason = TuningReason::DUPLICATE_UUID;
        unlock();
        return TuningResult::DUPLICATE;
    }
    
    // Build the candidate entirely on the stack. _active_params is committed
    // only after both durable persistence and the Core 1 handoff succeed.
    const DynamicTuningParams previous_params = _active_params;
    DynamicTuningParams candidate_params = incoming_params;
    if (!_isSemanticDiff(incoming_params)) {
        // Preserve the effective values for semantic no-change commands while
        // persisting the new command identity/revision for duplicate handling.
        candidate_params = previous_params;
        std::strncpy(candidate_params.command_id, incoming_params.command_id,
                     sizeof(candidate_params.command_id) - 1);
        candidate_params.command_id[sizeof(candidate_params.command_id) - 1] = '\0';
        candidate_params.revision = incoming_params.revision;
    }

    if (!saveToNvs(candidate_params)) {
        reason = TuningReason::NVS_WRITE_ERROR;
        unlock();
        return TuningResult::REJECTED;
    }

    // A queue failure must not leave a durable configuration that Core 1 did
    // not adopt. Restore the previously effective record before rejecting.
    if (g_tuning_config_queue == nullptr ||
        xQueueOverwrite(g_tuning_config_queue, &candidate_params) != pdTRUE) {
        if (!saveToNvs(previous_params)) {
            reason = TuningReason::NVS_WRITE_ERROR;
            unlock();
            return TuningResult::REJECTED;
        }
        reason = TuningReason::QUEUE_FULL_ERROR;
        unlock();
        return TuningResult::REJECTED;
    }

    _active_params = candidate_params;
    reason = TuningReason::OK;
    unlock();
    return TuningResult::ACCEPTED;
}

DynamicTuningParams TuningConfigManager::getActiveParams() {
    lock();
    DynamicTuningParams copy = _active_params;
    unlock();
    return copy;
}

void TuningConfigManager::resetForTest() {
    lock();
    std::memset(&_active_params, 0, sizeof(_active_params));
    _active_params.revision = 0;
    _active_params.lamp_gain_scale = 1.0f;
    _active_params.mist_gain_scale = 1.0f;
    _active_params.mist_on_threshold = 0.25f;
    _active_params.mist_off_threshold = 0.15f;
    _initialized = false;
    unlock();
}

TuningReason TuningConfigManager::validateAndParse(const JsonVariant& doc, DynamicTuningParams& out_params) {
    if (doc.isNull() || !doc.is<JsonObject>()) {
        return TuningReason::INVALID_SCHEMA;
    }
    
    // 1. Schema version
    if (!_validateSchemaVersion(doc)) {
        return TuningReason::INVALID_SCHEMA;
    }
    
    // 2. Device ID
    if (!_validateDeviceId(doc)) {
        return TuningReason::INVALID_DEVICE_ID;
    }
    
    // 3. Command ID (UUID)
    JsonVariant cmd_id_var = doc["command_id"];
    if (cmd_id_var.isNull() || !cmd_id_var.is<const char*>()) {
        return TuningReason::INVALID_UUID;
    }
    const char* cmd_id_str = cmd_id_var.as<const char*>();
    if (!_validateCommandIdFormat(cmd_id_str)) {
        return TuningReason::INVALID_UUID;
    }
    
    // 4. Revision
    JsonVariant rev_var = doc["revision"];
    if (rev_var.isNull() || rev_var.is<const char*>() || (!rev_var.is<int>() && !rev_var.is<unsigned int>())) {
        return TuningReason::INVALID_SCHEMA;
    }
    uint32_t revision = rev_var.as<uint32_t>();
    
    // 5. Config Bounds
    JsonVariant config = doc["config"];
    if (config.isNull() || !config.is<JsonObject>()) {
        return TuningReason::INVALID_SCHEMA;
    }
    if (!_validateConfigBounds(config)) {
        return TuningReason::OUT_OF_BOUNDS;
    }
    
    // 6. Cross field
    float mist_on = config["mist_on_threshold"].as<float>();
    float mist_off = config["mist_off_threshold"].as<float>();
    if (!_validateCrossField(mist_on, mist_off)) {
        return TuningReason::CROSS_FIELD_VIOLATION;
    }
    
    // Populate parsed parameters
    std::memset(&out_params, 0, sizeof(out_params));
    std::strncpy(out_params.command_id, cmd_id_str, sizeof(out_params.command_id) - 1);
    out_params.command_id[sizeof(out_params.command_id) - 1] = '\0';
    out_params.revision = revision;
    out_params.lamp_gain_scale = config["lamp_gain_scale"].as<float>();
    out_params.mist_gain_scale = config["mist_gain_scale"].as<float>();
    out_params.mist_on_threshold = mist_on;
    out_params.mist_off_threshold = mist_off;
    
    return TuningReason::OK;
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

    TuningNvsRecord rec0;
    std::memset(&rec0, 0, sizeof(TuningNvsRecord));
    TuningNvsRecord rec1;
    std::memset(&rec1, 0, sizeof(TuningNvsRecord));
    bool valid0 = false;
    bool valid1 = false;

    size_t read0 = prefs.getBytes("tune_s0", &rec0, sizeof(TuningNvsRecord));
    if (read0 == sizeof(TuningNvsRecord) && rec0.version == 1) {
        uint32_t calc_crc = calculateCRC32(reinterpret_cast<const uint8_t*>(&rec0), offsetof(TuningNvsRecord, crc32));
        if (calc_crc == rec0.crc32) {
            valid0 = true;
        }
    }

    size_t read1 = prefs.getBytes("tune_s1", &rec1, sizeof(TuningNvsRecord));
    if (read1 == sizeof(TuningNvsRecord) && rec1.version == 1) {
        uint32_t calc_crc = calculateCRC32(reinterpret_cast<const uint8_t*>(&rec1), offsetof(TuningNvsRecord, crc32));
        if (calc_crc == rec1.crc32) {
            valid1 = true;
        }
    }

    prefs.end();

    if (valid0 && valid1) {
        if (rec0.generation >= rec1.generation) {
            out_params = rec0.params;
        } else {
            out_params = rec1.params;
        }
        return true;
    } else if (valid0) {
        out_params = rec0.params;
        return true;
    } else if (valid1) {
        out_params = rec1.params;
        return true;
    }

    return false;
}

bool TuningConfigManager::saveToNvs(const DynamicTuningParams& params) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    TuningNvsRecord rec0;
    std::memset(&rec0, 0, sizeof(TuningNvsRecord));
    TuningNvsRecord rec1;
    std::memset(&rec1, 0, sizeof(TuningNvsRecord));
    bool valid0 = false;
    bool valid1 = false;
    uint32_t gen0 = 0;
    uint32_t gen1 = 0;

    size_t read0 = prefs.getBytes("tune_s0", &rec0, sizeof(TuningNvsRecord));
    if (read0 == sizeof(TuningNvsRecord) && rec0.version == 1) {
        uint32_t calc_crc = calculateCRC32(reinterpret_cast<const uint8_t*>(&rec0), offsetof(TuningNvsRecord, crc32));
        if (calc_crc == rec0.crc32) {
            valid0 = true;
            gen0 = rec0.generation;
        }
    }

    size_t read1 = prefs.getBytes("tune_s1", &rec1, sizeof(TuningNvsRecord));
    if (read1 == sizeof(TuningNvsRecord) && rec1.version == 1) {
        uint32_t calc_crc = calculateCRC32(reinterpret_cast<const uint8_t*>(&rec1), offsetof(TuningNvsRecord, crc32));
        if (calc_crc == rec1.crc32) {
            valid1 = true;
            gen1 = rec1.generation;
        }
    }

    uint8_t next_slot = 0;
    if (!valid0) {
        next_slot = 0;
    } else if (!valid1) {
        next_slot = 1;
    } else {
        next_slot = (gen0 <= gen1) ? 0 : 1;
    }

    uint32_t next_gen = 1;
    if (valid0 || valid1) {
        next_gen = (gen0 > gen1 ? gen0 : gen1) + 1;
    }

    TuningNvsRecord new_rec;
    std::memset(&new_rec, 0, sizeof(TuningNvsRecord));
    new_rec.version = 1;
    new_rec.generation = next_gen;
    new_rec.params = params;
    new_rec.crc32 = calculateCRC32(reinterpret_cast<const uint8_t*>(&new_rec), offsetof(TuningNvsRecord, crc32));

    const char* key = (next_slot == 0) ? "tune_s0" : "tune_s1";
    size_t written = prefs.putBytes(key, &new_rec, sizeof(TuningNvsRecord));
    if (written != sizeof(TuningNvsRecord)) {
        prefs.end();
        return false;
    }

    // Readback verification
    TuningNvsRecord readback;
    std::memset(&readback, 0, sizeof(TuningNvsRecord));
    size_t read_bytes = prefs.getBytes(key, &readback, sizeof(TuningNvsRecord));
    prefs.end();

    if (read_bytes != sizeof(TuningNvsRecord)) {
        std::printf("[DEBUG] read_bytes (%zu) != sizeof(TuningNvsRecord) (%zu)\n", read_bytes, sizeof(TuningNvsRecord));
        return false;
    }

    uint32_t calc_crc = calculateCRC32(reinterpret_cast<const uint8_t*>(&readback), offsetof(TuningNvsRecord, crc32));
    if (calc_crc != readback.crc32 || readback.crc32 != new_rec.crc32 || readback.generation != new_rec.generation) {
        std::printf("[DEBUG] CRC or Gen mismatch: calc_crc=0x%08X, readback.crc32=0x%08X, new_rec.crc32=0x%08X, readback.gen=%u, new_rec.gen=%u\n",
                    calc_crc, readback.crc32, new_rec.crc32, readback.generation, new_rec.generation);
        return false;
    }

    return true;
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
    String expected = config::network::resolve_device_identity();
    return expected.equals(dev_id.as<const char*>());
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
    
    if (!_validateNoNanInfinity(lamp)) { std::printf("[DEBUG] lamp failed NoNanInfinity\n"); return false; }
    if (!_validateNoNanInfinity(mist)) { std::printf("[DEBUG] mist failed NoNanInfinity\n"); return false; }
    if (!_validateNoNanInfinity(mist_on)) { std::printf("[DEBUG] mist_on failed NoNanInfinity\n"); return false; }
    if (!_validateNoNanInfinity(mist_off)) { std::printf("[DEBUG] mist_off failed NoNanInfinity\n"); return false; }
    
    float l_val = lamp.as<float>();
    float m_val = mist.as<float>();
    float mon_val = mist_on.as<float>();
    float moff_val = mist_off.as<float>();
    
    std::printf("[DEBUG] l_val=%f, m_val=%f, mon_val=%f, moff_val=%f\n", l_val, m_val, mon_val, moff_val);
    
    if (l_val < 0.80f || l_val > 1.20f) { std::printf("[DEBUG] l_val out of bounds\n"); return false; }
    if (m_val < 0.80f || m_val > 1.20f) { std::printf("[DEBUG] m_val out of bounds\n"); return false; }
    if (mon_val < 0.20f || mon_val > 0.35f) { std::printf("[DEBUG] mon_val out of bounds\n"); return false; }
    if (moff_val < 0.10f || moff_val > 0.20f) { std::printf("[DEBUG] moff_val out of bounds\n"); return false; }
    
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
    return std::strcmp(_active_params.command_id, command_id) == 0;
}

bool TuningConfigManager::_isSemanticDiff(const DynamicTuningParams& incoming) {
    if (std::abs(_active_params.lamp_gain_scale - incoming.lamp_gain_scale) >= 0.001f) return true;
    if (std::abs(_active_params.mist_gain_scale - incoming.mist_gain_scale) >= 0.001f) return true;
    if (std::abs(_active_params.mist_on_threshold - incoming.mist_on_threshold) >= 0.001f) return true;
    if (std::abs(_active_params.mist_off_threshold - incoming.mist_off_threshold) >= 0.001f) return true;
    return false;
}

} // namespace storage
