import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { WebHttpSession, type FetchLike } from "../../shared/index.js";

const sms24AccessGatePattern =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|captcha|access denied/i;

const sms24UserAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
] as const;

export function detectSms24AccessGateHtml(html: string): boolean {
  return sms24AccessGatePattern.test(String(html ?? ""));
}

export function getSms24UserAgents(): string[] {
  return [...sms24UserAgents];
}

export async function fetchSms24Html(
  url: string,
  config: EasySmsRuntimeConfig,
  fetchImpl?: FetchLike,
): Promise<string> {
  const timeoutMs = Math.max(5_000, config.scraping.requestTimeoutMs);
  let lastError: Error | undefined;

  for (const userAgent of sms24UserAgents) {
    const session = new WebHttpSession(fetchImpl);
    try {
      return await session.getText(url, {
        timeoutMs,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "User-Agent": userAgent,
        },
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error(`Failed to fetch sms24 page: ${url}`);
}
