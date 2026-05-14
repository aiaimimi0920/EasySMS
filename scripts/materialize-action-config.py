#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import yaml


def deep_merge(base: Any, overlay: Any) -> Any:
    if overlay is None:
        return base
    if isinstance(base, dict) and isinstance(overlay, dict):
        merged = dict(base)
        for key, value in overlay.items():
            if key in merged:
                merged[key] = deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged
    return overlay


def load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Base config not found: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}


def load_yaml_value(text: str, source_name: str) -> Any:
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as exc:  # pragma: no cover
        raise SystemExit(f"Failed to parse YAML from {source_name}: {exc}") from exc


def get_secret_text(name: str) -> str:
    return os.environ.get(name, "").strip()


def has_secret_value(name: str) -> bool:
    return bool(get_secret_text(name))


def normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    for item in items:
        if item is None:
            continue
        text = str(item).strip()
        if text:
            normalized.append(text)
    return normalized


def parse_list_secret(name: str) -> list[str] | None:
    raw = get_secret_text(name)
    if not raw:
        return None

    parsed = load_yaml_value(raw, name)
    if isinstance(parsed, list):
        return normalize_string_list(parsed)
    if isinstance(parsed, str):
        lines = [line.strip() for line in parsed.splitlines() if line.strip()]
        if len(lines) > 1:
            return lines
        if "," in parsed:
            return [part.strip() for part in parsed.split(",") if part.strip()]
        return normalize_string_list(parsed)
    return normalize_string_list(parsed)


def parse_bool_secret(name: str) -> bool | None:
    raw = get_secret_text(name)
    if not raw:
        return None

    parsed = load_yaml_value(raw, name)
    if isinstance(parsed, bool):
        return parsed
    text = str(parsed).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    raise SystemExit(f"Secret {name} must be a boolean value.")


def parse_int_secret(name: str) -> int | None:
    raw = get_secret_text(name)
    if not raw:
        return None

    parsed = load_yaml_value(raw, name)
    try:
        return int(parsed)
    except (TypeError, ValueError) as exc:
        raise SystemExit(f"Secret {name} must be an integer value.") from exc


def parse_yaml_secret(name: str) -> Any:
    raw = get_secret_text(name)
    if not raw:
        return None
    return load_yaml_value(raw, name)


def set_if_present(mapping: dict[str, Any], key: str, value: Any) -> None:
    if value is None:
        return
    if isinstance(value, str) and not value.strip():
        return
    if isinstance(value, list) and not value:
        return
    if isinstance(value, dict) and not value:
        return
    mapping[key] = value


