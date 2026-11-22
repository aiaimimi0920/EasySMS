#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover - environment failure path
    raise SystemExit(
        "PyYAML is required for scripts/render-derived-configs.py. "
        "Install it with: python -m pip install pyyaml"
    ) from exc


def resolve_path(raw_path: str, base_dir: Path) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (base_dir / candidate).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description="Render EasySms local runtime config from the root operator config.")
    parser.add_argument("--config", default="config.yaml", help="Path to the root operator config.")
    parser.add_argument("--runtime-output", required=True, help="Output path for derived service/base runtime YAML.")
    parser.add_argument("--summary-output", help="Optional output path for a JSON summary of the loaded config.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    config_path = resolve_path(args.config, repo_root)
    runtime_output = resolve_path(args.runtime_output, repo_root)
    summary_output = resolve_path(args.summary_output, repo_root) if args.summary_output else None

    if not config_path.exists():
        raise SystemExit(f"Config not found: {config_path}")

    with config_path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    service_base = data.get("serviceBase")
    if not isinstance(service_base, dict):
        raise SystemExit("Root config is missing a 'serviceBase' mapping.")

    runtime = service_base.get("runtime")
    if not isinstance(runtime, dict):
        raise SystemExit("Root config is missing a 'serviceBase.runtime' mapping.")

    runtime_output.parent.mkdir(parents=True, exist_ok=True)
    with runtime_output.open("w", encoding="utf-8", newline="\n") as handle:
        yaml.safe_dump(runtime, handle, sort_keys=False, allow_unicode=True)

    if summary_output is not None:
        summary_output.parent.mkdir(parents=True, exist_ok=True)
        with summary_output.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
