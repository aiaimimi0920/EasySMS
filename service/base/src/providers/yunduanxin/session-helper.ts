import type { EasySmsRuntimeConfig } from "../../domain/models.js";
import { WebHttpSession, type FetchLike } from "../../shared/index.js";

const yunDuanXinHardAccessGatePattern =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|access denied/i;
const yunDuanXinChallengeMarkerPattern =
  /cf-chl|cf-turnstile|challenge-platform|cloudflare ray id/i;
const yunDuanXinNormalContentPattern =
  /number-boxes-item|row border-bottom table-hover|在线接收短信验证码|收到的短信列表/i;

export function detectYunDuanXinAccessGateHtml(html: string): boolean {
  const source = String(html ?? "");
  if (!source.trim()) {
    return false;
  }
  if (yunDuanXinNormalContentPattern.test(source)) {
    return false;
  }
  return yunDuanXinHardAccessGatePattern.test(source)
    || (
      /captcha/i.test(source)
      && /cloudflare|challenge|turnstile/i.test(source)
      && yunDuanXinChallengeMarkerPattern.test(source)
    );
}

export async function fetchYunDuanXinHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  fetchImpl?: FetchLike,
): Promise<string> {
  const session = new WebHttpSession(fetchImpl);
  return session.getText(url, {
    timeoutMs: Math.max(5_000, config.scraping.requestTimeoutMs),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": config.scraping.userAgent,
    },
  });
}
