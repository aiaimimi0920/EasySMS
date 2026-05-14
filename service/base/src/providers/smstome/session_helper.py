from __future__ import annotations

import argparse
import re
import sys
from typing import Tuple

from curl_cffi import requests


SIGN_IN_URL = "https://smstome.com/sign-in"
DEFAULT_IMPERSONATION_PROFILES = [
    "chrome101",
    "edge101",
    "chrome99",
    "chrome136",
]


def extract_login_challenge(html: str) -> Tuple[str, str, str]:
    token_match = re.search(r'name="_token"\s+value="([^"]+)"', html, re.IGNORECASE)
    csrf_v_match = re.search(r'name="csrf_v"\s+value="([^"]+)"', html, re.IGNORECASE)
    prompt_match = re.search(r'What is\s+(\d+)\s*([+\-])\s*(\d+)\?', html, re.IGNORECASE)

    if not token_match or not csrf_v_match or not prompt_match:
        raise RuntimeError("smstome login challenge is missing expected form fields.")

    left = int(prompt_match.group(1))
    operator = prompt_match.group(2)
    right = int(prompt_match.group(3))
    answer = str(left + right) if operator == "+" else str(left - right)

    return token_match.group(1), csrf_v_match.group(1), answer


def login(session: requests.Session, email: str, password: str) -> None:
    response = session.get(SIGN_IN_URL, headers={"Referer": "https://smstome.com/"})
    response.raise_for_status()
    token, csrf_v, answer = extract_login_challenge(response.text)

    post_response = session.post(
        SIGN_IN_URL,
        data={
            "_token": token,
            "csrf_v": csrf_v,
            "email": email,
            "password": password,
            "captcha": answer,
        },
        headers={"Referer": SIGN_IN_URL},
    )
    post_response.raise_for_status()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=15)
    parser.add_argument("--login-email")
    parser.add_argument("--login-password")
    parser.add_argument("--impersonate-profile", action="append", dest="impersonation_profiles")
    args = parser.parse_args()

    profiles = args.impersonation_profiles or DEFAULT_IMPERSONATION_PROFILES
    last_error: Exception | None = None

    for profile in profiles:
        try:
            session = requests.Session(
                impersonate=profile,
                timeout=args.timeout_seconds,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "User-Agent": "Mozilla/5.0",
                },
            )

            if args.login_email and args.login_password:
                login(session, args.login_email, args.login_password)

            response = session.get(args.url, headers={"Referer": "https://smstome.com/"})
            response.raise_for_status()

            sys.stdout.write(response.text)
            return 0
        except Exception as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("No impersonation profiles were configured for smstome.")


if __name__ == "__main__":
    raise SystemExit(main())
