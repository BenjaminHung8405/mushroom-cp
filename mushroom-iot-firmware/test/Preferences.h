#pragma once

#include "Arduino.h"
#include <map>
#include <string>
#include <cstring>

class Preferences {
public:
    static std::map<std::string, std::map<std::string, std::string>> _global_storage;
    static bool mock_fail_put_bytes;
    static size_t mock_fail_put_bytes_after;
    static size_t mock_put_bytes_count;
    static void (*mock_put_bytes_hook)(const char* key, const void* value, size_t len);
    std::string _current_namespace;
    bool _read_only;
    bool _opened = false;

    bool begin(const char* name, bool readOnly = false) {
        _current_namespace = name;
        _read_only = readOnly;
        _opened = true;
        return true;
    }

    void end() {
        _opened = false;
    }

    size_t putString(const char* key, const String& value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::string(value.c_str());
        return value.length();
    }

    String getString(const char* key, const String& defaultValue = String()) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                return String(key_it->second.c_str());
            }
        }
        return defaultValue;
    }

    size_t putUShort(const char* key, uint16_t value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::to_string(value);
        return sizeof(value);
    }

    uint16_t getUShort(const char* key, uint16_t defaultValue = 0) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                return static_cast<uint16_t>(std::stoi(key_it->second));
            }
        }
        return defaultValue;
    }

    size_t putUInt(const char* key, uint32_t value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::to_string(value);
        return sizeof(value);
    }

    uint32_t getUInt(const char* key, uint32_t defaultValue = 0) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                return static_cast<uint32_t>(std::stoul(key_it->second));
            }
        }
        return defaultValue;
    }

    size_t putBytes(const char* key, const void* value, size_t len) {
        if (!_opened || _read_only || mock_fail_put_bytes ||
            (mock_fail_put_bytes_after > 0 &&
             mock_put_bytes_count >= mock_fail_put_bytes_after)) return 0;
        ++mock_put_bytes_count;
        _global_storage[_current_namespace][key] = std::string(static_cast<const char*>(value), len);
        if (mock_put_bytes_hook != nullptr) {
            mock_put_bytes_hook(key, value, len);
        }
        return len;
    }

    size_t getBytes(const char* key, void* buf, size_t len) {
        if (!_opened) return 0;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                const std::string& stored = key_it->second;
                size_t to_copy = (stored.size() < len) ? stored.size() : len;
                memcpy(buf, stored.data(), to_copy);
                return to_copy;
            }
        }
        return 0;
    }

    size_t putBool(const char* key, bool value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = value ? "1" : "0";
        return 1;
    }

    bool getBool(const char* key, bool defaultValue = false) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                return key_it->second == "1";
            }
        }
        return defaultValue;
    }

    size_t putFloat(const char* key, float value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::to_string(value);
        return sizeof(value);
    }

    float getFloat(const char* key, float defaultValue = 0.0f) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                try { return std::stof(key_it->second); } catch (...) {}
            }
        }
        return defaultValue;
    }

    size_t putUChar(const char* key, uint8_t value) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::to_string(value);
        return sizeof(value);
    }

    uint8_t getUChar(const char* key, uint8_t defaultValue = 0) {
        if (!_opened) return defaultValue;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            auto key_it = ns_it->second.find(key);
            if (key_it != ns_it->second.end()) {
                try { return static_cast<uint8_t>(std::stoul(key_it->second)); } catch (...) {}
            }
        }
        return defaultValue;
    }

    bool remove(const char* key) {
        if (!_opened || _read_only) return false;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            return ns_it->second.erase(key) > 0;
        }
        return false;
    }

    bool isKey(const char* key) {
        if (!_opened) return false;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            return ns_it->second.find(key) != ns_it->second.end();
        }
        return false;
    }

    bool clear() {
        if (!_opened || _read_only) return false;
        auto ns_it = _global_storage.find(_current_namespace);
        if (ns_it != _global_storage.end()) {
            ns_it->second.clear();
            return true;
        }
        return false;
    }
};
