#pragma once

#include "models.h"

namespace storage {

class CropProfileValidator {
public:
    static bool validate(const PersistedCropProfile &profile);
};

} // namespace storage
