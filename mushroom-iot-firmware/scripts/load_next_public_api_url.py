from pathlib import Path

Import("env")

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

mqtt_broker = values.get("MQTT_BROKER_URL")
mqtt_port = values.get("MQTT_PORT")
wifi_ssid = values.get("WIFI_SSID", "")
wifi_password = values.get("WIFI_PASSWORD", "")
tenant = values.get("IOT_TENANT", "mushroom")
bootstrap_user = values.get("MQTT_BOOTSTRAP_USER", "provision_node")
bootstrap_secret = values.get("MQTT_BOOTSTRAP_SECRET")

if not mqtt_broker:
    raise RuntimeError("MQTT_BROKER_URL must be set in the shared .env file")
if "://" in mqtt_broker or "/" in mqtt_broker:
    raise RuntimeError("MQTT_BROKER_URL must be a hostname or IP address without a scheme or path")
if not mqtt_port or not mqtt_port.isdigit() or not 1 <= int(mqtt_port) <= 65535:
    raise RuntimeError("MQTT_PORT must be an integer between 1 and 65535")
if not tenant or "/" in tenant or "+" in tenant or "#" in tenant:
    raise RuntimeError("IOT_TENANT must be a non-empty MQTT topic segment")
if not bootstrap_user or "/" in bootstrap_user or "+" in bootstrap_user or "#" in bootstrap_user:
    raise RuntimeError("MQTT_BOOTSTRAP_USER must be a non-empty MQTT username")
if not bootstrap_secret:
    raise RuntimeError("MQTT_BOOTSTRAP_SECRET must be set in the shared .env file")

for value_name, value in {
    "MQTT_BROKER_URL": mqtt_broker,
    "WIFI_SSID": wifi_ssid,
    "WIFI_PASSWORD": wifi_password,
    "MQTT_BOOTSTRAP_USER": bootstrap_user,
    "MQTT_BOOTSTRAP_SECRET": bootstrap_secret,
}.items():
    if '\"' in value or "\\" in value:
        raise RuntimeError(f"{value_name} must not contain quotes or backslashes")

env.Append(CPPDEFINES=[
    ("DEFAULT_MQTT_BROKER_URL", '\\"{}\\"'.format(mqtt_broker)),
    ("DEFAULT_MQTT_PORT_VALUE", mqtt_port),
    ("DEFAULT_WIFI_SSID", '\\"{}\\"'.format(wifi_ssid)),
    ("DEFAULT_WIFI_PASSWORD", '\\"{}\\"'.format(wifi_password)),
    ("IOT_TENANT", '\\"{}\\"'.format(tenant)),
    ("BOOTSTRAP_USERNAME", '\\"{}\\"'.format(bootstrap_user)),
    ("BOOTSTRAP_PASSWORD", '\\"{}\\"'.format(bootstrap_secret)),
])
