from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_ALL_PATH = REPO_ROOT / "scripts" / "test-all.ps1"


class TestAllContractTests(unittest.TestCase):
    def test_typescript_checks_use_long_project_flag(self) -> None:
        script = TEST_ALL_PATH.read_text(encoding="utf-8")

        self.assertNotIn("Invoke-NativeCommand $serviceTsc -p tsconfig.json --noEmit", script)
        self.assertNotIn("Invoke-NativeCommand $serviceTsc -p tsconfig.json", script)
        self.assertIn('Invoke-NativeCommand $serviceTsc "--project" "tsconfig.json" "--noEmit"', script)
        self.assertIn('Invoke-NativeCommand $serviceTsc "--project" "tsconfig.json"', script)


if __name__ == "__main__":
    unittest.main()
