#!/bin/sh
set -eu

case "${EASY_SMS_CONFIG_PATH:-}" in
  *C:*|*\\*) EASY_SMS_CONFIG_PATH="/etc/easy-sms/config.yaml" ;;
esac
case "${EASY_SMS_STATE_DIR:-}" in
  *C:*|*\\*) EASY_SMS_STATE_DIR="/var/lib/easy-sms" ;;
esac

CONFIG_PATH="${EASY_SMS_CONFIG_PATH:-/etc/easy-sms/config.yaml}"
STATE_DIR="${EASY_SMS_STATE_DIR:-/var/lib/easy-sms}"
RUNTIME_ENV_PATH="${EASY_SMS_RUNTIME_ENV_PATH:-/etc/easy-sms/runtime.env}"
BOOTSTRAP_PATH="${EASY_SMS_BOOTSTRAP_PATH:-/etc/easy-sms/bootstrap/r2-bootstrap.json}"
IMPORT_CODE="${EASY_SMS_IMPORT_CODE:-}"
IMPORT_STATE_PATH="${EASY_SMS_IMPORT_STATE_PATH:-${STATE_DIR}/import-sync-state.json}"
SYNC_FLAG_PATH="${EASY_SMS_IMPORT_SYNC_FLAG_PATH:-${STATE_DIR}/import-sync.restart}"
export EASY_SMS_CONFIG_PATH="$CONFIG_PATH"
export EASY_SMS_STATE_DIR="$STATE_DIR"
RESET_STORE_ON_BOOT="${EASY_SMS_RESET_STORE_ON_BOOT:-false}"
STATE_LAYOUT_DIR="${STATE_DIR}/state"
TEMPLATE_PATH="/opt/easy-sms/config.template.yaml"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[easy-sms] neither python3 nor python is available in the runtime image" >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_PATH")" "$(dirname "$RUNTIME_ENV_PATH")" "$STATE_DIR" "$STATE_LAYOUT_DIR"

if [ ! -f "$BOOTSTRAP_PATH" ] && [ -n "$IMPORT_CODE" ]; then
  mkdir -p "$(dirname "$BOOTSTRAP_PATH")"
  echo "[easy-sms] import code provided, generating bootstrap file at $BOOTSTRAP_PATH"
  "$PYTHON_BIN" /usr/local/bin/easysms-import-code.py inspect \
    --import-code "$IMPORT_CODE" \
    --output "$BOOTSTRAP_PATH"
fi

if [ ! -f "$CONFIG_PATH" ]; then
  if [ -f "$BOOTSTRAP_PATH" ]; then
    echo "[easy-sms] runtime config missing, attempting bootstrap via $BOOTSTRAP_PATH"
    "$PYTHON_BIN" /usr/local/bin/bootstrap-service-config.py \
      --bootstrap-path "$BOOTSTRAP_PATH" \
      --config-path "$CONFIG_PATH" \
      --runtime-env-path "$RUNTIME_ENV_PATH" \
      --state-path "$IMPORT_STATE_PATH"
  elif [ -f "$TEMPLATE_PATH" ]; then
    cp "$TEMPLATE_PATH" "$CONFIG_PATH"
  fi
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "[easy-sms] missing generated runtime config at $CONFIG_PATH" >&2
  echo "[easy-sms] provide a rendered config.yaml or mount $BOOTSTRAP_PATH so the container can pull it from R2" >&2
  exit 1
fi

case "$(echo "$RESET_STORE_ON_BOOT" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    echo "[easy-sms] EASY_SMS_RESET_STORE_ON_BOOT=true -> clearing $STATE_DIR"
    rm -rf "${STATE_DIR:?}"/*
    ;;
  *)
    ;;
esac

if [ -f "$RUNTIME_ENV_PATH" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$RUNTIME_ENV_PATH"
  set +a
fi

resolve_bootstrap_sync_setting() {
  "$PYTHON_BIN" - "$BOOTSTRAP_PATH" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
if not path.exists():
    print("false")
    print("7200")
    raise SystemExit(0)

payload = json.loads(path.read_text(encoding="utf-8-sig"))
print("true" if payload.get("syncEnabled", True) else "false")
print(int(payload.get("syncIntervalSeconds") or 7200))
PY
}

start_runtime() {
  if [ -f "$RUNTIME_ENV_PATH" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$RUNTIME_ENV_PATH"
    set +a
  fi

  if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
    chown -R easy:easy "$STATE_DIR" "$(dirname "$CONFIG_PATH")" /app
    gosu easy "$@" &
  else
    "$@" &
  fi

  APP_PID=$!
}

start_sync_loop() {
  SYNC_INTERVAL_SECONDS="$1"
  (
    while true; do
      sleep "$SYNC_INTERVAL_SECONDS"
      "$PYTHON_BIN" /usr/local/bin/bootstrap-service-config.py \
        --bootstrap-path "$BOOTSTRAP_PATH" \
        --config-path "$CONFIG_PATH" \
        --runtime-env-path "$RUNTIME_ENV_PATH" \
        --state-path "$IMPORT_STATE_PATH" \
        --mode sync \
        --updated-flag-path "$SYNC_FLAG_PATH"
      if [ -f "$SYNC_FLAG_PATH" ]; then
        echo "[easy-sms] remote runtime config updated, restarting service"
        kill "$APP_PID" 2>/dev/null || true
        break
      fi
    done
  ) &
  SYNC_PID=$!
}

SYNC_ENABLED="false"
SYNC_INTERVAL_SECONDS="7200"
if [ -f "$BOOTSTRAP_PATH" ]; then
  SYNC_VALUES="$(resolve_bootstrap_sync_setting)"
  SYNC_ENABLED="$(printf '%s' "$SYNC_VALUES" | sed -n '1p')"
  SYNC_INTERVAL_SECONDS="$(printf '%s' "$SYNC_VALUES" | sed -n '2p')"
fi

while true; do
  rm -f "$SYNC_FLAG_PATH"
  start_runtime "$@"
  if [ "$SYNC_ENABLED" = "true" ] && [ -f "$BOOTSTRAP_PATH" ]; then
    start_sync_loop "$SYNC_INTERVAL_SECONDS"
  else
    SYNC_PID=""
  fi

  APP_STATUS=0
  wait "$APP_PID" || APP_STATUS=$?

  if [ -n "${SYNC_PID:-}" ]; then
    kill "$SYNC_PID" 2>/dev/null || true
    wait "$SYNC_PID" 2>/dev/null || true
  fi

  if [ -f "$SYNC_FLAG_PATH" ]; then
    rm -f "$SYNC_FLAG_PATH"
    continue
  fi

  exit "$APP_STATUS"
done
