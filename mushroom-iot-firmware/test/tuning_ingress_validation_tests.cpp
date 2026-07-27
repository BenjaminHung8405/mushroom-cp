#include <cassert>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <vector>

#include "core/system_manager.h"
#include "core/tuning_config_manager.h"
#include "network/mqtt_manager.h"
#include "Preferences.h"

namespace test_ingress {
namespace {

constexpr const char* kValidCommandId = "d4444444-1234-1234-1234-123456789012";

struct InvalidDesiredCase {
    const char* name;
    const char* command_id;
    const char* payload;
    storage::TuningReason reason;
    const char* reason_code;
};

void assertNoMutation(const DynamicTuningParams& before,
                      const DynamicTuningParams& after)
{
    assert(std::memcmp(&before, &after, sizeof(DynamicTuningParams)) == 0);
}

void assertInvalidDesiredRejected(const InvalidDesiredCase& test_case,
                                  mqtt::MqttManager& manager,
                                  storage::TuningConfigManager& tuning,
                                  const DynamicTuningParams& active_before,
                                  const std::map<std::string, std::string>& nvs_before)
{
    manager.resetOutboxForTest();
    manager.setStateForTest(mqtt::MqttState::CONNECTED);
    PubSubClient::mock_connected = true;
    PubSubClient::mock_publish_result = true;
    PubSubClient::mock_has_pending_qos1_publish = false;
    PubSubClient::mock_last_published_payload.clear();
    assert(xQueueReset(g_tuning_config_queue) == pdTRUE);

    const size_t writes_before = Preferences::mock_put_bytes_count;
    mqtt::NetworkMessage message{};
    message.type = mqtt::CommandType::TUNING_DESIRED;
    message.payload_length = std::strlen(test_case.payload);
    assert(message.payload_length <= sizeof(message.payload));
    std::memcpy(message.payload, test_case.payload, message.payload_length);

    manager.processNetworkMessage(message);

    assert(manager.getState() == mqtt::MqttState::CONNECTED);
    assert(manager.pendingReportCountForTest() == 1);
    assert(manager.reportInFlightForTest());
    assert(std::strcmp(manager.pendingReportCommandIdForTest(0), test_case.command_id) == 0);
    assert(manager.pendingReportResultForTest(0) == storage::TuningResult::REJECTED);
    assert(manager.pendingReportReasonForTest(0) == test_case.reason);
    assert(PubSubClient::mock_last_published_payload.find("\"status\":\"REJECTED\"") !=
           std::string::npos);
    const std::string expected_reason =
        std::string("\"reason_code\":\"") + test_case.reason_code + "\"";
    assert(PubSubClient::mock_last_published_payload.find(expected_reason) != std::string::npos);
    assert(PubSubClient::mock_last_published_payload.find("\"persisted\":false") !=
           std::string::npos);
    assert(!PubSubClient::mock_last_published_retained);
    assert(PubSubClient::mock_last_published_qos == 1);

    assertNoMutation(active_before, tuning.getActiveParams());
    assert(Preferences::mock_put_bytes_count == writes_before);
    assert(Preferences::_global_storage["mushroom_cfg"] == nvs_before);
    assert(uxQueueMessagesWaiting(g_tuning_config_queue) == 0U);
    std::cout << "[TEST] L6 rejected " << test_case.name << " as "
              << test_case.reason_code << std::endl;
}

} // namespace

void run_all_tests()
{
    std::cout << "[TEST SUITE] Tuning ingress validation contract" << std::endl;

    auto& manager = mqtt::MqttManager::getInstance();
    auto& tuning = storage::TuningConfigManager::getInstance();
    manager.resetOutboxForTest();
    manager.setProvisionedForTest(true);
    manager.setStateForTest(mqtt::MqttState::CONNECTED);
    PubSubClient::mock_connected = true;
    PubSubClient::mock_publish_result = true;
    PubSubClient::mock_has_pending_qos1_publish = false;
    tuning.resetForTest();
    assert(tuning.init());

    const DynamicTuningParams before = tuning.getActiveParams();
    const auto assertDeferredWithoutMutation = [&](const char* payload, size_t length) {
        manager.resetOutboxForTest();
        mqtt::NetworkMessage message{};
        message.type = mqtt::CommandType::TUNING_DESIRED;
        message.payload_length = length;
        if (payload != nullptr && length <= sizeof(message.payload)) {
            std::memcpy(message.payload, payload, length);
        }

        manager.setStateForTest(mqtt::MqttState::CONNECTED);
        manager.processNetworkMessage(message);
        assert(manager.getState() == mqtt::MqttState::DISCONNECTED);
        assert(manager.pendingReportCountForTest() == 0);
        assertNoMutation(before, tuning.getActiveParams());
    };

    const auto assertRejectedWithoutMutation = [&](const char* payload, size_t length) {
        mqtt::NetworkMessage message{};
        message.type = mqtt::CommandType::TUNING_DESIRED;
        message.payload_length = length;
        assert(length <= sizeof(message.payload));
        std::memcpy(message.payload, payload, length);

        manager.resetOutboxForTest();
        manager.setStateForTest(mqtt::MqttState::CONNECTED);
        PubSubClient::mock_connected = true;
        PubSubClient::mock_has_pending_qos1_publish = false;
        manager.processNetworkMessage(message);

        assert(manager.getState() == mqtt::MqttState::CONNECTED);
        assert(manager.pendingReportCountForTest() == 1);
        assert(manager.reportInFlightForTest());
        assert(PubSubClient::mock_last_published_payload.find("\"status\":\"REJECTED\"") != std::string::npos);
        assert(PubSubClient::mock_last_published_payload.find("\"reason_code\":\"INVALID_SCHEMA\"") != std::string::npos);
        assert(!PubSubClient::mock_last_published_retained);
        assert(PubSubClient::mock_last_published_qos == 1);
        assert(std::strcmp(manager.pendingReportCommandIdForTest(0), kValidCommandId) == 0);
        assert(manager.pendingReportResultForTest(0) == storage::TuningResult::REJECTED);
        assert(manager.pendingReportReasonForTest(0) == storage::TuningReason::INVALID_SCHEMA);
        // QoS-1 ownership persists until the transport reports completion.
        PubSubClient::mock_has_pending_qos1_publish = true;
        manager.processPendingReports();
        assert(manager.pendingReportCountForTest() == 1);
        assertNoMutation(before, tuning.getActiveParams());
        PubSubClient::mock_has_pending_qos1_publish = false;
    };

    // A malformed or oversize payload with a canonical root identity receives
    // a terminal INVALID_SCHEMA report. The manager is never invoked, so this
    // path cannot alter NVS, active RAM, or the Core-1 tuning queue.
    const char malformed_with_uuid[] =
        "{\"command_id\":\"d4444444-1234-1234-1234-123456789012\",";
    assertRejectedWithoutMutation(malformed_with_uuid, std::strlen(malformed_with_uuid));
    // JSON member names may use legal escapes. Even though this body is
    // malformed, its decoded root identity remains attributable and must get
    // a terminal INVALID_SCHEMA report rather than disconnect/redelivery.
    const char malformed_with_escaped_key[] =
        "{\"command_\\u0069d\":\"d4444444-1234-1234-1234-123456789012\",";
    assertRejectedWithoutMutation(malformed_with_escaped_key,
                                  std::strlen(malformed_with_escaped_key));
    {
        char oversized[mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES + 1]{};
        const int prefix_length = std::snprintf(
            oversized, sizeof(oversized), "{\"command_id\":\"%s\",", kValidCommandId);
        assert(prefix_length > 0);
        std::memset(oversized + prefix_length, ' ', sizeof(oversized) - prefix_length);
        assertRejectedWithoutMutation(oversized, sizeof(oversized));
    }

    // A terminal report requires a canonical root command identity. Without
    // one, the protocol fail-closes by disconnecting and broker redelivery
    // rather than producing an invalid empty-command ACK.
    {
        char oversized[mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES + 1];
        std::memset(oversized, 'x', sizeof(oversized));
        assertDeferredWithoutMutation(oversized, sizeof(oversized));
    }
    const char missing_uuid[] = "{\"device_id\":\"mushroom_s3_unittest\"}";
    assertDeferredWithoutMutation(missing_uuid, std::strlen(missing_uuid));

    // L6 fault-injection table exercises the complete production ingress,
    // validator, terminal report, persistence, RAM, and Core-1 queue boundary.
    const std::vector<InvalidDesiredCase> invalid_cases = {
        {"NaN", "d4444444-1234-4234-8234-123456789101",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789101","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":NaN,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::INVALID_SCHEMA, "INVALID_SCHEMA"},
        {"Infinity", "d4444444-1234-4234-8234-123456789102",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789102","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":Infinity,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::INVALID_SCHEMA, "INVALID_SCHEMA"},
        {"string number", "d4444444-1234-4234-8234-123456789103",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789103","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":"1.05","mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::OUT_OF_BOUNDS, "OUT_OF_RANGE"},
        {"null", "d4444444-1234-4234-8234-123456789104",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789104","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":null,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::OUT_OF_BOUNDS, "OUT_OF_RANGE"},
        {"missing key", "d4444444-1234-4234-8234-123456789105",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789105","device_id":"mushroom_s3_unittest","revision":1,"config":{"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::OUT_OF_BOUNDS, "OUT_OF_RANGE"},
        {"schema version", "d4444444-1234-4234-8234-123456789106",
         R"({"schema_version":2,"command_id":"d4444444-1234-4234-8234-123456789106","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":1.05,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::INVALID_SCHEMA, "INVALID_SCHEMA"},
        {"device mismatch", "d4444444-1234-4234-8234-123456789107",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789107","device_id":"another_device","revision":1,"config":{"lamp_gain_scale":1.05,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::INVALID_DEVICE_ID, "DEVICE_MISMATCH"},
        {"invalid UUID", "not-a-uuid",
         R"({"schema_version":1,"command_id":"not-a-uuid","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":1.05,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::INVALID_UUID, "INVALID_UUID"},
        {"invalid hysteresis", "d4444444-1234-4234-8234-123456789109",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789109","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":1.05,"mist_gain_scale":1.0,"mist_on_threshold":0.20,"mist_off_threshold":0.20}})",
         storage::TuningReason::CROSS_FIELD_VIOLATION, "CROSS_FIELD_INVALID"},
        {"hard bounds", "d4444444-1234-4234-8234-123456789110",
         R"({"schema_version":1,"command_id":"d4444444-1234-4234-8234-123456789110","device_id":"mushroom_s3_unittest","revision":1,"config":{"lamp_gain_scale":1.21,"mist_gain_scale":1.0,"mist_on_threshold":0.25,"mist_off_threshold":0.15}})",
         storage::TuningReason::OUT_OF_BOUNDS, "OUT_OF_RANGE"},
    };
    const auto nvs_before = Preferences::_global_storage["mushroom_cfg"];
    for (const InvalidDesiredCase& test_case : invalid_cases) {
        assertInvalidDesiredRejected(test_case, manager, tuning, before, nvs_before);
    }

    // Escaped key is decoded by ArduinoJson and still identifies the root
    // command_id. The ingress classifier therefore yields a canonical ID for
    // a later durable, attributable schema rejection.
    {
        const char payload[] =
            "{\"schema_version\":1,\"command_\\u0069d\":\"d4444444-1234-1234-1234-123456789012\","
            "\"device_id\":\"mushroom_s3_unittest\",\"revision\":1,"
            "\"config\":{\"lamp_gain_scale\":99.0,\"mist_gain_scale\":1.0,"
            "\"mist_on_threshold\":0.25,\"mist_off_threshold\":0.15}}";
        ArduinoJson::StaticJsonDocument<1024> document;
        char command_id[37]{};
        assert(manager.classifyTuningMessage(const_cast<char*>(payload), sizeof(payload) - 1,
                                             document, command_id) ==
               mqtt::MqttManager::TuningIngressDecision::PROCESS_COMMAND);
        assert(std::strcmp(command_id, kValidCommandId) == 0);
    }

    manager.resetOutboxForTest();
    std::cout << "[TEST SUITE] Tuning ingress validation contract passed" << std::endl;
}

} // namespace test_ingress
