import argparse
import sys

from curl_cffi import requests

LOGIN_URL = "https://receive-smss.com/login/"


def build_headers(referer: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0"
        ),
    }
    if referer:
        headers["Referer"] = referer
    return headers


def login(session: requests.Session, username: str, password: str, timeout_seconds: int) -> None:
    session.get(LOGIN_URL, headers=build_headers(), timeout=timeout_seconds)
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
            **build_headers(LOGIN_URL),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        allow_redirects=True,
        timeout=timeout_seconds,
    )
    response.raise_for_status()

    if not any(cookie.name.startswith("wordpress_logged_in_") for cookie in session.cookies.jar):
        raise RuntimeError("Receive-SMSS login did not establish a wordpress_logged_in session cookie.")


def fetch_html(url: str, timeout_seconds: int, username: str | None, password: str | None) -> str:
    session = requests.Session(impersonate="chrome146")
    if username and password:
        login(session, username, password, timeout_seconds)
    response = session.get(url, headers=build_headers(url), timeout=timeout_seconds)
    response.raise_for_status()
    return response.text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--login-username")
    parser.add_argument("--login-password")
    args = parser.parse_args()

    try:
        html = fetch_html(
            args.url,
            max(5, int(args.timeout_seconds)),
            args.login_username,
            args.login_password,
        )
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        return 1

    sys.stdout.write(html)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
