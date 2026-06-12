#!/bin/sh
set -eu

case "${EASY_SMS_CONFIG_PATH:-}" in
  *C:*|*\\*) EASY_SMS_CONFIG_PATH="/etc/easy-sms/config.yaml" ;;
esac
case "${EASY_SMS_STATE_DIR:-}" in
  *C:*|*\\*) EASY_SMS_STATE_DIR="/var/lib/easy-sms" ;;
esac

HOST_CONFIG_PATH="${EASY_SMS_CONFIG_PATH:-/etc/easy-sms/config.yaml}"
STATE_DIR="${EASY_SMS_STATE_DIR:-/var/lib/easy-sms}"
HOST_RUNTIME_ENV_PATH="${EASY_SMS_RUNTIME_ENV_PATH:-/etc/easy-sms/runtime.env}"
BOOTSTRAP_PATH="${EASY_SMS_BOOTSTRAP_PATH:-/etc/easy-sms/bootstrap/r2-bootstrap.json}"
IMPORT_CODE="${EASY_SMS_IMPORT_CODE:-}"
IMPORT_STATE_PATH="${EASY_SMS_IMPORT_STATE_PATH:-${STATE_DIR}/import-sync-state.json}"
SYNC_FLAG_PATH="${EASY_SMS_IMPORT_SYNC_FLAG_PATH:-${STATE_DIR}/import-sync.restart}"
HOST_CONFIG_WAIT_SECONDS="${EASY_SMS_HOST_CONFIG_WAIT_SECONDS:-10}"
APP_RUNTIME_DIR="/tmp/easy-sms-runtime"
CONFIG_PATH="${APP_RUNTIME_DIR}/config.yaml"
RUNTIME_ENV_PATH="${APP_RUNTIME_DIR}/runtime.env"
export EASY_SMS_CONFIG_PATH="$CONFIG_PATH"
export EASY_SMS_RUNTIME_ENV_PATH="$RUNTIME_ENV_PATH"
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

mkdir -p "$(dirname "$HOST_CONFIG_PATH")" "$(dirname "$HOST_RUNTIME_ENV_PATH")" "$APP_RUNTIME_DIR" "$STATE_DIR" "$STATE_LAYOUT_DIR"

sync_runtime_inputs() {
  cp "$HOST_CONFIG_PATH" "$CONFIG_PATH"
  if [ -f "$HOST_RUNTIME_ENV_PATH" ]; then
    cp "$HOST_RUNTIME_ENV_PATH" "$RUNTIME_ENV_PATH"
  else
    rm -f "$RUNTIME_ENV_PATH"
  fi
}

wait_for_host_config() {
  remaining="$HOST_CONFIG_WAIT_SECONDS"
  while [ ! -f "$HOST_CONFIG_PATH" ] && [ "$remaining" -gt 0 ]; do
    sleep 1
    remaining=$((remaining - 1))
  done
}

if [ ! -f "$BOOTSTRAP_PATH" ] && [ -n "$IMPORT_CODE" ]; then
  mkdir -p "$(dirname "$BOOTSTRAP_PATH")"
  echo "[easy-sms] import code provided, generating bootstrap file at $BOOTSTRAP_PATH"
  "$PYTHON_BIN" /usr/local/bin/easysms-import-code.py inspect \
    --import-code "$IMPORT_CODE" \
    --output "$BOOTSTRAP_PATH"
fi

if [ ! -f "$HOST_CONFIG_PATH" ] && [ ! -f "$BOOTSTRAP_PATH" ] && [ -z "$IMPORT_CODE" ]; then
  wait_for_host_config
fi

if [ ! -f "$HOST_CONFIG_PATH" ]; then
  if [ -f "$BOOTSTRAP_PATH" ]; then
    echo "[easy-sms] runtime config missing, attempting bootstrap via $BOOTSTRAP_PATH"
    "$PYTHON_BIN" /usr/local/bin/bootstrap-service-config.py \
      --bootstrap-path "$BOOTSTRAP_PATH" \
      --config-path "$HOST_CONFIG_PATH" \
      --runtime-env-path "$HOST_RUNTIME_ENV_PATH" \
      --state-path "$IMPORT_STATE_PATH"
  elif [ -f "$TEMPLATE_PATH" ]; then
    cp "$TEMPLATE_PATH" "$HOST_CONFIG_PATH"
  fi
fi

if [ ! -f "$HOST_CONFIG_PATH" ]; then
  echo "[easy-sms] missing generated runtime config at $HOST_CONFIG_PATH" >&2
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

sync_runtime_inputs

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

can_start_as_easy() {
  EASY_SMS_STATE_LAYOUT_DIR="$STATE_LAYOUT_DIR" gosu easy node - <<'NODE'
const fs = require('fs/promises');

fs.mkdir(process.env.EASY_SMS_STATE_LAYOUT_DIR, { recursive: true })
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
NODE
}

start_runtime() {
  if [ -f "$RUNTIME_ENV_PATH" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$RUNTIME_ENV_PATH"
    set +a
  fi

  if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
    if chown -R easy:easy "$STATE_DIR" "$(dirname "$CONFIG_PATH")" /app; then
      if can_start_as_easy; then
        gosu easy "$@" &
      else
        echo "[easy-sms] falling back to root runtime because easy user cannot write $STATE_LAYOUT_DIR" >&2
        "$@" &
      fi
    else
      echo "[easy-sms] falling back to root runtime because ownership fix failed for $STATE_DIR" >&2
      "$@" &
    fi
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
        --config-path "$HOST_CONFIG_PATH" \
        --runtime-env-path "$HOST_RUNTIME_ENV_PATH" \
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
  sync_runtime_inputs
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
    sync_runtime_inputs
    rm -f "$SYNC_FLAG_PATH"
    continue
  fi

  exit "$APP_STATUS"
done
