from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
README_PATH = REPO_ROOT / "README.md"
WORKFLOW_DOC_PATH = REPO_ROOT / "docs" / "easysms-release-workflow.md"
ACCEPTANCE_DOC_PATH = REPO_ROOT / "docs" / "release-acceptance-standard.md"


class ReleaseAcceptanceDocContractTests(unittest.TestCase):
    def test_acceptance_doc_exists_and_records_springbok_cloudflare_requirements(self) -> None:
        doc = ACCEPTANCE_DOC_PATH.read_text(encoding="utf-8")

        self.assertIn("springbok", doc.lower())
        self.assertIn("cloudflare-workers", doc)
        self.assertIn(".sba/manifest.json", doc)
        self.assertIn(".sba/deployment.json", doc)
        self.assertIn("/.well-known/easysms-release.json", doc)
        self.assertIn("/providers/health", doc)
        self.assertIn("/sms/catalog", doc)

    def test_readme_and_release_workflow_docs_link_to_acceptance_doc(self) -> None:
        readme = README_PATH.read_text(encoding="utf-8")
        workflow_doc = WORKFLOW_DOC_PATH.read_text(encoding="utf-8")

        self.assertIn("docs/release-acceptance-standard.md", readme)
        self.assertIn("docs/release-acceptance-standard.md", workflow_doc)


if __name__ == "__main__":
    unittest.main()
