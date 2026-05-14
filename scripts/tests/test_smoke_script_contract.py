from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SMOKE_SCRIPT = REPO_ROOT / "deploy" / "service" / "base" / "smoke-easy-sms-docker-api.ps1"


class SmokeScriptContractTests(unittest.TestCase):
    def test_status_probe_avoids_windows_only_curl_exe_dependency(self) -> None:
        script = SMOKE_SCRIPT.read_text(encoding="utf-8")

        self.assertNotIn("curl.exe", script)
        self.assertIn("[System.Net.WebRequest]::Create", script)
        self.assertIn("GetResponse()", script)


if __name__ == "__main__":
    unittest.main()
