#!/usr/bin/env bash
set -euo pipefail

release_directory="${ROUGHCUT_RELEASE_DIRECTORY:-release}"
installers=("$release_directory"/Roughcut-*-mac-arm64.dmg)
if [[ ${#installers[@]} -ne 1 || ! -f "${installers[0]}" ]]; then
  echo "Expected exactly one Apple Silicon DMG installer." >&2
  exit 1
fi

work_directory="$(mktemp -d "${TMPDIR:-/tmp}/roughcut-macos-smoke.XXXXXX")"
mount_point="$work_directory/mount"
smoke_result="$work_directory/result.json"
profile_directory="$work_directory/profile"
mkdir -p "$mount_point"

cleanup() {
  hdiutil detach "$mount_point" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach -nobrowse -readonly -mountpoint "$mount_point" "${installers[0]}" >/dev/null
app_path="$mount_point/Roughcut.app"
executable="$app_path/Contents/MacOS/Roughcut"

codesign --verify --deep --strict --verbose=4 "$app_path"
file "$executable" | grep -q "Mach-O 64-bit executable arm64"

ROUGHCUT_TRANSCRIBER_PORT=54319 \
ROUGHCUT_DESKTOP_SMOKE_TEST_PATH="$smoke_result" \
  "$executable" --user-data-dir="$profile_directory"

SMOKE_RESULT="$smoke_result" node -e '
  const result = JSON.parse(require("node:fs").readFileSync(process.env.SMOKE_RESULT, "utf8"));
  if (!result.packaged || result.platform !== "darwin" || result.arch !== "arm64" || !result.mediaServiceReady) {
    throw new Error(`Unexpected macOS smoke result: ${JSON.stringify(result)}`);
  }
'

echo "Verified DMG: ${installers[0]}"
echo "Verified complete bundle signature, arm64 startup, and local media service."
