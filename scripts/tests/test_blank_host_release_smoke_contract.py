from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER_PATH = REPO_ROOT / "scripts" / "run-blank-host-release-smoke.ps1"
DECRYPT_HELPER_PATH = REPO_ROOT / "scripts" / "decrypt-import-code.ps1"


class BlankHostReleaseSmokeContractTests(unittest.TestCase):
    def test_blank_host_release_smoke_helper_exists_and_uses_github_artifacts(self) -> None:
        script = HELPER_PATH.read_text(encoding="utf-8")

        self.assertIn("service-base-import-code-encrypted", script)
        self.assertIn("/actions/runs/", script)
        self.assertIn("/artifacts", script)
        self.assertIn("deploy-host.ps1", script)
        self.assertIn("/healthz", script)
        self.assertIn("/providers", script)
        self.assertIn("/providers/health", script)
        self.assertIn("/sms/catalog", script)
        self.assertIn("-RepoRefKind", script)
        self.assertIn("tag", script)
        self.assertIn("docker ps -a --format '{{.Names}}'", script)
        self.assertIn("docker rm -f $effectiveContainerName", script)

    def test_helper_can_resolve_latest_successful_publish_run_when_run_id_is_omitted(self) -> None:
        script = HELPER_PATH.read_text(encoding="utf-8")

        self.assertNotIn("[Parameter(Mandatory = $true)]\n    [long]$RunId", script)
        self.assertIn("[long]$RunId = 0", script)
        self.assertIn("function Find-LatestSuccessfulPublishRun", script)
        self.assertIn("publish-service-base-ghcr.yml", script)
        self.assertIn("Publish Service Base GHCR", script)
        self.assertIn("/actions/workflows/", script)
        self.assertIn("/runs?per_page=", script)
        self.assertIn("$_.conclusion -eq 'success'", script)
        self.assertIn("$_.head_branch -eq $RequestedReleaseTag", script)

    def test_default_workroot_uses_short_system_temp_path(self) -> None:
        script = HELPER_PATH.read_text(encoding="utf-8")

        self.assertIn("[System.IO.Path]::GetTempPath()", script)
        self.assertIn("easy-sms-blank-host-release-smoke", script)
        self.assertNotIn('Join-Path $repoRoot ".tmp\\blank-host-release-smoke\\$effectiveRunId"', script)

    def test_decrypt_import_code_helper_exists_and_wraps_easysms_import_code(self) -> None:
        script = DECRYPT_HELPER_PATH.read_text(encoding="utf-8")

        self.assertIn("easysms-import-code.py", script)
        self.assertIn("decrypt", script)
        self.assertIn("--encrypted-file", script)
        self.assertIn("--private-key-file", script)
        self.assertIn("--import-code-only", script)


if __name__ == "__main__":
    unittest.main()
