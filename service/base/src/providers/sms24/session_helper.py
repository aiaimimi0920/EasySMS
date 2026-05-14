from __future__ import annotations

import argparse
import sys

from curl_cffi import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=15)
    args = parser.parse_args()

    response = requests.get(
        args.url,
        impersonate="chrome146",
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


if __name__ == "__main__":
    raise SystemExit(main())
