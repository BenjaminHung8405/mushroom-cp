#include "network/ota_manager.h"

#include "core/serial_mutex.h"
#include "core/storage.h"
#include "core/system_manager.h"
#include "network/mqtt_manager.h"

#ifndef UNIT_TEST
#include <Arduino.h>
#include <HTTPClient.h>
#include <esp_ota_ops.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <mbedtls/sha256.h>
#endif

namespace ota {
namespace {

constexpr unsigned long HEALTH_CHECK_TIMEOUT_MS = 45000UL;
constexpr size_t OTA_STREAM_BUFFER_BYTES = 4096;

static SemaphoreHandle_t ota_mutex = nullptr;
static bool ota_pending = false;
static OtaRequest pending_request{};
static bool pending_verify = false;
static unsigned long validation_started_ms = 0;

static constexpr int RELAY_GPIO_PINS[] = {10, 11, 12, 13};
static constexpr int RELAY_GPIO_COUNT = 4;

bool isHexSha256(const String& value)
{
    if (value.length() != 64) return false;
    for (size_t i = 0; i < value.length(); ++i) {
        if (!isxdigit(static_cast<unsigned char>(value[i]))) return false;
    }
    return true;
}

bool sameDigest(const unsigned char actual[32], const String& expected)
{
    static constexpr char HEX_DIGITS[] = "0123456789abcdef";
    for (size_t i = 0; i < 32; ++i) {
        const char high = tolower(static_cast<unsigned char>(expected[i * 2]));
        const char low = tolower(static_cast<unsigned char>(expected[i * 2 + 1]));
        if (HEX_DIGITS[actual[i] >> 4] != high || HEX_DIGITS[actual[i] & 0x0f] != low) return false;
    }
    return true;
}

void publishOtaAck(const OtaRequest& request, const char* status,
                   const char* error_code = nullptr, const char* error_message = nullptr)
{
    mqtt::MqttManager::getInstance().publishCommandAck(
        const_cast<char*>(request.command_id.c_str()), status, 0, nullptr, false,
        error_code, error_message);
}

void resumeCore1Tasks()
{
#ifndef UNIT_TEST
    if (hTaskCore1Control != nullptr) vTaskResume(hTaskCore1Control);
    if (hTaskHWButton != nullptr) vTaskResume(hTaskHWButton);
#endif
}

void suspendCore1TasksAndDisableRelays()
{
#ifndef UNIT_TEST
    for (int i = 0; i < RELAY_GPIO_COUNT; ++i) {
        digitalWrite(RELAY_GPIO_PINS[i], HIGH);
    }
    if (hTaskCore1Control != nullptr) vTaskSuspend(hTaskCore1Control);
    if (hTaskHWButton != nullptr) vTaskSuspend(hTaskHWButton);
#endif
}

} // namespace

void init()
{
#ifndef UNIT_TEST
    if (ota_mutex == nullptr) {
        ota_mutex = xSemaphoreCreateMutex();
        if (ota_mutex == nullptr) {
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[OTA] FATAL: could not create OTA mutex.");
        }
    }
#endif
}

void request_ota_update(const OtaRequest& request)
{
    if (request.command_id.isEmpty() || !request.url.startsWith("http://") ||
        !isHexSha256(request.sha256) || request.size == 0) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] Rejected invalid OTA request.");
        return;
    }

#ifndef UNIT_TEST
    if (ota_mutex == nullptr || xSemaphoreTake(ota_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] Cannot queue OTA request.");
        return;
    }
#endif
    pending_request = request;
    ota_pending = true;
#ifndef UNIT_TEST
    xSemaphoreGive(ota_mutex);
#endif
}

bool check_ota_trigger(OtaRequest& request)
{
#ifndef UNIT_TEST
    if (ota_mutex == nullptr || xSemaphoreTake(ota_mutex, pdMS_TO_TICKS(10)) != pdTRUE) return false;
#endif
    const bool triggered = ota_pending;
    if (triggered) {
        request = pending_request;
        pending_request = OtaRequest{};
        ota_pending = false;
    }
#ifndef UNIT_TEST
    xSemaphoreGive(ota_mutex);
#endif
    return triggered;
}

