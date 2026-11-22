import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { WebHttpSession, type FetchLike } from "../../shared/index.js";

const SIGN_IN_URL = "https://smstome.com/sign-in";

const smsToMeAccessGatePattern =
  /please log in to view messages for this number|require a free account to access/i;

const smsToMeCaptchaGatePattern =
  /what is\s+\d+\s*[+\-]\s*\d+\?|g-recaptcha|cf-turnstile|h-captcha|captcha/i;

export interface SmsToMeAuthConfig {
  email?: string;
  password?: string;
}

export function isSmsToMeAccessGateHtml(html: string): boolean {
  return smsToMeAccessGatePattern.test(String(html ?? ""));
}

export function detectSmsToMeCaptchaChallenge(html: string): boolean {
  return smsToMeCaptchaGatePattern.test(String(html ?? ""));
}

export function resolveSmsToMeAuthConfig(
  config: EasySmsRuntimeConfig,
): SmsToMeAuthConfig | undefined {
  const email = config.providers.smsToMe.email?.trim();
  const password = config.providers.smsToMe.password?.trim();
  if (!email || !password) {
    return undefined;
  }

  return { email, password };
}

export async function fetchSmsToMeHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: SmsToMeAuthConfig | undefined,
  fetchImpl?: FetchLike,
): Promise<string> {
  const timeoutMs = Math.max(5_000, config.scraping.requestTimeoutMs);
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": config.scraping.userAgent,
  };
  const session = new WebHttpSession(fetchImpl);

  const initialHtml = await session.getText(url, { timeoutMs, headers });
  if (!isSmsToMeAccessGateHtml(initialHtml)) {
    return initialHtml;
  }

  if (!auth?.email || !auth?.password) {
    return initialHtml;
  }

  const signInHtml = await session.getText(SIGN_IN_URL, {
    timeoutMs,
    headers: { ...headers, Referer: "https://smstome.com/" },
  });

  if (detectSmsToMeCaptchaChallenge(signInHtml)) {
    throw new Error("SMSToMe login page requires interactive captcha verification.");
  }

  const csrfToken = signInHtml.match(/name="_token"\s+value="([^"]+)"/i)?.[1]?.trim();
  if (!csrfToken) {
    throw new Error("SMSToMe sign-in form is missing expected CSRF token.");
  }

  const formBody = new URLSearchParams({
    _token: csrfToken,
    email: auth.email,
    password: auth.password,
  }).toString();

  const loginResponse = await session.request(SIGN_IN_URL, {
    method: "POST",
    timeoutMs,
    headers: {
      ...headers,
      Referer: SIGN_IN_URL,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody,
  });
  if (!loginResponse.ok) {
    throw new Error(`HTTP Error ${loginResponse.status}: ${loginResponse.statusText || "SMSToMe login failed"}`);
  }

  return session.getText(url, {
    timeoutMs,
    headers: { ...headers, Referer: "https://smstome.com/" },
  });
}
