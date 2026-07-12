#pragma once

/**
 * @file CryptoUtils.h
 * @brief Base64 encoding utility using the native mbedTLS API on ESP-IDF.
 *
 * Part of fuzzy-logic-core-1 (Sprint 2 - Data Protocol). Encoder buffers are
 * caller-local stack storage; only the returned Arduino String may allocate.
 */

#include <Arduino.h>
#include <stddef.h>
#include <stdint.h>

namespace CryptoUtils {

/** Maximum raw payload accepted by the fixed-size telemetry encoder. */
constexpr size_t kMaxBase64InputBytes = 512U;

/** Maximum Base64 payload length for @ref kMaxBase64InputBytes, excluding NUL. */
constexpr size_t kMaxBase64OutputBytes =
    ((kMaxBase64InputBytes + 2U) / 3U) * 4U;

/**
 * @brief Encodes raw bytes as standard Base64 with mbedtls_base64_encode().
 *
 * The payload is limited to @ref kMaxBase64InputBytes so the fixed output
 * buffer remains on the stack. Empty input is valid and encodes to an empty
 * string. Invalid pointers, oversized input, or an mbedTLS failure return an
 * empty String.
 *
 * @param data Raw bytes to encode; may be nullptr only when len is zero.
 * @param len Number of input bytes.
 * @return Standard Base64 output, or an empty String on failure.
 */
String encodeBase64String(const uint8_t* data, size_t len);

/**
 * @brief Encodes a null-terminated C string as Base64.
 *
 * @param data UTF-8 or arbitrary byte text terminated by NUL.
 * @return Standard Base64 output, or an empty String on invalid/oversized input.
 */
String encodeBase64String(const char* data);

/**
 * @brief Convenience overload for Arduino String input.
 */
String encodeBase64String(const String& data);

} // namespace CryptoUtils
