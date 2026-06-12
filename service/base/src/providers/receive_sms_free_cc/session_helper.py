from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from curl_cffi import requests


HTML_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
}

LOGIN_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    "Content-Type": "application/json",
    "Origin": "https://receive-sms-free.cc",
    "Referer": "https://receive-sms-free.cc/auth/login",
    "X-Requested-With": "XMLHttpRequest",
}

ACCESS_GATE_MARKER = (
    "Unfortunately, Due To Security Concerns, Virtual Numbers Are Required To "
    "register Or login In Before Accessing The Content."
)

DEFAULT_IMPERSONATION_PROFILES = [
    "chrome136",
    "chrome123",
    "chrome107",
    "chrome99",
    "safari17_0",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--login-email", default="")
    parser.add_argument("--login-password-md5", default="")
    parser.add_argument("--impersonate-profile", action="append", dest="impersonation_profiles")
    return parser


def request_page(session: requests.Session, url: str) -> str:
    response = session.get(url, headers=HTML_HEADERS)
    response.raise_for_status()
    return response.text


def login(session: requests.Session, email: str, password_md5: str) -> None:
    bootstrap = session.get("https://receive-sms-free.cc/auth/login", headers=HTML_HEADERS)
    bootstrap.raise_for_status()

    response = session.post(
        "https://receive-sms-free.cc/ajax/login",
        headers=LOGIN_HEADERS,
        data=json.dumps({
            "mail": email,
            "password": password_md5,
        }),
    )
    response.raise_for_status()
    payload: dict[str, Any] = response.json()
    if payload.get("status") is not True:
        raise RuntimeError(
            f"receive_sms_free_cc login failed: {payload.get('Msg') or payload.get('result') or 'unknown error'}"
        )


def main() -> int:
    args = build_parser().parse_args()

    profiles = args.impersonation_profiles or DEFAULT_IMPERSONATION_PROFILES
    last_error: Exception | None = None

    for profile in profiles:
        try:
            session = requests.Session(
                impersonate=profile,
                timeout=max(5, args.timeout_seconds),
            )

            if args.login_email and args.login_password_md5:
                login(session, args.login_email, args.login_password_md5)
                html = request_page(session, args.url)
            else:
                html = request_page(session, args.url)

            print(html, end="")
            return 0
        except Exception as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("No impersonation profiles were configured for receive_sms_free_cc.")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # pragma: no cover - process entrypoint
        print(str(error), file=sys.stderr)
        raise
