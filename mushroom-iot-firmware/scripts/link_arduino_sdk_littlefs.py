import os

Import("env")

sdk_root = os.path.expanduser(
    "~/.platformio/packages/"
    "framework-arduinoespressif32-3.20014.231204/tools/sdk/esp32s3"
)
sdk_include_dir = os.path.join(sdk_root, "include/esp_littlefs/include")
sdk_archive = os.path.join(sdk_root, "lib/libesp_littlefs.a")

env.Prepend(CPPPATH=[sdk_include_dir])
# This PlatformIO hybrid Arduino/ESP-IDF link command places LINKFLAGS before
# static libraries. Append the archive directly to LINKCOM so it is scanned
# after Arduino's LittleFS wrapper has introduced its unresolved symbols.
env["LINKCOM"] += " " + sdk_archive
