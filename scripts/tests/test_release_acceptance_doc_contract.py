from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
README_PATH = REPO_ROOT / "README.md"
WORKFLOW_DOC_PATH = REPO_ROOT / "docs" / "easysms-release-workflow.md"
ACCEPTANCE_DOC_PATH = REPO_ROOT / "docs" / "release-acceptance-standard.md"


class ReleaseAcceptanceDocContractTests(unittest.TestCase):
    def test_acceptance_doc_exists_and_records_blank_host_requirements(self) -> None:
        doc = ACCEPTANCE_DOC_PATH.read_text(encoding="utf-8")

        self.assertIn("blank-host", doc.lower())
        self.assertIn("deploy-host.ps1", doc)
        self.assertIn("run-blank-host-release-smoke.ps1", doc)
        self.assertIn("Publish Service Base GHCR", doc)
        self.assertIn("service-base-import-code-encrypted", doc)
        self.assertIn("/providers/health", doc)
        self.assertIn("/sms/catalog", doc)

    def test_readme_and_release_workflow_docs_link_to_acceptance_doc(self) -> None:
        readme = README_PATH.read_text(encoding="utf-8")
        workflow_doc = WORKFLOW_DOC_PATH.read_text(encoding="utf-8")

        self.assertIn("docs/release-acceptance-standard.md", readme)
        self.assertIn("docs/release-acceptance-standard.md", workflow_doc)


if __name__ == "__main__":
    unittest.main()
