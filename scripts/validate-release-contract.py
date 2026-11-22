from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "release-contract.json"
DOC_PATH = ROOT / "docs" / "release-contract.md"


def load_contract() -> dict[str, Any]:
    if not CONTRACT_PATH.exists():
        raise AssertionError(f"missing contract file: {CONTRACT_PATH}")
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1:
        raise AssertionError("release-contract.json schemaVersion must be 1")
    return payload


def require_file(relative_path: str) -> Path:
    path = ROOT / relative_path
    if not path.exists():
        raise AssertionError(f"missing required file: {relative_path}")
    return path


def require_text(path: Path, needle: str) -> None:
    text = path.read_text(encoding="utf-8")
    if needle not in text:
        raise AssertionError(f"{path.relative_to(ROOT)} must contain {needle!r}")


def validate_sba(contract: dict[str, Any]) -> None:
    sba = contract.get("sba") or {}
    manifest_path = require_file(str(sba["manifestPath"]))
    deployment_path = require_file(str(sba["deploymentPath"]))
    require_file(str(sba["entrypoint"]))

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    deployment = json.loads(deployment_path.read_text(encoding="utf-8"))

    if manifest.get("schemaVersion") != sba.get("manifestSchemaVersion"):
        raise AssertionError("manifest.json schemaVersion mismatch")
    if deployment.get("schemaVersion") != sba.get("deploymentSchemaVersion"):
        raise AssertionError("deployment.json schemaVersion mismatch")
    if deployment.get("target") != sba.get("target"):
        raise AssertionError(f"deployment.json target must be {sba.get('target')}")

    actions = manifest.get("actions") or {}
    for action_name in sba.get("requiredActions", []):
        if action_name not in actions:
            raise AssertionError(f"manifest.json missing required SBA action: {action_name}")

    resource_keys = {item.get("key") for item in (deployment.get("resources") or [])}
    for key in sba.get("requiredResources", []):
        if key not in resource_keys:
            raise AssertionError(f"deployment.json missing required resource: {key}")


def validate_worker(contract: dict[str, Any]) -> None:
    worker = contract.get("worker") or {}
    require_file(str(worker["sourceEntrypoint"]))
    require_file(str(worker["buildScript"]))
    require_file(str(worker["migrationSql"]))


def validate_ci(contract: dict[str, Any]) -> None:
    ci = contract.get("ci") or {}
    workflow = require_file(str(ci["validateWorkflow"]))
    require_text(workflow, "test-all.ps1")
    require_text(workflow, "validate-release-contract.py")
    if (ROOT / ".github" / "workflows" / "publish-service-base-ghcr.yml").exists():
        raise AssertionError("legacy GHCR publish workflow must not exist in Cloudflare SBA mode")
    if (ROOT / "deploy").exists():
        raise AssertionError("legacy Docker deploy directory must not exist in Cloudflare SBA mode")


def validate_doc(contract: dict[str, Any]) -> None:
    if not DOC_PATH.exists():
        raise AssertionError(f"missing release contract document: {DOC_PATH.relative_to(ROOT)}")
    require_text(DOC_PATH, "# Release Contract")
    require_text(DOC_PATH, str(contract["project"]))
    require_text(DOC_PATH, str(contract["releaseClass"]))


def main() -> int:
    contract = load_contract()
    if not contract.get("project"):
        raise AssertionError("project is required")
    if not contract.get("releaseClass"):
        raise AssertionError("releaseClass is required")
    validate_sba(contract)
    validate_worker(contract)
    validate_ci(contract)
    validate_doc(contract)
    print(f"release contract ok: {contract['project']} ({contract['releaseClass']})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"release contract failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
