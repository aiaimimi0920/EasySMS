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

    def test_smoke_script_asserts_provider_catalog_and_health_consistency(self) -> None:
        script = SMOKE_SCRIPT.read_text(encoding="utf-8")

        self.assertIn('$providerKeys = @($providers.providers | ForEach-Object { [string]$_.key })', script)
        self.assertIn('$catalogProviderKeys = @($catalog.catalog.providers | ForEach-Object { [string]$_.key })', script)
        self.assertIn('$providerHealthKeys = @($providerHealth.providers | ForEach-Object { [string]$_.providerKey })', script)
        self.assertIn('Compare-Object -ReferenceObject $providerKeys -DifferenceObject $catalogProviderKeys', script)
        self.assertIn('Compare-Object -ReferenceObject $providerKeys -DifferenceObject $providerHealthKeys', script)
        self.assertIn('$health.providerCount -ne $providerHealth.summary.totalProviders', script)


if __name__ == "__main__":
    unittest.main()
