import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { WebHttpSession, type FetchLike } from "../../shared/index.js";

const LOGIN_URL = "https://receive-smss.com/login/";

const receiveSmssAccessGatePattern =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|正在进行安全验证/i;

const receiveSmssHeaderModes = [
  "full-no-ua",
  "no-headers",
  "accept-only",
  "legacy",
] as const;

export type ReceiveSmssHeaderMode = (typeof receiveSmssHeaderModes)[number];

export interface ReceiveSmssAuthConfig {
  username?: string;
  password?: string;
}

export interface ReceiveSmssLoginPayload {
  log: string;
  pwd: string;
  redirect_to: string;
  instance: string;
  action: "login";
}

export function buildReceiveSmssLoginPayload(
  username: string,
  password: string,
): ReceiveSmssLoginPayload {
  return {
    log: String(username).trim(),
    pwd: String(password),
    redirect_to: "/",
    instance: "",
    action: "login",
  };
}

export function detectReceiveSmssAccessGateHtml(html: string): boolean {
  return receiveSmssAccessGatePattern.test(String(html ?? ""));
}

export function getReceiveSmssHeaderModes(): ReceiveSmssHeaderMode[] {
  return [...receiveSmssHeaderModes];
}

export function resolveReceiveSmssAuthConfig(
  config: EasySmsRuntimeConfig,
): ReceiveSmssAuthConfig | undefined {
  const username = config.providers.receiveSmss.username?.trim();
  const password = config.providers.receiveSmss.password?.trim();
  if (!username || !password) {
    return undefined;
  }

  return { username, password };
}

function buildHeaders(headerMode: ReceiveSmssHeaderMode, referer?: string): Record<string, string> {
  let headers: Record<string, string>;
  if (headerMode === "no-headers") {
    headers = {};
  } else if (headerMode === "accept-only") {
    headers = {
      Accept: "text/html,application/xhtml+xml",
    };
  } else if (headerMode === "legacy") {
    headers = {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    };
  } else {
    headers = {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };
  }

  if (referer && headerMode !== "no-headers") {
    headers.Referer = referer;
  }
  return headers;
}

function shouldRetryReceiveSmssAnonymously(error: Error): boolean {
  const normalized = error.message.toLowerCase();
  return normalized.includes("http error 403")
    || normalized.includes("forbidden")
    || normalized.includes("login did not establish")
    || normalized.includes("just a moment")
    || normalized.includes("cloudflare");
}

async function attemptReceiveSmssFetch(
  url: string,
  headerMode: ReceiveSmssHeaderMode,
  loginPayload: ReceiveSmssLoginPayload | undefined,
  timeoutMs: number,
  fetchImpl?: FetchLike,
): Promise<string> {
  const session = new WebHttpSession(fetchImpl);
  if (loginPayload) {
    const loginPage = await session.request(LOGIN_URL, {
      method: "GET",
      timeoutMs,
      headers: buildHeaders(headerMode),
    });
    if (!loginPage.ok) {
      throw new Error(`HTTP Error ${loginPage.status}: ${loginPage.statusText || "Login page blocked"}`);
    }

    const encodedForm = new URLSearchParams({
      log: loginPayload.log,
      pwd: loginPayload.pwd,
      redirect_to: loginPayload.redirect_to,
      instance: loginPayload.instance,
      action: loginPayload.action,
    }).toString();

    const loginResponse = await session.request(LOGIN_URL, {
      method: "POST",
      timeoutMs,
      headers: {
        ...buildHeaders(headerMode, LOGIN_URL),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodedForm,
    });
    if (!loginResponse.ok) {
      throw new Error(`HTTP Error ${loginResponse.status}: ${loginResponse.statusText || "Login rejected"}`);
    }
    if (!session.cookies.hasCookiePrefix("wordpress_logged_in_")) {
      throw new Error("Receive-SMSS login did not establish a wordpress_logged_in session cookie.");
    }
  }

  return session.getText(url, {
    timeoutMs,
    headers: buildHeaders(headerMode, url),
  });
}

export async function fetchReceiveSmssHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: ReceiveSmssAuthConfig | undefined,
  fetchImpl?: FetchLike,
): Promise<string> {
  const loginPayload = auth?.username && auth?.password
    ? buildReceiveSmssLoginPayload(auth.username, auth.password)
    : undefined;

  const totalTimeoutMs = Math.max(5_000, config.scraping.requestTimeoutMs);
  const deadlineAtMs = Date.now() + totalTimeoutMs;
  let lastError: Error | undefined;

  for (const headerMode of getReceiveSmssHeaderModes()) {
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    const attemptTimeoutMs = Math.max(2_500, Math.min(remainingMs, 10_000));
    try {
      return await attemptReceiveSmssFetch(url, headerMode, loginPayload, attemptTimeoutMs, fetchImpl);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (loginPayload && shouldRetryReceiveSmssAnonymously(lastError)) {
        const fallbackRemainingMs = deadlineAtMs - Date.now();
        if (fallbackRemainingMs <= 0) {
          break;
        }
        const fallbackTimeoutMs = Math.max(2_500, Math.min(fallbackRemainingMs, 10_000));
        try {
          return await attemptReceiveSmssFetch(url, headerMode, undefined, fallbackTimeoutMs, fetchImpl);
        } catch (anonymousError) {
          lastError = anonymousError instanceof Error ? anonymousError : new Error(String(anonymousError));
        }
      }
    }
  }

  throw lastError ?? new Error(`Timed out fetching ${url} via receive_smss HTTP session.`);
}
