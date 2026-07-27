#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
#include <sstream>
#include "storage/tuning_storage.h"
#include "core/tuning_config_manager.h"
#include "Preferences.h"

namespace test_storage {

uint32_t calculateRecordCrcForTest(const storage::TuningNvsRecord& record) {
    uint32_t crc = 0xFFFFFFFF;
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&record);
    for (size_t i = 0; i < offsetof(storage::TuningNvsRecord, crc32); ++i) {
        crc ^= bytes[i];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 1U) ? (crc >> 1U) ^ 0xEDB88320U : crc >> 1U;
        }
    }
    return ~crc;
}

static void testTwoSlotPersistence(storage::TuningConfigManager& tuner) {
    tuner.resetForTest();
    tuner.init();
    DynamicTuningParams initial = tuner.getActiveParams();
    assert(initial.revision == 0);

    const char* cmd1 = "{\"schema_version\":1,\"command_id\":\"d4444444-1234-1234-1234-123456789010\",\"device_id\":\"mushroom_s3_unittest\",\"revision\":1,\"config\":{\"lamp_gain_scale\":1.08,\"mist_gain_scale\":1.05,\"mist_on_threshold\":0.29,\"mist_off_threshold\":0.16}}";
    ArduinoJson::StaticJsonDocument<512> doc1;
    ArduinoJson::deserializeJson(doc1, cmd1);
    storage::TuningReason reason = storage::TuningReason::OK;
    storage::TuningResult res1 = tuner.processCommand(doc1.as<ArduinoJson::JsonVariant>(), reason);
    assert(res1 == storage::TuningResult::ACCEPTED);
    assert(reason == storage::TuningReason::OK);

    DynamicTuningParams after1 = tuner.getActiveParams();
    assert(after1.revision == 1);
    assert(after1.lamp_gain_scale == 1.08f);

    tuner.init();
    DynamicTuningParams rehydrated = tuner.getActiveParams();
    assert(rehydrated.revision == 1);
    assert(rehydrated.lamp_gain_scale == 1.08f);
    assert(std::strcmp(rehydrated.command_id, "d4444444-1234-1234-1234-123456789010") == 0);
}

static void testCorruptedEnvelopeFallback(storage::TuningStorageImpl& nvs_storage,
                                           storage::TuningConfigManager& tuner) {
    Preferences::_global_storage["mushroom_cfg"].clear();
    tuner.resetForTest();
    tuner.init();
    const DynamicTuningParams active_before = tuner.getActiveParams();

    DynamicTuningParams valid_params = active_before;
    std::strncpy(valid_params.command_id, "d4444444-1234-1234-1234-123456789010",
                 sizeof(valid_params.command_id) - 1);
    valid_params.revision = 1;
    valid_params.lamp_gain_scale = 1.08f;
    valid_params.mist_gain_scale = 1.05f;
    valid_params.mist_on_threshold = 0.29f;
    valid_params.mist_off_threshold = 0.16f;
    assert(nvs_storage.saveTuningParams(valid_params));

    auto& global_nvs = Preferences::_global_storage["mushroom_cfg"];
    storage::TuningNvsRecord record{};
    std::memcpy(&record, global_nvs["tune_s0"].data(), sizeof(record));
    std::strcpy(record.params.command_id, "z4444444-1234-1234-1234-123456789010");
    record.crc32 = calculateRecordCrcForTest(record);
    global_nvs["tune_s0"] = std::string(reinterpret_cast<const char*>(&record), sizeof(record));

    storage::TuningNvsRecord record1{};
    std::memcpy(&record1, global_nvs["tune_s1"].data(), sizeof(record1));
    std::strcpy(record1.params.command_id, "z4444444-1234-1234-1234-123456789010");
    record1.crc32 = calculateRecordCrcForTest(record1);
    global_nvs["tune_s1"] = std::string(reinterpret_cast<const char*>(&record1), sizeof(record1));

    DynamicTuningParams loaded = active_before;
    assert(nvs_storage.loadTuningParams(loaded) == false);
    assert(std::memcmp(&loaded, &active_before, sizeof(loaded)) == 0);
    assert(nvs_storage.isDuplicateInNvs("d4444444-1234-1234-1234-123456789010") == false);

    tuner.resetForTest();
    tuner.init();
    DynamicTuningParams fallback = tuner.getActiveParams();
    assert(std::memcmp(&fallback, &active_before, sizeof(fallback)) == 0);
}

