#include <cassert>
#include <cstdio>
#include <cstring>
#include <iostream>

#include "core/tuning_config_manager.h"
#include "config.h"
#include "network/mqtt_manager.h"

namespace test_outbox {
namespace {

void enqueueReport(mqtt::MqttManager& mqtt, unsigned sequence)
{
    char command_id[37]{};
    std::snprintf(command_id, sizeof(command_id),
                  "d4444444-1234-1234-1234-1234567890%02u", sequence);
    assert(mqtt.enqueuePendingReport(storage::TuningResult::ACCEPTED,
                                     storage::TuningReason::OK, command_id));
}

mqtt::NetworkMessage makeCommand(const char* command_id, uint32_t revision)
{
    char payload[mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES + 1]{};
    const int payload_length = std::snprintf(
        payload, sizeof(payload),
        "{\"schema_version\":1,\"command_id\":\"%s\",\"device_id\":\"mushroom_s3_unittest\","
        "\"revision\":%u,\"config\":{\"lamp_gain_scale\":1.1,\"mist_gain_scale\":0.9,"
        "\"mist_on_threshold\":0.28,\"mist_off_threshold\":0.18}}",
        command_id, static_cast<unsigned>(revision));
    assert(payload_length > 0 && static_cast<size_t>(payload_length) <= mqtt::MAX_TUNING_DESIRED_PAYLOAD_BYTES);

    mqtt::NetworkMessage message{};
    message.type = mqtt::CommandType::TUNING_DESIRED;
    message.payload_length = static_cast<size_t>(payload_length);
    std::memcpy(message.payload, payload, message.payload_length);
    return message;
}

} // namespace

void run_all_tests()
{
    std::cout << "[TEST SUITE] Tuning report outbox contract" << std::endl;

    auto& manager = mqtt::MqttManager::getInstance();
    auto& tuning = storage::TuningConfigManager::getInstance();
    manager.resetOutboxForTest();
    manager.setProvisionedForTest(true);
    manager.setTenantForTest("test_tenant");
    manager.setDeviceIdForTest("mushroom_s3_unittest");
    manager.setStateForTest(mqtt::MqttState::CONNECTED);
    config::network::MQTT_CLIENT_ID_VAL = "mushroom_s3_unittest";
    PubSubClient::mock_connected = true;
    PubSubClient::mock_publish_result = true;
    PubSubClient::mock_has_pending_qos1_publish = false;

    // A validated command owns its terminal report before persistence/Core-1
    // dispatch. The ingress suite separately verifies structured parsing.
    tuning.resetForTest();
    assert(tuning.init());
    const char* accepted_id = "d4444444-1234-1234-1234-123456789001";
    assert(manager.reserveTerminalReport(accepted_id));
    assert(manager.finalizeTerminalReport(accepted_id, storage::TuningResult::ACCEPTED,
                                          storage::TuningReason::OK));
    assert(manager.pendingReportCountForTest() == 1);
    assert(std::strcmp(manager.pendingReportCommandIdForTest(0), accepted_id) == 0);
    assert(manager.pendingReportResultForTest(0) == storage::TuningResult::ACCEPTED);

    // A report remains owned by the outbox from transport acceptance until
    // PUBACK. A missing/wrong ACK leaves it in place; only the observed correct
    // completion signal releases it exactly once.
    manager.processPendingReports();
    assert(manager.pendingReportCountForTest() == 1);
    assert(manager.reportInFlightForTest());
    PubSubClient::mock_has_pending_qos1_publish = true;
    manager.processPendingReports();
    assert(manager.pendingReportCountForTest() == 1);
    assert(manager.reportInFlightForTest());
    PubSubClient::mock_has_pending_qos1_publish = false;
    manager.processPendingReports();
    assert(manager.pendingReportCountForTest() == 0);
    assert(!manager.reportInFlightForTest());

    // Transport disconnect/short-write equivalent: the terminal report is
    // retained locally and starts publishing only after reconnect.
    enqueueReport(manager, 2);
    PubSubClient::mock_connected = false;
    manager.processPendingReports();
    assert(manager.pendingReportCountForTest() == 1);
    assert(!manager.reportInFlightForTest());
    PubSubClient::mock_connected = true;
    manager.processPendingReports();
    assert(manager.reportInFlightForTest());
    PubSubClient::mock_has_pending_qos1_publish = false;
    manager.processPendingReports();
    assert(manager.pendingReportCountForTest() == 0);

    // Full outbox cannot reserve an additional terminal report. Ingress must
    // defer redelivery before any NVS, active-RAM, or Core-1 mutation.
    manager.resetOutboxForTest();
    for (unsigned i = 10; i < 10 + mqtt::MqttManager::maxPendingReportsForTest(); ++i) {
        enqueueReport(manager, i);
    }
    const DynamicTuningParams active_before_full = tuning.getActiveParams();
    const char* blocked_id = "d4444444-1234-1234-1234-123456789099";
    assert(!manager.reserveTerminalReport(blocked_id));
    assert(manager.pendingReportCountForTest() == mqtt::MqttManager::maxPendingReportsForTest());
    const DynamicTuningParams active_after_full = tuning.getActiveParams();
    assert(std::memcmp(&active_before_full, &active_after_full, sizeof(DynamicTuningParams)) == 0);

    // Reserving the same canonical ID is idempotent: it does not create a
    // second terminal transition or consume another slot.
    manager.resetOutboxForTest();
    assert(manager.reserveTerminalReport(accepted_id));
    assert(manager.finalizeTerminalReport(accepted_id, storage::TuningResult::DUPLICATE,
                                          storage::TuningReason::DUPLICATE_UUID));
    assert(manager.reserveTerminalReport(accepted_id));
    assert(manager.pendingReportCountForTest() == 1);
    assert(manager.pendingReportResultForTest(0) == storage::TuningResult::DUPLICATE);

    manager.resetOutboxForTest();
    std::cout << "[TEST SUITE] Tuning report outbox contract passed" << std::endl;
}

} // namespace test_outbox
