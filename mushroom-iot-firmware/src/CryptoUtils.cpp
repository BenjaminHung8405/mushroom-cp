#include "CryptoUtils.h"

#include <mbedtls/base64.h>

#include <cstring>

namespace CryptoUtils {

String encodeBase64String(const uint8_t* data, size_t len)
{
    if ((data == nullptr && len != 0U) || len > kMaxBase64InputBytes)
    {
        return String();
    }

    char encoded[kMaxBase64OutputBytes + 1U] = {};
    size_t encodedLength = 0U;
    const int result = mbedtls_base64_encode(
        reinterpret_cast<unsigned char*>(encoded),
        kMaxBase64OutputBytes,
        &encodedLength,
        data,
        len);

    if (result != 0 || encodedLength > kMaxBase64OutputBytes)
    {
        return String();
    }

    encoded[encodedLength] = '\0';
    return String(encoded);
}

String encodeBase64String(const char* data)
{
    if (data == nullptr)
    {
        return String();
    }

    return encodeBase64String(
        reinterpret_cast<const uint8_t*>(data),
        std::strlen(data));
}

String encodeBase64String(const String& data)
{
    return encodeBase64String(data.c_str());
}

} // namespace CryptoUtils