void perform_ota_update(const OtaRequest& request)
{
#ifdef UNIT_TEST
    (void)request;
    return;
#else
    ScopedSerialLock guard(SerialLock::get_instance());
    Serial.printf("[OTA] Downloading %s (%u bytes, version %s).\n", request.url.c_str(),
                  static_cast<unsigned>(request.size), request.version.c_str());
    mqtt::MqttManager::getInstance().publishStatus(false);
    suspendCore1TasksAndDisableRelays();

    HTTPClient http;
    if (!http.begin(request.url)) {
        publishOtaAck(request, "FAILED", "HTTP_BEGIN_FAILED", "Unable to create local HTTP request");
        resumeCore1Tasks();
        return;
    }
    const int status = http.GET();
    const int content_length = http.getSize();
    if (status != HTTP_CODE_OK || content_length < 0 ||
        static_cast<size_t>(content_length) != request.size) {
        http.end();
        publishOtaAck(request, "FAILED", "HTTP_METADATA_INVALID",
                      "Expected a 200 response with the declared image size");
        resumeCore1Tasks();
        return;
    }

    const esp_partition_t* target = esp_ota_get_next_update_partition(nullptr);
    if (target == nullptr || request.size > target->size) {
        http.end();
        publishOtaAck(request, "FAILED", "OTA_PARTITION_INVALID", "OTA image does not fit update partition");
        resumeCore1Tasks();
        return;
    }

    esp_ota_handle_t handle = 0;
    if (esp_ota_begin(target, request.size, &handle) != ESP_OK) {
        http.end();
        publishOtaAck(request, "FAILED", "OTA_BEGIN_FAILED", "Unable to erase OTA partition");
        resumeCore1Tasks();
        return;
    }

    WiFiClient* stream = http.getStreamPtr();
    uint8_t buffer[OTA_STREAM_BUFFER_BYTES];
    mbedtls_sha256_context sha;
    mbedtls_sha256_init(&sha);
    mbedtls_sha256_starts_ret(&sha, 0);
    size_t received = 0;
    bool failed = false;
    while (received < request.size) {
        const size_t available = stream->available();
        if (available == 0) {
            if (!http.connected()) {
                failed = true;
                break;
            }
            delay(1);
            esp_task_wdt_reset();
            continue;
        }
        const size_t wanted = min(min(available, sizeof(buffer)), request.size - received);
        const int read = stream->readBytes(buffer, wanted);
        if (read <= 0 || esp_ota_write(handle, buffer, static_cast<size_t>(read)) != ESP_OK) {
            failed = true;
            break;
        }
        mbedtls_sha256_update_ret(&sha, buffer, static_cast<size_t>(read));
        received += static_cast<size_t>(read);
        esp_task_wdt_reset();
    }

    unsigned char digest[32]{};
    mbedtls_sha256_finish_ret(&sha, digest);
    mbedtls_sha256_free(&sha);
    http.end();

    if (failed || received != request.size || !sameDigest(digest, request.sha256)) {
        esp_ota_abort(handle);
        publishOtaAck(request, "FAILED", failed || received != request.size ? "HTTP_STREAM_INCOMPLETE" : "SHA256_MISMATCH",
                      failed || received != request.size ? "OTA HTTP stream ended before the declared image size" : "Downloaded image hash does not match command");
        resumeCore1Tasks();
        return;
    }
    if (esp_ota_end(handle) != ESP_OK || esp_ota_set_boot_partition(target) != ESP_OK) {
        publishOtaAck(request, "FAILED", "OTA_FINALIZE_FAILED", "OTA image validation or boot partition selection failed");
        resumeCore1Tasks();
        return;
    }

    storage::StorageManager::get_instance().save_pending_ota_command(request.command_id);
    Serial.println("[OTA] SHA-256 verified; rebooting into pending image.");
    delay(100);
    esp_restart();
#endif
}

void begin_boot_validation()
{
#ifndef UNIT_TEST
    const esp_partition_t* running = esp_ota_get_running_partition();
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    if (running != nullptr && esp_ota_get_state_partition(running, &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY) {
        pending_verify = true;
        validation_started_ms = millis();
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] Pending image: waiting for SHT30 and MQTT health checks.");
    }
#endif
}

void process_boot_validation(bool sensor_healthy, bool mqtt_connected)
{
#ifndef UNIT_TEST
    if (!pending_verify) return;
    if (sensor_healthy && mqtt_connected) {
        if (esp_ota_mark_app_valid_cancel_rollback() == ESP_OK) {
            pending_verify = false;
            ScopedSerialLock guard(SerialLock::get_instance());
            Serial.println("[OTA] Firmware validated successfully.");
            String ota_cmd;
            if (storage::StorageManager::get_instance().load_pending_ota_command(ota_cmd)) {
                mqtt::MqttManager::getInstance().publishCommandAck(
                    const_cast<char*>(ota_cmd.c_str()), "SUCCESS", 0, nullptr, false, nullptr, nullptr);
                storage::StorageManager::get_instance().clear_pending_ota_command();
            }
        }
        return;
    }
    if (millis() - validation_started_ms >= HEALTH_CHECK_TIMEOUT_MS) {
        ScopedSerialLock guard(SerialLock::get_instance());
        Serial.println("[OTA] Health check timed out; rolling back.");
        esp_ota_mark_app_invalid_rollback_and_reboot();
    }
#else
    (void)sensor_healthy;
    (void)mqtt_connected;
#endif
}

} // namespace ota
