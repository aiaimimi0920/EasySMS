from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "easysms-import-code.py"


class EasySmsImportCodeTests(unittest.TestCase):
    def test_encode_and_inspect_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_output = temp_root / "bundle.json"
            inspect_output = temp_root / "inspect.json"

            encode = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "encode",
                    "--account-id",
                    "account-id",
                    "--bucket",
                    "bucket-name",
                    "--manifest-object-key",
                    "easysms/service-base/manifest.json",
                    "--access-key-id",
                    "read-id",
                    "--secret-access-key",
                    "read-secret",
                    "--release-version",
                    "release-1",
                    "--json-output",
                    "--output",
                    str(bundle_output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )
            self.assertEqual(encode.returncode, 0, msg=encode.stderr)

            bundle = json.loads(bundle_output.read_text(encoding="utf-8"))
            import_code = bundle["importCode"]
            self.assertTrue(import_code.startswith("easysms-import-v1."))

            inspect = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_PATH),
                    "inspect",
                    "--import-code",
                    import_code,
                    "--output",
                    str(inspect_output),
                ],
                cwd=REPO_ROOT,
                text=True,
                capture_output=True,
            )
            self.assertEqual(inspect.returncode, 0, msg=inspect.stderr)

            payload = json.loads(inspect_output.read_text(encoding="utf-8"))
            self.assertEqual(payload["kind"], "easysms-import-code")
            self.assertEqual(payload["bucket"], "bucket-name")
            self.assertEqual(payload["manifestObjectKey"], "easysms/service-base/manifest.json")
            self.assertEqual(payload["releaseVersion"], "release-1")


if __name__ == "__main__":
    unittest.main()
