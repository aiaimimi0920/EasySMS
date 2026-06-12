from __future__ import annotations

import argparse
import sys

from curl_cffi import requests

DEFAULT_IMPERSONATION_PROFILES = [
    "chrome120",
    "chrome136",
    "chrome104",
    "safari17_0",
    "chrome146",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=15)
    parser.add_argument("--impersonate-profile", action="append", dest="impersonation_profiles")
    args = parser.parse_args()

    profiles = args.impersonation_profiles or DEFAULT_IMPERSONATION_PROFILES
    last_error: Exception | None = None

    for profile in profiles:
        try:
            response = requests.get(
                args.url,
                impersonate=profile,
                timeout=args.timeout_seconds,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Referer": "https://sms24.me/en",
                },
            )
            response.raise_for_status()

            sys.stdout.write(response.text)
            return 0
        except Exception as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    raise RuntimeError("No impersonation profiles were configured for sms24.")


if __name__ == "__main__":
    raise SystemExit(main())
