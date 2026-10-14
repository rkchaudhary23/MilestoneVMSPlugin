#!/bin/sh
# Writes assets/config.json from environment variables at container start (spec §10.2).
# Variables left unset keep the defaults baked into the image. When the root filesystem is
# read-only, mount config.json from a ConfigMap instead and leave these unset.
set -eu

CONFIG=/usr/share/nginx/html/vms/milestone/assets/config.json

if [ -z "${A360_BACKEND_BASE_URL+x}${A360_TOKEN_ENDPOINT+x}${A360_ORIGIN+x}" ]; then
  exit 0
fi

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

case "${A360_TOKEN_ENDPOINT:-GetToken}" in
  GetToken|GetTokenjwt) ;;
  *) echo "40-runtime-config: A360_TOKEN_ENDPOINT must be GetToken or GetTokenjwt" >&2; exit 1 ;;
esac

cat > "$CONFIG" <<JSON
{
  "backendBaseUrl": "$(json_escape "${A360_BACKEND_BASE_URL:-}")",
  "tokenEndpoint": "$(json_escape "${A360_TOKEN_ENDPOINT:-GetToken}")",
  "tokenCacheMinutes": 10,
  "access360Origin": "$(json_escape "${A360_ORIGIN:-}")",
  "handshakeTimeoutMs": 1500,
  "decodeDataQueryParam": "$(json_escape "${A360_DECODE_DATA_PARAM:-data}")",
  "sdkScriptPath": "assets/xpmobilesdk/XPMobileSDK.js",
  "firstFrameTimeoutMs": 10000
}
JSON
echo "40-runtime-config: wrote $CONFIG"
