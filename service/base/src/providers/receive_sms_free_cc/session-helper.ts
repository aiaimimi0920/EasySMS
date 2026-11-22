import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { WebHttpSession, md5Hex, type FetchLike } from "../../shared/index.js";

const receiveSmsFreeCcAccessGatePattern =
  /virtual numbers are required to .*register.*or .*login.*before accessing the content/i;

const HTML_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

const LOGIN_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://receive-sms-free.cc",
  Referer: "https://receive-sms-free.cc/auth/login",
  "X-Requested-With": "XMLHttpRequest",
};

export interface ReceiveSmsFreeCcLoginPayload {
  mail: string;
  password: string;
}

export interface ReceiveSmsFreeCcAuthConfig {
  email?: string;
  password?: string;
}

export function buildReceiveSmsFreeCcLoginPayload(
  email: string,
  password: string,
): ReceiveSmsFreeCcLoginPayload {
  return {
    mail: String(email).trim(),
    password: md5Hex(String(password)),
  };
}

export function isReceiveSmsFreeCcAccessGateHtml(html: string): boolean {
  return receiveSmsFreeCcAccessGatePattern.test(String(html ?? ""));
}

export function resolveReceiveSmsFreeCcAuthConfig(
  config: EasySmsRuntimeConfig,
): ReceiveSmsFreeCcAuthConfig | undefined {
  const email = config.providers.receiveSmsFreeCc.email?.trim();
  const password = config.providers.receiveSmsFreeCc.password?.trim();
  if (!email || !password) {
    return undefined;
  }

  return { email, password };
}

export async function fetchReceiveSmsFreeCcHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: ReceiveSmsFreeCcAuthConfig | undefined,
  fetchImpl?: FetchLike,
): Promise<string> {
  const timeoutMs = Math.max(5_000, config.scraping.requestTimeoutMs);
  const userAgent = config.scraping.userAgent;
  const session = new WebHttpSession(fetchImpl);

  if (auth?.email && auth?.password) {
    const loginPayload = buildReceiveSmsFreeCcLoginPayload(auth.email, auth.password);
    const bootstrap = await session.request("https://receive-sms-free.cc/auth/login", {
      method: "GET",
      timeoutMs,
      headers: { ...HTML_HEADERS, "User-Agent": userAgent },
    });
    if (!bootstrap.ok) {
      throw new Error(`HTTP Error ${bootstrap.status}: ${bootstrap.statusText || "Login bootstrap failed"}`);
    }

    const loginResponse = await session.request("https://receive-sms-free.cc/ajax/login", {
      method: "POST",
      timeoutMs,
      headers: { ...LOGIN_HEADERS, "User-Agent": userAgent },
      body: JSON.stringify(loginPayload),
    });
    if (!loginResponse.ok) {
      throw new Error(`HTTP Error ${loginResponse.status}: ${loginResponse.statusText || "Login failed"}`);
    }
    const payload = await loginResponse.json() as { status?: boolean; Msg?: string; result?: string };
    if (payload.status !== true) {
      throw new Error(
        `receive_sms_free_cc login failed: ${payload.Msg || payload.result || "unknown error"}`,
      );
    }
  }

  return session.getText(url, {
    timeoutMs,
    headers: { ...HTML_HEADERS, "User-Agent": userAgent },
  });
}
