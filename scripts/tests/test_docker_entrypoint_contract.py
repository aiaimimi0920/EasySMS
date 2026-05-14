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


if __name__ == "__main__":
    unittest.main()
