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
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";
import {
  fetchSmsToMeHtml,
  isSmsToMeAccessGateHtml,
  resolveSmsToMeAuthConfig,
} from "./session-helper.js";

const providerHomepageUrl = "https://smstome.com";
const smsToMeVerificationFreshnessWindowMs = 30 * 60 * 1000;
const smsToMeVerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|c[oó]digo|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;

export class SmsToMeProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "smstome",
    displayName: "SMSToMe",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["United Kingdom", "Finland", "Belgium", "Netherlands", "Slovenia", "Poland"],
    notes: [
      "As of 2026-05-13, this source is usable in service/base without a browser by replaying the site sign-in form over curl_cffi-backed HTTP fetches.",
      "Country pages and inbox pages are both gated behind a free account, so providers.smsToMe.email/password should be configured.",
      "Numbers are considered live only when a verification-like SMS appeared within the last 30 minutes.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const root = await this.fetchDocument(this.descriptor.homepageUrl);
    const countryPages = this.parseCountryPages(root);
    const filteredCountryPages = countryPages.filter((country) =>
      matchesCountryFilter(country.countryCode, country.countryName, options.countryCode, options.countryName)
    );

    const candidates: SmsPublicNumber[] = [];
    for (const country of filteredCountryPages) {
      const $ = await this.fetchDocument(country.sourceUrl);
      $("article.cp-phone-card").each((_, element) => {
        const phoneHref = $(element).find("a.cp-phone-card__number").attr("href");
        const phoneNumber = normalizeText($(element).find("a.cp-phone-card__number").first().text());
        const latestActivityText = normalizeText($(element).find(".cp-phone-card__meta").first().text());
        if (!phoneHref || !phoneNumber) {
          return;
        }

        candidates.push({
          providerKey: this.descriptor.key,
          providerDisplayName: this.descriptor.displayName,
          numberId: encodeNumberId({
            providerKey: this.descriptor.key,
            sourceUrl: resolveAbsoluteUrl(this.descriptor.homepageUrl, phoneHref),
            phoneNumber,
            countryName: country.countryName,
            countryCode: country.countryCode,
          }),
          sourceUrl: resolveAbsoluteUrl(this.descriptor.homepageUrl, phoneHref),
          phoneNumber,
          countryName: country.countryName,
          countryCode: country.countryCode,
          latestActivityText,
        });
      });
    }

    return filterSmsToMeLiveNumbers(
      dedupeAndLimit(candidates, Math.max(options.limit ?? this.config.scraping.maxNumbersPerProvider, 30)),
      async (numberId) => this.getInbox(numberId),
      options.limit ?? this.config.scraping.maxNumbersPerProvider,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await this.fetchDocument(reference.sourceUrl);
    const messages: SmsInboxMessage[] = [];

    $(".mp-table tbody tr").each((index, element) => {
      const columns = $(element).children("td");
      const sender = normalizeText($(columns[0]).text());
      const receivedAtText = normalizeText($(columns[1]).text());
      const content = normalizeText($(columns[2]).text());
      if (!sender || !receivedAtText || !content) {
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
    const html = await fetchSmsToMeHtml(url, this.config, resolveSmsToMeAuthConfig(this.config));
    if (isSmsToMeAccessGateHtml(html)) {
      throw new Error(`SMSToMe route requires configured login credentials: ${url}`);
    }
    return load(html);
  }

  private parseCountryPages($: ReturnType<typeof load>): Array<{
    sourceUrl: string;
    countryName: string;
    countryCode?: string;
  }> {
    const results: Array<{ sourceUrl: string; countryName: string; countryCode?: string }> = [];

    $("a[href^='/country/']").each((_, element) => {
      const href = $(element).attr("href");
      const text = normalizeText($(element).text());
      if (!href || !text) {
        return;
      }

      const countryName = normalizeText(text.replace(/\(\+\d+\)|\+\d+/g, ""));
      const countryCode = inferCountryCode(countryName) ?? text.match(/\+\d+/)?.[0];
      results.push({
        sourceUrl: resolveAbsoluteUrl(this.descriptor.homepageUrl, href),
        countryName,
        countryCode,
      });
    });

    const deduped = new Map<string, { sourceUrl: string; countryName: string; countryCode?: string }>();
    for (const item of results) {
      if (!deduped.has(item.sourceUrl)) {
        deduped.set(item.sourceUrl, item);
      }
    }

    return Array.from(deduped.values());
  }
}

export function isSmsToMeVerificationLikeMessage(
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

  return smsToMeVerificationKeywordPattern.test(text);
}

export function parseSmsToMeRelativeAgeMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim().toLowerCase();
  if (text.includes("just now")) {
    return 0;
  }

  const amountMatch = text.match(/(\d+)/);
  const amount = amountMatch ? Number.parseInt(amountMatch[1] ?? "", 10) : 1;
  if (text.includes("sec")) return amount * 1000;
  if (text.includes("min")) return amount * 60 * 1000;
  if (text.includes("hour")) return amount * 60 * 60 * 1000;
  if (text.includes("day")) return amount * 24 * 60 * 60 * 1000;
  if (text.includes("month")) return amount * 30 * 24 * 60 * 60 * 1000;
  if (text.includes("year")) return amount * 365 * 24 * 60 * 60 * 1000;
  return undefined;
}

export function hasRecentSmsToMeVerificationActivity(
  messages: SmsInboxMessage[],
  freshnessWindowMs: number = smsToMeVerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = messages.find((message) =>
    isSmsToMeVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseSmsToMeRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined && ageMs <= freshnessWindowMs;
}

export async function filterSmsToMeLiveNumbers(
  candidates: SmsPublicNumber[],
  getInbox: (numberId: string) => Promise<SmsInboxSnapshot>,
  limit: number = Number.MAX_SAFE_INTEGER,
): Promise<SmsPublicNumber[]> {
  const results: SmsPublicNumber[] = [];

  for (const candidate of candidates) {
    try {
      const inbox = await getInbox(candidate.numberId);
      const latestVerificationMessage = inbox.messages.find((message) =>
        isSmsToMeVerificationLikeMessage(message)
      );
      if (!latestVerificationMessage) {
        continue;
      }

      const ageMs = parseSmsToMeRelativeAgeMs(latestVerificationMessage.receivedAtText);
      if (ageMs === undefined || ageMs > smsToMeVerificationFreshnessWindowMs) {
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
