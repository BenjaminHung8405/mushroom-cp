#include "storage/tuning_storage.h"
#include <cstring>
#include "config.h"

namespace storage {

uint32_t TuningStorageImpl::calculateRecordCrc(const TuningNvsRecord& record) {
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

uint32_t TuningStorageImpl::calculateCRC32(const uint8_t* data, size_t length) {
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

bool TuningStorageImpl::isValidRecord(const TuningNvsRecord& record) {
    return record.version == TUNING_NVS_VERSION &&
           (record.commit_state == TUNING_NVS_PENDING_COMMIT ||
            record.commit_state == TUNING_NVS_READY_DISPATCH) &&
           std::memchr(record.params.command_id, '\0', sizeof(record.params.command_id)) != nullptr &&
           calculateRecordCrc(record) == record.crc32;
}

void TuningStorageImpl::readNvsSlots(Preferences& prefs, NvsSlots& slots) {
    std::memset(&slots, 0, sizeof(slots));
    const char* const keys[] = {"tune_s0", "tune_s1"};
    for (uint8_t slot = 0; slot < 2; ++slot) {
        const size_t bytes = prefs.getBytes(keys[slot], &slots.records[slot], sizeof(TuningNvsRecord));
        slots.valid[slot] = bytes == sizeof(TuningNvsRecord) && isValidRecord(slots.records[slot]);
    }
}

int TuningStorageImpl::newestCommittedSlot(const NvsSlots& slots) {
    const bool committed0 = slots.valid[0] && slots.records[0].commit_state == TUNING_NVS_READY_DISPATCH;
    const bool committed1 = slots.valid[1] && slots.records[1].commit_state == TUNING_NVS_READY_DISPATCH;
    if (committed0 && committed1)
        return slots.records[0].generation >= slots.records[1].generation ? 0 : 1;
    return committed0 ? 0 : committed1 ? 1 : -1;
}

bool TuningStorageImpl::samePersistedParams(const DynamicTuningParams& lhs, const DynamicTuningParams& rhs) {
    return std::strcmp(lhs.command_id, rhs.command_id) == 0 &&
           lhs.revision == rhs.revision &&
           lhs.lamp_gain_scale == rhs.lamp_gain_scale &&
           lhs.mist_gain_scale == rhs.mist_gain_scale &&
           lhs.mist_on_threshold == rhs.mist_on_threshold &&
           lhs.mist_off_threshold == rhs.mist_off_threshold;
}

int TuningStorageImpl::selectWriteSlot(const NvsSlots& slots, const DynamicTuningParams& params, uint8_t commit_state) {
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

uint32_t TuningStorageImpl::generationForWrite(const NvsSlots& slots, int slot, uint8_t commit_state) {
    if (commit_state == TUNING_NVS_READY_DISPATCH && slots.valid[slot] &&
        slots.records[slot].commit_state == TUNING_NVS_PENDING_COMMIT) {
        return slots.records[slot].generation;
    }
    const uint32_t gen0 = slots.valid[0] ? slots.records[0].generation : 0;
    const uint32_t gen1 = slots.valid[1] ? slots.records[1].generation : 0;
    return (gen0 > gen1 ? gen0 : gen1) + 1;
}

TuningNvsRecord TuningStorageImpl::makeRecord(const DynamicTuningParams& params, uint8_t commit_state, uint32_t generation) {
    TuningNvsRecord record{};
    record.version = TUNING_NVS_VERSION;
    record.commit_state = commit_state;
    record.generation = generation;
    record.params = params;
    record.crc32 = calculateRecordCrc(record);
    return record;
}

bool TuningStorageImpl::verifyReadback(Preferences& prefs, const char* key, const TuningNvsRecord& expected) {
    TuningNvsRecord readback{};
    if (prefs.getBytes(key, &readback, sizeof(TuningNvsRecord)) != sizeof(TuningNvsRecord)) {
        return false;
    }
    if (!isValidRecord(readback)) {
        return false;
    }
    return std::memcmp(&readback, &expected, sizeof(TuningNvsRecord)) == 0;
}

bool TuningStorageImpl::writeRecord(const DynamicTuningParams& params, uint8_t commit_state) {
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) {
        return false;
    }

    NvsSlots slots{};
    readNvsSlots(prefs, slots);

    const int slot = selectWriteSlot(slots, params, commit_state);
    if (slot < 0) {
        prefs.end();
        return false;
    }

    const TuningNvsRecord record = makeRecord(
        params, commit_state, generationForWrite(slots, slot, commit_state));
    const char* key = slot == 0 ? "tune_s0" : "tune_s1";

    if (prefs.putBytes(key, &record, sizeof(TuningNvsRecord)) != sizeof(TuningNvsRecord)) {
        prefs.end();
        return false;
    }

    const bool verified = verifyReadback(prefs, key, record);
    prefs.end();
    return verified;
}

bool TuningStorageImpl::loadTuningParams(DynamicTuningParams& out_params) {
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

bool TuningStorageImpl::saveTuningParams(const DynamicTuningParams& params) {
    if (!writeRecord(params, TUNING_NVS_PENDING_COMMIT)) {
        return false;
    }
    return writeRecord(params, TUNING_NVS_READY_DISPATCH);
}

bool TuningStorageImpl::saveDurableReceipt(const char* command_id) {
    if (command_id == nullptr || command_id[0] == '\0') return false;
    TuningReceiptRecord rec{};
    rec.version = TUNING_NVS_VERSION;
    std::strncpy(rec.command_id, command_id, sizeof(rec.command_id) - 1);
    rec.command_id[sizeof(rec.command_id) - 1] = '\0';
    rec.crc32 = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&rec),
        offsetof(TuningReceiptRecord, crc32));

    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, false)) return false;
    const size_t written = prefs.putBytes(TUNING_RECEIPT_KEY, &rec, sizeof(rec));
    if (written != sizeof(rec)) {
        prefs.end();
        return false;
    }

