from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "deploy-host.ps1"
SMOKE_INSTANCE_SCRIPT = REPO_ROOT / "scripts" / "test-service-base-instance.ps1"


class DeployHostContractTests(unittest.TestCase):
    def test_resolve_repo_only_mode_succeeds_without_deploying(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_root = Path(temp_dir) / "repo-cache"
            result = subprocess.run(
                [
                    "powershell",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(SCRIPT_PATH),
                    "-ResolveRepoOnly",
                    "-RepoCacheRoot",
                    str(cache_root),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertIn("RepoRoot", result.stdout)

    def test_smoke_instance_names_are_hashed_from_image_and_scope(self) -> None:
        script = SMOKE_INSTANCE_SCRIPT.read_text(encoding="utf-8")

        self.assertIn("function Get-EasySmsStableHash", script)
        self.assertIn('$scope = if (-not [string]::IsNullOrWhiteSpace($ApiKey)) { "secure" } else { "public" }', script)
        self.assertIn("$Image", script)
        self.assertIn("$effectiveConfigPath", script)


if __name__ == "__main__":
    unittest.main()
