from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "materialize-action-config.py"


class MaterializeActionConfigTests(unittest.TestCase):
    def run_script(self, *, base_config: Path, output: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        merged_env = os.environ.copy()
        merged_env.update(env)
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--base-config", str(base_config), "--output", str(output)],
            cwd=REPO_ROOT,
            env=merged_env,
            text=True,
            capture_output=True,
        )

    def test_materializes_service_userscript_and_r2_overlays(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base_config = Path(temp_dir) / "config.example.yaml"
            output = Path(temp_dir) / "config.yaml"
            base_config.write_text(
                textwrap.dedent(
                    """
                    userscript:
                      defaults:
                        onlineSimApiKey: ""
                        receiveSmssUsername: ""
                        receiveSmssPassword: ""
                    serviceBase:
                      containerEnvironment: {}
                      runtime:
                        server: {}
                        providers:
                          onlineSim:
                            apiKey: ""
                          receiveSmss:
                            username: ""
                            password: ""
                          receiveSmsFreeCc:
                            email: ""
                            password: ""
                          heroSms:
                            enabled: false
                            apiKey: ""
                    publishing:
                      r2Config:
                        enabled: false
                        bucket: ""
                    """
                ).strip(),
                encoding="utf-8",
            )

            result = self.run_script(
                base_config=base_config,
                output=output,
                env={
                    "EASYSMS_SERVICE_CONTAINER_ENVIRONMENT": '{"EASY_SMS_RESET_STORE_ON_BOOT":"true","SAMPLE_BOOL":"false"}',
                    "EASYSMS_SERVICE_RUNTIME_API_KEY": "workflow-api-key",
                    "EASYSMS_PROVIDER_ONLINESIM_API_KEY": "onlinesim-secret",
                    "EASYSMS_PROVIDER_RECEIVE_SMSS_USERNAME": "receive-user",
                    "EASYSMS_PROVIDER_RECEIVE_SMSS_PASSWORD": "receive-password",
                    "EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_EMAIL": "guard@example.com",
                    "EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_PASSWORD": "guard-password",
                    "EASYSMS_PROVIDER_HERO_SMS_ENABLED": "true",
                    "EASYSMS_PROVIDER_HERO_SMS_API_KEY": "hero-secret",
                    "EASYSMS_USERSCRIPT_ONLINESIM_API_KEY": "onlinesim-userscript",
                    "EASYSMS_USERSCRIPT_RECEIVE_SMSS_USERNAME": "receive-user",
                    "EASYSMS_USERSCRIPT_RECEIVE_SMSS_PASSWORD": "receive-password",
                    "EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_EMAIL": "guard@example.com",
                    "EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_PASSWORD": "guard-password",
                    "EASYSMS_R2_CONFIG_ENABLED": "true",
                    "EASYSMS_R2_CONFIG_ACCOUNT_ID": "account-id",
                    "EASYSMS_R2_CONFIG_BUCKET": "bucket-name",
                    "EASYSMS_R2_CONFIG_ENDPOINT": "https://example.r2.invalid",
                    "EASYSMS_R2_CONFIG_CONFIG_OBJECT_KEY": "easysms/service-base/config.yaml",
                    "EASYSMS_R2_CONFIG_ENV_OBJECT_KEY": "easysms/service-base/runtime.env",
                    "EASYSMS_R2_CONFIG_USERSCRIPT_OBJECT_KEY": "easysms/service-base/userscript-defaults.json",
                    "EASYSMS_R2_CONFIG_MANIFEST_OBJECT_KEY": "easysms/service-base/manifest.json",
                    "EASYSMS_R2_CONFIG_UPLOAD_ACCESS_KEY_ID": "upload-id",
                    "EASYSMS_R2_CONFIG_UPLOAD_SECRET_ACCESS_KEY": "upload-secret",
                    "EASYSMS_R2_CONFIG_READ_ACCESS_KEY_ID": "read-id",
                    "EASYSMS_R2_CONFIG_READ_SECRET_ACCESS_KEY": "read-secret",
                    "EASYSMS_R2_CONFIG_SYNC_ENABLED": "true",
                    "EASYSMS_R2_CONFIG_SYNC_INTERVAL_SECONDS": "900",
                },
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr)

            data = yaml.safe_load(output.read_text(encoding="utf-8"))
            self.assertEqual(data["serviceBase"]["containerEnvironment"]["EASY_SMS_RESET_STORE_ON_BOOT"], "true")
            self.assertEqual(data["serviceBase"]["runtime"]["server"]["apiKey"], "workflow-api-key")
            self.assertEqual(data["serviceBase"]["runtime"]["providers"]["onlineSim"]["apiKey"], "onlinesim-secret")
            self.assertEqual(data["serviceBase"]["runtime"]["providers"]["receiveSmss"]["username"], "receive-user")
            self.assertEqual(data["serviceBase"]["runtime"]["providers"]["receiveSmsFreeCc"]["email"], "guard@example.com")
            self.assertTrue(data["serviceBase"]["runtime"]["providers"]["heroSms"]["enabled"])
            self.assertEqual(data["serviceBase"]["runtime"]["providers"]["heroSms"]["apiKey"], "hero-secret")
            self.assertEqual(data["userscript"]["defaults"]["onlineSimApiKey"], "onlinesim-userscript")
            self.assertEqual(data["userscript"]["defaults"]["receiveSmssUsername"], "receive-user")
            self.assertEqual(data["publishing"]["r2Config"]["bucket"], "bucket-name")
            self.assertEqual(data["publishing"]["r2Config"]["syncIntervalSeconds"], 900)

    def test_requires_at_least_one_known_secret(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            base_config = Path(temp_dir) / "config.example.yaml"
            output = Path(temp_dir) / "config.yaml"
            base_config.write_text("userscript: {}\nserviceBase: {}\npublishing: {}\n", encoding="utf-8")

            result = self.run_script(base_config=base_config, output=output, env={})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("EASYSMS_", result.stderr)


if __name__ == "__main__":
    unittest.main()
