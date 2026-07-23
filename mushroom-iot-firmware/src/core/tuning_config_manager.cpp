#include "core/tuning_config_manager.h"
#include <cstring>
#include <cmath>
#include "Arduino.h"
#include "config.h"
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
    _has_pending_dispatch = false;
    // RAM fast-path cleared on every boot; durable receipt is loaded from NVS below.
    std::memset(_last_no_change_command_id, 0, sizeof(_last_no_change_command_id));
    std::memset(_durable_receipt_command_id, 0, sizeof(_durable_receipt_command_id));

    if (_storage != nullptr) {
        _storage->loadDurableReceipt(_durable_receipt_command_id, sizeof(_durable_receipt_command_id));
    }
    DynamicTuningParams loaded;
    if (_storage != nullptr && _storage->loadTuningParams(loaded)) {
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

bool TuningConfigManager::getPendingCommandId(char* out_uuid) {
    lock();
    bool has_pending = _has_pending_dispatch;
    if (has_pending && out_uuid != nullptr) {
        std::strncpy(out_uuid, _pending_params.command_id, 36);
        out_uuid[36] = '\0';
    }
    unlock();
    return has_pending;
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
    if (value.isNull() || value.is<const char*>() || value.is<bool>() || value.is<float>() || value.is<double>()) {
        return TuningReason::INVALID_SCHEMA;
    }
    if (value.is<int>() || value.is<long>() || value.is<long long>() ||
        value.is<unsigned int>() || value.is<unsigned long>() || value.is<unsigned long long>()) {
        const int64_t rev = value.as<int64_t>();
        if (rev < 0 || rev > 4294967295LL) return TuningReason::INVALID_SCHEMA;
        revision = static_cast<uint32_t>(rev);
        return TuningReason::OK;
    }
    return TuningReason::INVALID_SCHEMA;
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
    if (_storage == nullptr) {
        Serial.println("[TUNING] persistThenDispatch FAIL: _storage is null!");
        reason = TuningReason::NVS_WRITE_ERROR;
        return TuningResult::REJECTED;
    }
    if (!_storage->saveTuningParams(incoming)) {
        Serial.println("[TUNING] persistThenDispatch FAIL: saveTuningParams returned false!");
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
        Serial.printf("[TUNING] persistThenDispatch ACCEPTED: rev=%u command_id=%s\n",
                      _active_params.revision, _active_params.command_id);
        return TuningResult::ACCEPTED;
    }
    Serial.println("[TUNING] persistThenDispatch: g_tuning_config_queue send returned PENDING");
    reason = TuningReason::QUEUE_FULL_ERROR;
    return TuningResult::PENDING;
}

TuningResult TuningConfigManager::recordNoChangeReceipt(const DynamicTuningParams& incoming,
                                                         TuningReason& reason) {
    if (_storage == nullptr || !_storage->saveDurableReceipt(incoming.command_id)) {
        reason = TuningReason::NVS_WRITE_ERROR;
        return TuningResult::REJECTED;
    }
    std::strncpy(_last_no_change_command_id, incoming.command_id,
                 sizeof(_last_no_change_command_id) - 1);
    _last_no_change_command_id[sizeof(_last_no_change_command_id) - 1] = '\0';
    std::strncpy(_durable_receipt_command_id, incoming.command_id,
                 sizeof(_durable_receipt_command_id) - 1);
    _durable_receipt_command_id[sizeof(_durable_receipt_command_id) - 1] = '\0';
    reason = TuningReason::NO_CHANGE;
    return TuningResult::DUPLICATE;
}

bool TuningConfigManager::_validateSchemaVersion(const JsonVariant& doc) {
    JsonVariant version = doc["schema_version"];
    if (version.isNull()) return false;
    return !version.is<const char*>() && !version.is<bool>() && version.as<int>() == 1;
}

bool TuningConfigManager::_validateDeviceId(const JsonVariant& doc) {
    JsonVariant dev_id = doc["device_id"];
    if (dev_id.isNull() || !dev_id.is<const char*>()) {
        Serial.println("[TUNING] _validateDeviceId: dev_id is null or not string");
        return false;
    }
    const char* actual = dev_id.as<const char*>();
    const char* expected = config::network::MQTT_CLIENT_ID_VAL.c_str();
    if (expected == nullptr || expected[0] == '\0') {
        Serial.println("[TUNING] _validateDeviceId: expected MQTT_CLIENT_ID_VAL is empty");
        return false;
    }
    bool match = (std::strcmp(expected, actual) == 0);
    if (!match) {
        Serial.printf("[TUNING] _validateDeviceId FAIL: expected='%s' actual='%s'\n", expected, actual);
    }
    return match;
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
    if (v.isNull() || v.is<const char*>() || v.is<bool>()) return false;
    float val = v.as<float>();
    return std::isfinite(val);
}

bool TuningConfigManager::_isExactDuplicate(const char* command_id) {
    if (command_id == nullptr) return false;
    if (std::strcmp(_active_params.command_id, command_id) == 0) return true;
    if (_durable_receipt_command_id[0] != '\0' &&
        std::strcmp(_durable_receipt_command_id, command_id) == 0) return true;
    if (std::strcmp(_last_no_change_command_id, command_id) == 0) return true;

    if (_storage != nullptr) {
        return _storage->isDuplicateInNvs(command_id);
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
