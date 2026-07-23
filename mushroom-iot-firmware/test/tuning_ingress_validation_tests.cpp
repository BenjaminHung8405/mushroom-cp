#include <cassert>
#include <cstring>
#include <iostream>

#include "core/tuning_config_manager.h"
#include "network/mqtt_manager.h"

namespace test_ingress {
namespace {

constexpr const char* kValidCommandId = "d4444444-1234-1234-1234-123456789012";

void assertNoMutation(const DynamicTuningParams& before,
                      const DynamicTuningParams& after)
{
    assert(std::memcmp(&before, &after, sizeof(DynamicTuningParams)) == 0);
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
    tuning.resetForTest();
    assert(tuning.init());

    const DynamicTuningParams before = tuning.getActiveParams();
    const auto assertDeferredWithoutMutation = [&](const char* payload, size_t length) {
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

    // A terminal report requires a canonical command identity. Otherwise the
    // protocol fails closed by disconnecting, so MQTT redelivery preserves the
    // delivery obligation instead of silently dropping an unaddressable error.
    {
        char oversized[mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES + 1];
        std::memset(oversized, 'x', sizeof(oversized));
        assertDeferredWithoutMutation(oversized, sizeof(oversized));
    }
    const char malformed[] = "{\"command_id\":\"d4444444-1234-1234-1234-123456789012\",";
    const char missing_uuid[] = "{\"device_id\":\"mushroom_s3_unittest\"}";
    const char invalid_uuid[] = "{\"command_id\":\"not-a-uuid\"}";
    assertDeferredWithoutMutation(malformed, std::strlen(malformed));
    assertDeferredWithoutMutation(missing_uuid, std::strlen(missing_uuid));
    assertDeferredWithoutMutation(invalid_uuid, std::strlen(invalid_uuid));

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
