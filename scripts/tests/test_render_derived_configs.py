from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "render-derived-configs.py"


class RenderDerivedConfigsTests(unittest.TestCase):
    def test_renders_runtime_env_summary_and_userscript_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.yaml"
            runtime_output = temp_root / "runtime-config.yaml"
            runtime_env_output = temp_root / "runtime.env"
            summary_output = temp_root / "summary.json"
            userscript_output = temp_root / "userscript.json"

            config_path.write_text(
                textwrap.dedent(
                    """
                    userscript:
                      defaults:
                        pollSeconds: "7"
                    serviceBase:
                      containerEnvironment:
                        EASY_SMS_RESET_STORE_ON_BOOT: "true"
                        SAMPLE_NUMBER: 3
                        SAMPLE_BOOL: true
                      runtime:
                        server:
                          host: 0.0.0.0
                          port: 8080
                    """
                ).strip(),
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--config",
                    str(config_path),
                    "--runtime-output",
                    str(runtime_output),
                    "--runtime-env-output",
                    str(runtime_env_output),
                    "--summary-output",
                    str(summary_output),
                    "--userscript-overrides-output",
                    str(userscript_output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            runtime_config = yaml.safe_load(runtime_output.read_text(encoding="utf-8"))
            self.assertEqual(runtime_config["server"]["port"], 8080)

            runtime_env = runtime_env_output.read_text(encoding="utf-8")
            self.assertIn("EASY_SMS_RESET_STORE_ON_BOOT=true", runtime_env)
            self.assertIn("SAMPLE_NUMBER=3", runtime_env)
            self.assertIn("SAMPLE_BOOL=true", runtime_env)

            summary = json.loads(summary_output.read_text(encoding="utf-8"))
            self.assertIn("serviceBase", summary)

            userscript_defaults = json.loads(userscript_output.read_text(encoding="utf-8"))
            self.assertEqual(userscript_defaults["pollSeconds"], "7")


if __name__ == "__main__":
    unittest.main()