def build_service_overlay() -> dict[str, Any] | None:
    names = [
        "EASYSMS_SERVICE_IMAGE",
        "EASYSMS_SERVICE_HOST_PORT",
        "EASYSMS_SERVICE_CONTAINER_NAME",
        "EASYSMS_SERVICE_CONTAINER_ENVIRONMENT",
        "EASYSMS_SERVICE_RUNTIME_API_KEY",
        "EASYSMS_PROVIDER_ENABLED_PROVIDERS",
        "EASYSMS_PROVIDER_ONLINESIM_API_KEY",
        "EASYSMS_PROVIDER_SMSTOME_EMAIL",
        "EASYSMS_PROVIDER_SMSTOME_PASSWORD",
        "EASYSMS_PROVIDER_RECEIVE_SMSS_USERNAME",
        "EASYSMS_PROVIDER_RECEIVE_SMSS_PASSWORD",
        "EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_EMAIL",
        "EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_PASSWORD",
        "EASYSMS_PROVIDER_HERO_SMS_ENABLED",
        "EASYSMS_PROVIDER_HERO_SMS_API_KEY",
        "EASYSMS_PROVIDER_HERO_SMS_BASE_URL",
        "EASYSMS_PROVIDER_HERO_SMS_DEFAULT_SERVICE",
        "EASYSMS_PROVIDER_HERO_SMS_DEFAULT_COUNTRY",
        "EASYSMS_PROVIDER_HERO_SMS_SELECTION_MODE",
        "EASYSMS_PROVIDER_HERO_SMS_REUSE_ENABLED",
        "EASYSMS_PROVIDER_HERO_SMS_DEFAULT_MAX_BINDINGS_PER_PHONE",
        "EASYSMS_PROVIDER_HERO_SMS_REFUNDABLE_CANCEL_WINDOW_SECONDS",
        "EASYSMS_PROVIDER_HERO_SMS_LEASE_WINDOW_SECONDS",
    ]
    if not any(has_secret_value(name) for name in names):
        return None

    service_base: dict[str, Any] = {}
    runtime: dict[str, Any] = {}
    server: dict[str, Any] = {}
    providers: dict[str, Any] = {}

    set_if_present(service_base, "image", get_secret_text("EASYSMS_SERVICE_IMAGE"))
    set_if_present(service_base, "hostPort", parse_int_secret("EASYSMS_SERVICE_HOST_PORT"))
    set_if_present(service_base, "containerName", get_secret_text("EASYSMS_SERVICE_CONTAINER_NAME"))
    container_environment = parse_yaml_secret("EASYSMS_SERVICE_CONTAINER_ENVIRONMENT")
    if container_environment is not None and not isinstance(container_environment, dict):
        raise SystemExit("Secret EASYSMS_SERVICE_CONTAINER_ENVIRONMENT must be a YAML/JSON mapping.")
    set_if_present(service_base, "containerEnvironment", container_environment)

    set_if_present(server, "apiKey", get_secret_text("EASYSMS_SERVICE_RUNTIME_API_KEY"))
    if server:
        runtime["server"] = server

    set_if_present(providers, "enabledProviders", parse_list_secret("EASYSMS_PROVIDER_ENABLED_PROVIDERS"))

    online_sim: dict[str, Any] = {}
    set_if_present(online_sim, "apiKey", get_secret_text("EASYSMS_PROVIDER_ONLINESIM_API_KEY"))
    if online_sim:
        providers["onlineSim"] = online_sim

    sms_to_me: dict[str, Any] = {}
    set_if_present(sms_to_me, "email", get_secret_text("EASYSMS_PROVIDER_SMSTOME_EMAIL"))
    set_if_present(sms_to_me, "password", get_secret_text("EASYSMS_PROVIDER_SMSTOME_PASSWORD"))
    if sms_to_me:
        providers["smsToMe"] = sms_to_me

    receive_smss: dict[str, Any] = {}
    set_if_present(receive_smss, "username", get_secret_text("EASYSMS_PROVIDER_RECEIVE_SMSS_USERNAME"))
    set_if_present(receive_smss, "password", get_secret_text("EASYSMS_PROVIDER_RECEIVE_SMSS_PASSWORD"))
    if receive_smss:
        providers["receiveSmss"] = receive_smss

    receive_sms_free_cc: dict[str, Any] = {}
    set_if_present(receive_sms_free_cc, "email", get_secret_text("EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_EMAIL"))
    set_if_present(receive_sms_free_cc, "password", get_secret_text("EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_PASSWORD"))
    if receive_sms_free_cc:
        providers["receiveSmsFreeCc"] = receive_sms_free_cc

    hero_sms: dict[str, Any] = {}
    set_if_present(hero_sms, "enabled", parse_bool_secret("EASYSMS_PROVIDER_HERO_SMS_ENABLED"))
    set_if_present(hero_sms, "apiKey", get_secret_text("EASYSMS_PROVIDER_HERO_SMS_API_KEY"))
    set_if_present(hero_sms, "baseUrl", get_secret_text("EASYSMS_PROVIDER_HERO_SMS_BASE_URL"))
    set_if_present(hero_sms, "defaultService", get_secret_text("EASYSMS_PROVIDER_HERO_SMS_DEFAULT_SERVICE"))
    set_if_present(hero_sms, "defaultCountry", parse_int_secret("EASYSMS_PROVIDER_HERO_SMS_DEFAULT_COUNTRY"))
    set_if_present(hero_sms, "selectionMode", get_secret_text("EASYSMS_PROVIDER_HERO_SMS_SELECTION_MODE"))
    set_if_present(hero_sms, "reuseEnabled", parse_bool_secret("EASYSMS_PROVIDER_HERO_SMS_REUSE_ENABLED"))
    set_if_present(
        hero_sms,
        "defaultMaxBindingsPerPhone",
        parse_int_secret("EASYSMS_PROVIDER_HERO_SMS_DEFAULT_MAX_BINDINGS_PER_PHONE"),
    )
    set_if_present(
        hero_sms,
        "refundableCancelWindowSeconds",
        parse_int_secret("EASYSMS_PROVIDER_HERO_SMS_REFUNDABLE_CANCEL_WINDOW_SECONDS"),
    )
    set_if_present(
        hero_sms,
        "leaseWindowSeconds",
        parse_int_secret("EASYSMS_PROVIDER_HERO_SMS_LEASE_WINDOW_SECONDS"),
    )
    if hero_sms:
        providers["heroSms"] = hero_sms

    if providers:
        runtime["providers"] = providers
    if runtime:
        service_base["runtime"] = runtime

    return {"serviceBase": service_base} if service_base else None


