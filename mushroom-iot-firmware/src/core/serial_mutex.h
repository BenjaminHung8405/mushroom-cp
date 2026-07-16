#pragma once

#ifndef UNIT_TEST
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <Arduino.h>
#else
#include "Arduino.h"
#endif

/**
 * @brief Create the FreeRTOS mutex that guards Serial I/O.
 * Must be called once from setup() BEFORE any FreeRTOS task is started.
 * @return true if the mutex was created successfully (or already exists).
 */
bool init_serial_mutex();

/**
 * @brief Singleton wrapper around a FreeRTOS Mutex that protects all Serial I/O.
 *
 * Both Core 0 and Core 1 call this before any Serial.print/printf/println.
 * On the ESP32 the UART peripheral is shared, so concurrent writes from two
 * cores can interleave bytes and produce garbled output.
 */
class SerialLock {
public:
    static SerialLock& get_instance() {
        static SerialLock instance;
        return instance;
    }

    /**
     * @brief Acquire the Serial mutex. Call BEFORE any Serial I/O.
     * Non-blocking null-check: if mutex was never created (pre-setup), skip.
     */
    void lock() {
        #ifndef UNIT_TEST
        if (xSerialMutex != nullptr) {
            xSemaphoreTake(xSerialMutex, portMAX_DELAY);
        }
        #else
        // Track lock depth for unit tests
        ++lock_count_;
        #endif
    }

    /**
     * @brief Release the Serial mutex. Call AFTER Serial I/O is complete.
     */
    void unlock() {
        #ifndef UNIT_TEST
        if (xSerialMutex != nullptr) {
            xSemaphoreGive(xSerialMutex);
        }
        #else
        if (lock_count_ > 0) --lock_count_;
        #endif
    }

    #ifdef UNIT_TEST
    /** @brief Unit-test helper: current lock depth (0 = unlocked). */
    int lock_count() const { return lock_count_; }
    #endif

    // Allow init_serial_mutex() to set the static mutex handle.
    friend bool init_serial_mutex();

private:
    SerialLock() = default;

    #ifndef UNIT_TEST
    static SemaphoreHandle_t xSerialMutex;
    #else
    int lock_count_ = 0;
    #endif
};

/**
 * @brief RAII guard — acquires SerialLock on construction, releases on destruction.
 * Ensures unlock even if an exception or early return occurs.
 *
 * Usage:
 *   {
 *       ScopedSerialLock guard(SerialLock::get_instance());
 *       Serial.println("safe print");
 *   } // auto unlock
 */
class ScopedSerialLock {
public:
    explicit ScopedSerialLock(SerialLock& lock) : lock_(lock) { lock_.lock(); }
    ~ScopedSerialLock() { lock_.unlock(); }
    ScopedSerialLock(const ScopedSerialLock&) = delete;
    ScopedSerialLock& operator=(const ScopedSerialLock&) = delete;

private:
    SerialLock& lock_;
};
