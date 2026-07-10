#pragma once

#include <iostream>
#include <string>
#include <sstream>
#include <cstdint>

class String : public std::string {
public:
    String() : std::string() {}
    String(const char* str) : std::string(str ? str : "") {}
    String(const std::string& str) : std::string(str) {}
    String(int val) : std::string(std::to_string(val)) {}
    
    const char* c_str() const { return std::string::c_str(); }
    size_t length() const { return std::string::length(); }
};

class HardwareSerial {
public:
    void print(const String& s) { std::cout << s; }
    void print(const char* s) { std::cout << s; }
    void print(int n) { std::cout << n; }
    
    void println(const String& s) { std::cout << s << std::endl; }
    void println(const char* s) { std::cout << s << std::endl; }
    void println(int n) { std::cout << n << std::endl; }
    
    template<typename... Args>
    void printf(const char* format, Args... args) {
        std::printf(format, args...);
    }
};

extern HardwareSerial Serial;
