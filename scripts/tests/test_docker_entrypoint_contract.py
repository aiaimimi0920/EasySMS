from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT_PATH = REPO_ROOT / "deploy" / "service" / "base" / "docker-entrypoint.sh"


class DockerEntrypointContractTests(unittest.TestCase):
    def test_bootstrap_paths_use_resolved_python_binary(self) -> None:
        script = ENTRYPOINT_PATH.read_text(encoding="utf-8")

        self.assertIn('if command -v python3 >/dev/null 2>&1; then', script)
        self.assertIn('PYTHON_BIN="python3"', script)
        self.assertIn('elif command -v python >/dev/null 2>&1; then', script)
        self.assertIn('"$PYTHON_BIN" /usr/local/bin/easysms-import-code.py inspect', script)
        self.assertIn('"$PYTHON_BIN" /usr/local/bin/bootstrap-service-config.py', script)
        self.assertIn('"$PYTHON_BIN" - "$BOOTSTRAP_PATH"', script)

    def test_runtime_reads_from_internal_staging_copy_not_host_bind_mount(self) -> None:
        script = ENTRYPOINT_PATH.read_text(encoding="utf-8")

        self.assertIn('HOST_CONFIG_PATH="${EASY_SMS_CONFIG_PATH:-/etc/easy-sms/config.yaml}"', script)
        self.assertIn('HOST_RUNTIME_ENV_PATH="${EASY_SMS_RUNTIME_ENV_PATH:-/etc/easy-sms/runtime.env}"', script)
        self.assertIn('APP_RUNTIME_DIR="${STATE_DIR}/runtime"', script)
        self.assertIn('CONFIG_PATH="${APP_RUNTIME_DIR}/config.yaml"', script)
        self.assertIn('RUNTIME_ENV_PATH="${APP_RUNTIME_DIR}/runtime.env"', script)
        self.assertIn('export EASY_SMS_CONFIG_PATH="$CONFIG_PATH"', script)
        self.assertIn('export EASY_SMS_RUNTIME_ENV_PATH="$RUNTIME_ENV_PATH"', script)
        self.assertIn('sync_runtime_inputs() {', script)
        self.assertIn('cp "$HOST_CONFIG_PATH" "$CONFIG_PATH"', script)
        self.assertIn('cp "$HOST_RUNTIME_ENV_PATH" "$RUNTIME_ENV_PATH"', script)


if __name__ == "__main__":
    unittest.main()
