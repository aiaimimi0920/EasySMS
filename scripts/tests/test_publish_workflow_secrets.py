from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "list-publish-workflow-secrets.ps1"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "publish-service-base-ghcr.yml"


class PublishWorkflowSecretsTests(unittest.TestCase):
    def test_lists_expected_secret_names(self) -> None:
        result = subprocess.run(
            [
                "powershell",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(SCRIPT_PATH),
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        self.assertIn("EASYSMS_SERVICE_RUNTIME_API_KEY", lines)
        self.assertIn("EASYSMS_R2_CONFIG_MANIFEST_OBJECT_KEY", lines)
        self.assertIn("EASYSMS_USERSCRIPT_HERO_SMS_API_KEY", lines)

    def test_change_gate_tracks_hosted_smoke_driver_scripts(self) -> None:
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("scripts/test-service-base-instance.ps1", workflow)
        self.assertIn("scripts/remove-service-base.ps1", workflow)


if __name__ == "__main__":
    unittest.main()
