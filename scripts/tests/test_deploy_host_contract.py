from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "deploy-host.ps1"


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


if __name__ == "__main__":
    unittest.main()
