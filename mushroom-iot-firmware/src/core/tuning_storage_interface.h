#pragma once

#include <cstddef>
#include "core/models.h"

namespace storage {

class ITuningStorage {
public:
    virtual ~ITuningStorage() = default;
    virtual bool loadTuningParams(DynamicTuningParams& out_params) = 0;
    virtual bool saveTuningParams(const DynamicTuningParams& params) = 0;
    virtual bool saveDurableReceipt(const char* command_id) = 0;
    virtual bool loadDurableReceipt(char* out_command_id, size_t max_len) = 0;
    virtual bool isDuplicateInNvs(const char* command_id) = 0;
};

} // namespace storage
