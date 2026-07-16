#pragma once

#include "core/models.h"

namespace storage {

class CropProfileValidator {
public:
    static bool validate(const PersistedCropProfile &profile);
};

} // namespace storage