    TuningReceiptRecord read_rec{};
    const size_t read_bytes = prefs.getBytes(TUNING_RECEIPT_KEY, &read_rec, sizeof(read_rec));
    prefs.end();

    if (read_bytes != sizeof(rec)) return false;
    if (read_rec.version != TUNING_NVS_VERSION) return false;

    const uint32_t expected_crc = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&read_rec),
        offsetof(TuningReceiptRecord, crc32));
    if (read_rec.crc32 != expected_crc) return false;
    if (std::memchr(read_rec.command_id, '\0', sizeof(read_rec.command_id)) == nullptr) return false;
    if (std::memcmp(read_rec.command_id, rec.command_id, sizeof(read_rec.command_id)) != 0) return false;

    return true;
}

static bool validateCommandIdFormat(const char* uuid_str) {
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

bool TuningStorageImpl::loadDurableReceipt(char* out_command_id, size_t max_len) {
    if (out_command_id == nullptr || max_len < 37) return false;
    Preferences prefs;
    if (!prefs.begin(config::network::NVS_NAMESPACE, true)) return false;
    TuningReceiptRecord rec{};
    const size_t bytes = prefs.getBytes(TUNING_RECEIPT_KEY, &rec, sizeof(rec));
    prefs.end();
    if (bytes != sizeof(rec)) return false;
    if (rec.version != TUNING_NVS_VERSION) return false;

    const uint32_t expected_crc = calculateCRC32(
        reinterpret_cast<const uint8_t*>(&rec),
        offsetof(TuningReceiptRecord, crc32));
    if (rec.crc32 != expected_crc) return false;
    if (std::memchr(rec.command_id, '\0', sizeof(rec.command_id)) == nullptr) return false;
    if (!validateCommandIdFormat(rec.command_id)) return false;

    std::strncpy(out_command_id, rec.command_id, max_len - 1);
    out_command_id[max_len - 1] = '\0';
    return true;
}

bool TuningStorageImpl::isDuplicateInNvs(const char* command_id) {
    if (command_id == nullptr) return false;
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

} // namespace storage
