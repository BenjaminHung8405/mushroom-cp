from pathlib import Path

# Import đối tượng env từ môi trường SCons của PlatformIO
Import("env")

# env.subst("$PROJECT_DIR") sẽ trả về đường dẫn tuyệt đối của thư mục 'mushroom-iot-firmware'
project_dir = Path(env.subst("$PROJECT_DIR"))
root_env_file = project_dir.parent / ".env"

if not root_env_file.is_file():
    raise RuntimeError(f"Missing shared environment file: {root_env_file}")

values = {}
for raw_line in root_env_file.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    key, separator, value = line.partition("=")
    if separator:
        values[key.strip()] = value.strip().strip('"').strip("'")

api_url = values.get("NEXT_PUBLIC_API_URL")
mqtt_broker = values.get("MQTT_BROKER_URL")
mqtt_port = values.get("MQTT_PORT")

if not api_url:
    raise RuntimeError("NEXT_PUBLIC_API_URL must be set in the shared .env file")

if not api_url.startswith(("http://", "https://")):
    raise RuntimeError("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL for firmware")

if not mqtt_broker:
    raise RuntimeError("MQTT_BROKER_URL must be set in the shared .env file")

if "://" in mqtt_broker or "/" in mqtt_broker:
    raise RuntimeError("MQTT_BROKER_URL must be a hostname or IP address without a scheme or path")

if not mqtt_port or not mqtt_port.isdigit() or not 1 <= int(mqtt_port) <= 65535:
    raise RuntimeError("MQTT_PORT must be an integer between 1 and 65535")

# PlatformIO passes this escaped value to the C++ preprocessor as a string literal.
env.Append(CPPDEFINES=[
    ("DEFAULT_BACKEND_API_URL", '\\"{}\\"'.format(api_url.rstrip("/"))),
    ("DEFAULT_MQTT_BROKER_URL", '\\"{}\\"'.format(mqtt_broker)),
    ("DEFAULT_MQTT_PORT_VALUE", mqtt_port),
])