static void arrangeL4CorruptSlotsWithValidReceipt(storage::TuningStorageImpl& nvs_storage) {
    auto& global_nvs = Preferences::_global_storage["mushroom_cfg"];
    global_nvs.clear();

    // Populate a valid durable receipt in tune_rcpt while both config slots are unusable.
    assert(nvs_storage.saveDurableReceipt("d4444444-1234-1234-1234-123456789099"));

    global_nvs["tune_s0"] = std::string("\xA5\x00garbage", 9);
    storage::TuningNvsRecord crc_invalid{};
    crc_invalid.version = 2;
    crc_invalid.commit_state = 2;
    crc_invalid.generation = 99;
    std::strncpy(crc_invalid.params.command_id, "d4444444-1234-1234-1234-123456789099",
                 sizeof(crc_invalid.params.command_id) - 1);
    crc_invalid.params.revision = 99;
    crc_invalid.params.lamp_gain_scale = 1.2f;
    crc_invalid.params.mist_gain_scale = 0.8f;
    crc_invalid.params.mist_on_threshold = 0.35f;
    crc_invalid.params.mist_off_threshold = 0.20f;
    crc_invalid.crc32 = calculateRecordCrcForTest(crc_invalid) ^ 0xFFFFFFFFU;
    global_nvs["tune_s1"] = std::string(reinterpret_cast<const char*>(&crc_invalid), sizeof(crc_invalid));
}

static void testL4NoTrustworthySlotRecovery(storage::TuningStorageImpl& nvs_storage,
                                             storage::TuningConfigManager& tuner) {
    arrangeL4CorruptSlotsWithValidReceipt(nvs_storage);
    const size_t writes_before = Preferences::mock_put_bytes_count;

    tuner.resetForTest();
    std::ostringstream boot_log;
    std::streambuf* const previous_output = std::cout.rdbuf(boot_log.rdbuf());
    const bool first_boot_hydrated = tuner.hydrateFromNvs();
    std::cout.rdbuf(previous_output);

    assert(!first_boot_hydrated);
    const DynamicTuningParams fallback = tuner.getActiveParams();
    assert(fallback.revision == 0);
    assert(fallback.command_id[0] == '\0');
    assert(std::abs(fallback.lamp_gain_scale - 1.0f) < 0.0001f);

    const std::string warning_log = boot_log.str();
    assert(warning_log.find("WARNING") != std::string::npos);
    assert(warning_log.find("using safe defaults") != std::string::npos);
    assert(Preferences::mock_put_bytes_count == writes_before);

    // Split-brain guard: replaying the receipt UUID must NOT return a false
    // DUPLICATE now that no committed slot backs it; it is accepted afresh.
    const char* replay_cmd = "{\"schema_version\":1,\"command_id\":\"d4444444-1234-1234-1234-123456789099\",\"device_id\":\"mushroom_s3_unittest\",\"revision\":1,\"config\":{\"lamp_gain_scale\":1.08,\"mist_gain_scale\":1.05,\"mist_on_threshold\":0.29,\"mist_off_threshold\":0.16}}";
    ArduinoJson::StaticJsonDocument<512> doc_replay;
    ArduinoJson::deserializeJson(doc_replay, replay_cmd);
    storage::TuningReason reason = storage::TuningReason::OK;
    storage::TuningResult result = tuner.processCommand(doc_replay.as<ArduinoJson::JsonVariant>(), reason);
    assert(result == storage::TuningResult::ACCEPTED);
    assert(reason == storage::TuningReason::OK);
}

void run_all_tests() {
    std::cout << "[TEST SUITE] Starting Tuning Storage & NVS Two-Slot Invariant Unit Tests..." << std::endl;
    storage::TuningStorageImpl nvs_storage;
    auto& tuner = storage::TuningConfigManager::getInstance();
    tuner.setStorage(&nvs_storage);

    testTwoSlotPersistence(tuner);
    testCorruptedEnvelopeFallback(nvs_storage, tuner);
    testL4NoTrustworthySlotRecovery(nvs_storage, tuner);

    std::cout << "[TEST SUITE] Tuning Storage & NVS Two-Slot Invariant Passed!" << std::endl;
}

} // namespace test_storage
