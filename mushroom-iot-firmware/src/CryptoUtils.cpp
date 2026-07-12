#include "CryptoUtils.h"

#ifndef UNIT_TEST
#include <mbedtls/base64.h>
#else
#include <string>
#endif

#include <cstring>

namespace CryptoUtils {

#ifdef UNIT_TEST
static const char base64_chars[] = 
             "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "abcdefghijklmnopqrstuvwxyz"
             "0123456789+/";

String mock_base64_encode(const uint8_t* bytes_to_encode, size_t in_len) {
    std::string ret;
    int i = 0;
    int j = 0;
    uint8_t char_array_3[3];
    uint8_t char_array_4[4];

    while (in_len--) {
        char_array_3[i++] = *(bytes_to_encode++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for(i = 0; (i < 4) ; i++)
                ret += base64_chars[char_array_4[i]];
            i = 0;
        }
    }

    if (i) {
        for(j = i; j < 3; j++)
            char_array_3[j] = '\0';

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);

        for (j = 0; (j < i + 1); j++)
            ret += base64_chars[char_array_4[j]];

        while((i++ < 3))
            ret += '=';
    }

    return String(ret.c_str());
}
#endif

String encodeBase64String(const uint8_t* data, size_t len)
{
    if ((data == nullptr && len != 0U) || len > kMaxBase64InputBytes)
    {
        return String();
    }

#ifdef UNIT_TEST
    return mock_base64_encode(data, len);
#else
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
#endif
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
