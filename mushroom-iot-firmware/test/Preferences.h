#pragma once

#include "Arduino.h"
#include <map>
#include <string>
#include <cstring>

class Preferences {
public:
    static std::map<std::string, std::map<std::string, std::string>> _global_storage;
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

    size_t putBytes(const char* key, const void* value, size_t len) {
        if (!_opened || _read_only) return 0;
        _global_storage[_current_namespace][key] = std::string(static_cast<const char*>(value), len);
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
