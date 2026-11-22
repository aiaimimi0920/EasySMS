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
    def test_renders_runtime_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.yaml"
            runtime_output = temp_root / "runtime-config.yaml"
            summary_output = temp_root / "summary.json"

            config_path.write_text(
                textwrap.dedent(
                    """
                    serviceBase:
                      runtime:
                        server:
                          host: 127.0.0.1
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
                    "--summary-output",
                    str(summary_output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            runtime_config = yaml.safe_load(runtime_output.read_text(encoding="utf-8"))
            self.assertEqual(runtime_config["server"]["port"], 8080)

            summary = json.loads(summary_output.read_text(encoding="utf-8"))
            self.assertIn("serviceBase", summary)
            self.assertNotIn("userscript", summary)
            self.assertNotIn("publishing", summary)

    def test_example_runtime_config_enables_persistence(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            runtime_output = temp_root / "runtime-config.yaml"

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "--config",
                    str(REPO_ROOT / "config.example.yaml"),
                    "--runtime-output",
                    str(runtime_output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)
            runtime_config = yaml.safe_load(runtime_output.read_text(encoding="utf-8"))
            self.assertTrue(runtime_config["persistence"]["enabled"])


if __name__ == "__main__":
    unittest.main()
