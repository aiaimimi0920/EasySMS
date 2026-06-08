import { load } from "cheerio";

import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxMessage,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../domain/models.js";
import {
  decodeNumberId,
  dedupeAndLimit,
  encodeNumberId,
  inferCountryCode,
  matchesCountryFilter,
  normalizeText,
  resolveAbsoluteUrl,
  withProviderRequestTimeout,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";
import { detectYunDuanXinAccessGateHtml, fetchYunDuanXinHtml } from "./session-helper.js";

const providerHomepageUrl = "https://yunduanxin.net";
const yunDuanXinVerificationFreshnessWindowMs = 30 * 60 * 1000;
const yunDuanXinVerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|c[oó]digo|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;

export class YunDuanXinProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "yunduanxin",
    displayName: "云短信",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["美国", "法国", "英国", "中国", "西班牙", "瑞典", "荷兰"],
    notes: [
      "As of 2026-05-13, this source is usable in service/base without a browser via curl_cffi-backed HTTP fetches that impersonate a modern browser TLS/session profile.",
      "Home page exposes public numbers as card blocks.",
      "Message pages are directly readable without a hidden API.",
      "Numbers are considered live only when a verification-like SMS appeared within the last 30 minutes.",
    ],
  };

  private readonly config: EasySmsRuntimeConfig;

  constructor(config: EasySmsRuntimeConfig) {
    this.config = withProviderRequestTimeout(config, this.descriptor.key);
  }

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const $ = await this.fetchDocument(this.descriptor.homepageUrl);
    const results: SmsPublicNumber[] = [];

    $(".number-boxes-item").each((_, element) => {
      const href = $(element).find("a[href*='/info/']").attr("href");
      const phoneNumber = normalizeText($(element).find(".number-boxes-item-number").text());
      const countryName = normalizeText($(element).find(".number-boxes-item-country").text());
      const sourceUrl = href ? resolveAbsoluteUrl(this.descriptor.homepageUrl, href) : "";
      const countryCode = inferCountryCode(countryName, phoneNumber);

      if (!href || !phoneNumber) {
        return;
      }

      if (!matchesCountryFilter(countryCode, countryName, options.countryCode, options.countryName)) {
        return;
      }

      results.push({
        providerKey: this.descriptor.key,
        providerDisplayName: this.descriptor.displayName,
        numberId: encodeNumberId({
          providerKey: this.descriptor.key,
          sourceUrl,
          phoneNumber,
          countryName,
          countryCode,
        }),
        sourceUrl,
        phoneNumber,
        countryName,
        countryCode,
      });
    });

    return filterYunDuanXinLiveNumbers(
      dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider),
      async (numberId) => this.getInbox(numberId),
      options.limit ?? this.config.scraping.maxNumbersPerProvider,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await this.fetchDocument(reference.sourceUrl);
    const messages: SmsInboxMessage[] = [];

    $(".row.border-bottom.table-hover").each((index, element) => {
      const columns = $(element).children("div");
      const sender = normalizeText($(columns[0]).find(".mobile_hide").first().text());
      const receivedAtText = normalizeText($(columns[1]).text());
      const content = normalizeText($(columns[2]).text());

      if (!content) {
        return;
      }

      messages.push({
        id: `${reference.phoneNumber}-${index}`,
        sender,
        receivedAtText,
        content,
        sourceUrl: reference.sourceUrl,
      });
    });

    return {
      providerKey: this.descriptor.key,
      providerDisplayName: this.descriptor.displayName,
      numberId,
      phoneNumber: reference.phoneNumber,
      countryName: reference.countryName,
      countryCode: reference.countryCode ?? inferCountryCode(reference.countryName, reference.phoneNumber),
      sourceUrl: reference.sourceUrl,
      fetchedAtIso: new Date().toISOString(),
      messages,
    };
  }

  private async fetchDocument(url: string) {
    const html = await fetchYunDuanXinHtml(url, this.config);
    if (detectYunDuanXinAccessGateHtml(html)) {
      throw new Error(`YunDuanXin route is currently gated by Cloudflare: ${url}`);
    }
    return load(html);
  }
}

export function isYunDuanXinVerificationLikeMessage(
  message: Pick<SmsInboxMessage, "content">,
): boolean {
  const text = String(message.content ?? "").trim();
  if (!text) {
    return false;
  }

  const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
  if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) {
    return true;
  }

  return yunDuanXinVerificationKeywordPattern.test(text);
}

export function parseYunDuanXinRelativeAgeMs(value: string | undefined): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }

  const match = text.match(/(\d+)\s*(秒|分钟|分鐘|小时|小時|天|月|年)前/);
  if (!match) {
    return undefined;
  }

  const amount = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  const unit = match[2];
  const multiplier = unit === "秒"
    ? 1000
    : unit === "分钟" || unit === "分鐘"
      ? 60_000
      : unit === "小时" || unit === "小時"
        ? 60 * 60_000
        : unit === "天"
          ? 24 * 60 * 60_000
          : unit === "月"
            ? 30 * 24 * 60 * 60_000
            : 365 * 24 * 60 * 60_000;

  return amount * multiplier;
}

export function hasRecentYunDuanXinVerificationActivity(
  messages: SmsInboxMessage[],
  freshnessWindowMs: number = yunDuanXinVerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = messages.find((message) =>
    isYunDuanXinVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseYunDuanXinRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined && ageMs <= freshnessWindowMs;
}

export async function filterYunDuanXinLiveNumbers(
  candidates: SmsPublicNumber[],
  getInbox: (numberId: string) => Promise<SmsInboxSnapshot>,
  limit: number = Number.MAX_SAFE_INTEGER,
): Promise<SmsPublicNumber[]> {
  const results: SmsPublicNumber[] = [];

  for (const candidate of candidates) {
    try {
      const inbox = await getInbox(candidate.numberId);
      const latestVerificationMessage = inbox.messages.find((message) =>
        isYunDuanXinVerificationLikeMessage(message)
      );
      if (!latestVerificationMessage) {
        continue;
      }

      const ageMs = parseYunDuanXinRelativeAgeMs(latestVerificationMessage.receivedAtText);
      if (ageMs === undefined || ageMs > yunDuanXinVerificationFreshnessWindowMs) {
        continue;
      }

      results.push({
        ...candidate,
        latestActivityText: latestVerificationMessage.receivedAtText ?? candidate.latestActivityText,
      });

      if (results.length >= limit) {
        break;
      }
    } catch {
      // Ignore candidates whose inbox cannot be inspected in the current runtime mode.
    }
  }

  return results;
}
