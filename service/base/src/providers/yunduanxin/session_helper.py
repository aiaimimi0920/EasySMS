from __future__ import annotations

import argparse
import sys
import time

from curl_cffi import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=15)
    args = parser.parse_args()

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://yunduanxin.net/",
    }

    last_error: Exception | None = None
    for _ in range(3):
        try:
            response = requests.get(
                args.url,
                impersonate="chrome136",
                timeout=args.timeout_seconds,
                headers=headers,
            )
            response.raise_for_status()
            sys.stdout.write(response.text)
            return 0
        except Exception as error:  # pragma: no cover - helper-side retry
            last_error = error
            time.sleep(0.6)

    raise last_error if last_error is not None else RuntimeError("Unknown yunduanxin helper failure")


if __name__ == "__main__":
    raise SystemExit(main())
