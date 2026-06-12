import argparse
import sys

from curl_cffi import requests

LOGIN_URL = "https://receive-smss.com/login/"
DEFAULT_IMPERSONATION_PROFILES = [
    "chrome123",
    "chrome124",
    "chrome146",
    "chrome120",
]
DEFAULT_HEADER_MODES = [
    "full-no-ua",
    "no-headers",
    "accept-only",
    "legacy",
]


def build_headers(referer: str | None = None, header_mode: str = "full-no-ua") -> dict[str, str]:
    if header_mode == "no-headers":
        return {}

    if header_mode == "accept-only":
        headers = {
            "Accept": "text/html,application/xhtml+xml",
        }
    elif header_mode == "legacy":
        headers = {
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0"
            ),
        }
    else:
        headers = {
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        }

    if referer:
        headers["Referer"] = referer
    return headers


def login(session: requests.Session, username: str, password: str, timeout_seconds: int, header_mode: str) -> None:
    session.get(LOGIN_URL, headers=build_headers(header_mode=header_mode), timeout=timeout_seconds)
    payload = {
        "log": username,
        "pwd": password,
        "redirect_to": "/",
        "instance": "",
        "action": "login",
    }
    response = session.post(
        LOGIN_URL,
        data=payload,
        headers={
            **build_headers(LOGIN_URL, header_mode),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        allow_redirects=True,
        timeout=timeout_seconds,
    )
    response.raise_for_status()

    if not any(cookie.name.startswith("wordpress_logged_in_") for cookie in session.cookies.jar):
        raise RuntimeError("Receive-SMSS login did not establish a wordpress_logged_in session cookie.")


def fetch_html(
    url: str,
    timeout_seconds: int,
    username: str | None,
    password: str | None,
    impersonation_profile: str,
    header_mode: str,
) -> str:
    session = requests.Session(impersonate=impersonation_profile)
    if username and password:
        login(session, username, password, timeout_seconds, header_mode)
    response = session.get(url, headers=build_headers(url, header_mode), timeout=timeout_seconds)
    response.raise_for_status()
    return response.text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--login-username")
    parser.add_argument("--login-password")
    parser.add_argument("--impersonate-profile", action="append", dest="impersonation_profiles")
    parser.add_argument("--header-mode", action="append", dest="header_modes")
    args = parser.parse_args()

    profiles = args.impersonation_profiles or DEFAULT_IMPERSONATION_PROFILES
    header_modes = args.header_modes or DEFAULT_HEADER_MODES
    last_error: Exception | None = None

    for profile in profiles:
        for header_mode in header_modes:
            try:
                html = fetch_html(
                    args.url,
                    max(5, int(args.timeout_seconds)),
                    args.login_username,
                    args.login_password,
                    profile,
                    header_mode,
                )
                sys.stdout.write(html)
                return 0
            except Exception as exc:  # pragma: no cover
                last_error = exc
                continue

    if last_error is not None:
        print(str(last_error), file=sys.stderr)
        return 1
    print("No impersonation profiles were configured for receive_smss.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
