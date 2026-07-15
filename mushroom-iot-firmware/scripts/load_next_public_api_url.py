from pathlib import Path

# Import đối tượng env từ môi trường SCons của PlatformIO
Import("env")

# env.subst("$PROJECT_DIR") sẽ trả về đường dẫn tuyệt đối của thư mục 'mushroom-iot-firmware'
project_dir = Path(env.subst("$PROJECT_DIR"))
root_env_file = project_dir.parent / ".env"

if not root_env_file.is_file():
    raise RuntimeError(f"Missing shared environment file: {root_env_file}")

api_url = None
for raw_line in root_env_file.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    key, separator, value = line.partition("=")
    if separator and key.strip() == "NEXT_PUBLIC_API_URL":
        api_url = value.strip().strip('"').strip("'")
        break

if not api_url:
    raise RuntimeError("NEXT_PUBLIC_API_URL must be set in the shared .env file")

if not api_url.startswith(("http://", "https://")):
    raise RuntimeError("NEXT_PUBLIC_API_URL must be an absolute HTTP(S) URL for firmware")

# PlatformIO passes this escaped value to the C++ preprocessor as a string literal.
env.Append(CPPDEFINES=[("DEFAULT_BACKEND_API_URL", '\\"{}\\"'.format(api_url.rstrip("/")))])
