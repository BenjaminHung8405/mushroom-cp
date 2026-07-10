#include "serial_mutex.h"

#ifndef UNIT_TEST
// FreeRTOS mutex handle — created once in setup() via init_serial_mutex().
// Declared private static in SerialLock; friend init_serial_mutex() can set it.
SemaphoreHandle_t SerialLock::xSerialMutex = nullptr;
#endif

bool init_serial_mutex()
{
    #ifndef UNIT_TEST
    if (SerialLock::xSerialMutex != nullptr)
    {
        return true; // Already initialised
    }
    SerialLock::xSerialMutex = xSemaphoreCreateMutex();
    if (SerialLock::xSerialMutex == nullptr)
    {
        // Fall back to unprotected Serial so we can still log the error
        Serial.println("[SERIAL_MUTEX] FATAL: Failed to create Serial mutex!");
        return false;
    }
    Serial.println("[SERIAL_MUTEX] Serial mutex created successfully.");
    return true;
    #else
    // Host unit-test path: no FreeRTOS, always succeed
    Serial.println("[SERIAL_MUTEX] Serial mutex created successfully (UNIT_TEST stub).");
    return true;
    #endif
}