def build_userscript_overlay() -> dict[str, Any] | None:
    names = [
        "EASYSMS_USERSCRIPT_PROVIDER_MODE",
        "EASYSMS_USERSCRIPT_EXPLICIT_PROVIDER_KEY",
        "EASYSMS_USERSCRIPT_SELECTED_PROVIDERS",
        "EASYSMS_USERSCRIPT_ONLINESIM_API_KEY",
        "EASYSMS_USERSCRIPT_SMSTOME_EMAIL",
        "EASYSMS_USERSCRIPT_SMSTOME_PASSWORD",
        "EASYSMS_USERSCRIPT_RECEIVE_SMSS_USERNAME",
        "EASYSMS_USERSCRIPT_RECEIVE_SMSS_PASSWORD",
        "EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_EMAIL",
        "EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_PASSWORD",
        "EASYSMS_USERSCRIPT_HERO_SMS_API_KEY",
        "EASYSMS_USERSCRIPT_HERO_SMS_BASE_URL",
        "EASYSMS_USERSCRIPT_HERO_SMS_SERVICE",
        "EASYSMS_USERSCRIPT_HERO_SMS_COUNTRY",
        "EASYSMS_USERSCRIPT_HERO_SMS_OPERATOR",
        "EASYSMS_USERSCRIPT_HERO_SMS_SELECTION_MODE",
        "EASYSMS_USERSCRIPT_HERO_SMS_ALLOW_REUSE",
        "EASYSMS_USERSCRIPT_HERO_SMS_BUSINESS_KEY",
        "EASYSMS_USERSCRIPT_HERO_SMS_MAX_BINDINGS_PER_PHONE",
    ]
    if not any(has_secret_value(name) for name in names):
        return None

    defaults: dict[str, Any] = {}
    set_if_present(defaults, "providerMode", get_secret_text("EASYSMS_USERSCRIPT_PROVIDER_MODE"))
    set_if_present(defaults, "explicitProviderKey", get_secret_text("EASYSMS_USERSCRIPT_EXPLICIT_PROVIDER_KEY"))
    selected_providers = parse_list_secret("EASYSMS_USERSCRIPT_SELECTED_PROVIDERS")
    if selected_providers:
        defaults["selectedProvidersCsv"] = ",".join(selected_providers)
    set_if_present(defaults, "onlineSimApiKey", get_secret_text("EASYSMS_USERSCRIPT_ONLINESIM_API_KEY"))
    set_if_present(defaults, "smsToMeEmail", get_secret_text("EASYSMS_USERSCRIPT_SMSTOME_EMAIL"))
    set_if_present(defaults, "smsToMePassword", get_secret_text("EASYSMS_USERSCRIPT_SMSTOME_PASSWORD"))
    set_if_present(defaults, "receiveSmssUsername", get_secret_text("EASYSMS_USERSCRIPT_RECEIVE_SMSS_USERNAME"))
    set_if_present(defaults, "receiveSmssPassword", get_secret_text("EASYSMS_USERSCRIPT_RECEIVE_SMSS_PASSWORD"))
    set_if_present(defaults, "receiveSmsFreeCcEmail", get_secret_text("EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_EMAIL"))
    set_if_present(defaults, "receiveSmsFreeCcPassword", get_secret_text("EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_PASSWORD"))
    set_if_present(defaults, "heroSmsApiKey", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_API_KEY"))
    set_if_present(defaults, "heroSmsBaseUrl", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_BASE_URL"))
    set_if_present(defaults, "heroSmsService", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_SERVICE"))
    set_if_present(defaults, "heroSmsCountry", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_COUNTRY"))
    set_if_present(defaults, "heroSmsOperator", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_OPERATOR"))
    set_if_present(defaults, "heroSmsSelectionMode", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_SELECTION_MODE"))
    set_if_present(defaults, "heroSmsAllowReuse", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_ALLOW_REUSE"))
    set_if_present(defaults, "heroSmsBusinessKey", get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_BUSINESS_KEY"))
    set_if_present(
        defaults,
        "heroSmsMaxBindingsPerPhone",
        get_secret_text("EASYSMS_USERSCRIPT_HERO_SMS_MAX_BINDINGS_PER_PHONE"),
    )
    if not defaults:
        return None

    return {"userscript": {"defaults": defaults}}


def build_r2_overlay() -> dict[str, Any] | None:
    names = [
        "EASYSMS_R2_CONFIG_ENABLED",
        "EASYSMS_R2_CONFIG_ACCOUNT_ID",
        "EASYSMS_R2_CONFIG_BUCKET",
        "EASYSMS_R2_CONFIG_ENDPOINT",
        "EASYSMS_R2_CONFIG_CONFIG_OBJECT_KEY",
        "EASYSMS_R2_CONFIG_ENV_OBJECT_KEY",
        "EASYSMS_R2_CONFIG_USERSCRIPT_OBJECT_KEY",
        "EASYSMS_R2_CONFIG_MANIFEST_OBJECT_KEY",
        "EASYSMS_R2_CONFIG_UPLOAD_ACCESS_KEY_ID",
        "EASYSMS_R2_CONFIG_UPLOAD_SECRET_ACCESS_KEY",
        "EASYSMS_R2_CONFIG_READ_ACCESS_KEY_ID",
        "EASYSMS_R2_CONFIG_READ_SECRET_ACCESS_KEY",
        "EASYSMS_R2_CONFIG_IMPORT_CODE_OWNER_PUBLIC_KEY",
        "EASYSMS_R2_CONFIG_SYNC_ENABLED",
        "EASYSMS_R2_CONFIG_SYNC_INTERVAL_SECONDS",
    ]
    if not any(has_secret_value(name) for name in names):
        return None

    r2_config: dict[str, Any] = {}
    set_if_present(r2_config, "enabled", parse_bool_secret("EASYSMS_R2_CONFIG_ENABLED"))
    set_if_present(r2_config, "accountId", get_secret_text("EASYSMS_R2_CONFIG_ACCOUNT_ID"))
    set_if_present(r2_config, "bucket", get_secret_text("EASYSMS_R2_CONFIG_BUCKET"))
    set_if_present(r2_config, "endpoint", get_secret_text("EASYSMS_R2_CONFIG_ENDPOINT"))
    set_if_present(r2_config, "configObjectKey", get_secret_text("EASYSMS_R2_CONFIG_CONFIG_OBJECT_KEY"))
    set_if_present(r2_config, "runtimeEnvObjectKey", get_secret_text("EASYSMS_R2_CONFIG_ENV_OBJECT_KEY"))
    set_if_present(r2_config, "userscriptSettingsObjectKey", get_secret_text("EASYSMS_R2_CONFIG_USERSCRIPT_OBJECT_KEY"))
    set_if_present(r2_config, "manifestObjectKey", get_secret_text("EASYSMS_R2_CONFIG_MANIFEST_OBJECT_KEY"))
    set_if_present(r2_config, "uploadAccessKeyId", get_secret_text("EASYSMS_R2_CONFIG_UPLOAD_ACCESS_KEY_ID"))
    set_if_present(r2_config, "uploadSecretAccessKey", get_secret_text("EASYSMS_R2_CONFIG_UPLOAD_SECRET_ACCESS_KEY"))
    set_if_present(r2_config, "readAccessKeyId", get_secret_text("EASYSMS_R2_CONFIG_READ_ACCESS_KEY_ID"))
    set_if_present(r2_config, "readSecretAccessKey", get_secret_text("EASYSMS_R2_CONFIG_READ_SECRET_ACCESS_KEY"))
    set_if_present(r2_config, "importCodeOwnerPublicKey", get_secret_text("EASYSMS_R2_CONFIG_IMPORT_CODE_OWNER_PUBLIC_KEY"))
    set_if_present(r2_config, "syncEnabled", parse_bool_secret("EASYSMS_R2_CONFIG_SYNC_ENABLED"))
    set_if_present(r2_config, "syncIntervalSeconds", parse_int_secret("EASYSMS_R2_CONFIG_SYNC_INTERVAL_SECONDS"))
    if not r2_config:
        return None

    return {"publishing": {"r2Config": r2_config}}


def main() -> int:
    parser = argparse.ArgumentParser(description="Materialize a deployable EasySms config from GitHub Actions secrets.")
    parser.add_argument("--base-config", required=True, help="Path to the base config YAML to merge onto.")
    parser.add_argument("--output", required=True, help="Path to the generated root config.yaml.")
    args = parser.parse_args()

    base_config = load_yaml_file(Path(args.base_config))
    overlays = [build_service_overlay(), build_userscript_overlay(), build_r2_overlay()]
    overlays = [overlay for overlay in overlays if overlay]

    if not overlays:
        raise SystemExit(
            "Missing GitHub Actions config secrets. Set one or more EASYSMS_SERVICE_*, EASYSMS_PROVIDER_*, EASYSMS_USERSCRIPT_*, or EASYSMS_R2_CONFIG_* granular secrets."
        )

    merged_config = base_config
    for overlay in overlays:
        merged_config = deep_merge(merged_config, overlay)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        yaml.safe_dump(merged_config, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
