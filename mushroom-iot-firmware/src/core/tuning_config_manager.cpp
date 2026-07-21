#include "core/tuning_config_manager.h"
#include <cstring>

#ifndef UNIT_TEST
#include <Arduino.h>
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
    
    // Check for semantic diff
    bool diff = _isSemanticDiff(incoming_params);
    
    if (diff) {
        // Persist to NVS (double-buffer slot will be handled in C5)
        if (!saveToNvs(incoming_params)) {
            reason = TuningReason::NVS_WRITE_ERROR;
            unlock();
            return TuningResult::REJECTED;
        }
        _active_params = incoming_params;
    } else {
        // Config params are the same, only update command identity to survive reboot
        std::strncpy(_active_params.command_id, incoming_params.command_id, sizeof(_active_params.command_id) - 1);
        _active_params.command_id[sizeof(_active_params.command_id) - 1] = '\0';
        _active_params.revision = incoming_params.revision;
        
        if (!saveToNvs(_active_params)) {
            reason = TuningReason::NVS_WRITE_ERROR;
            unlock();
            return TuningResult::REJECTED;
        }
    }
    
    // Posting to queue (depth 1, xQueueOverwrite) will be handled in C6/C7
    
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

bool TuningConfigManager::loadFromNvs(DynamicTuningParams& out_params) {
    return false;
}

bool TuningConfigManager::saveToNvs(const DynamicTuningParams& params) {
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
    
    if (!_validateNoNanInfinity(lamp) ||
        !_validateNoNanInfinity(mist) ||
        !_validateNoNanInfinity(mist_on) ||
        !_validateNoNanInfinity(mist_off)) {
        return false;
    }
    
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
