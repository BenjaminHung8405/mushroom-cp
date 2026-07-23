#pragma once

#include "core/tuning_storage_interface.h"
#include <Preferences.h>

namespace storage {

struct TuningNvsRecord {
    uint32_t version;             ///< Schema version (e.g. 1)
    uint8_t commit_state;         ///< PENDING records are never adopted during boot
    uint8_t reserved[3];          ///< Reserved for natural alignment and future envelope fields
    uint32_t generation;          ///< Monotonic generation counter to track latest valid write
    DynamicTuningParams params;   ///< The nested tuning parameters
    uint32_t crc32;               ///< CRC32 of the envelope (computed over all fields except crc32 itself)
} __attribute__((aligned(4)));

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

class TuningStorageImpl : public ITuningStorage {
public:
    TuningStorageImpl() = default;
    ~TuningStorageImpl() override = default;

    bool loadTuningParams(DynamicTuningParams& out_params) override;
    bool saveTuningParams(const DynamicTuningParams& params) override;
    bool saveDurableReceipt(const char* command_id) override;
    bool loadDurableReceipt(char* out_command_id, size_t max_len) override;
    bool isDuplicateInNvs(const char* command_id) override;

private:
    static constexpr uint32_t TUNING_NVS_VERSION = 2;
    static constexpr uint8_t TUNING_NVS_PENDING_COMMIT = 1;
    static constexpr uint8_t TUNING_NVS_READY_DISPATCH = 2;
    static constexpr const char* TUNING_RECEIPT_KEY = "tune_rcpt";

    static uint32_t calculateRecordCrc(const TuningNvsRecord& record);
    static uint32_t calculateCRC32(const uint8_t* data, size_t length);
    static bool isValidRecord(const TuningNvsRecord& record);
    static void readNvsSlots(Preferences& prefs, NvsSlots& slots);
    static int newestCommittedSlot(const NvsSlots& slots);
    static int selectWriteSlot(const NvsSlots& slots, const DynamicTuningParams& params, uint8_t commit_state);
    static bool samePersistedParams(const DynamicTuningParams& lhs, const DynamicTuningParams& rhs);
    static uint32_t generationForWrite(const NvsSlots& slots, int slot, uint8_t commit_state);
    static TuningNvsRecord makeRecord(const DynamicTuningParams& params, uint8_t commit_state, uint32_t generation);
    static bool verifyReadback(Preferences& prefs, const char* key, const TuningNvsRecord& expected);
    bool writeRecord(const DynamicTuningParams& params, uint8_t commit_state);
};

} // namespace storage
