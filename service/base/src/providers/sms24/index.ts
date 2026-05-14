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
import { detectSms24AccessGateHtml, fetchSms24Html } from "./session-helper.js";

const providerHomepageUrl = "https://sms24.me/en";
const sms24NumbersUrl = "https://sms24.me/en/numbers";
const sms24VerificationFreshnessWindowMs = 30 * 60 * 1000;
const sms24VerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;

export class Sms24Provider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "sms24",
    displayName: "SMS24.me",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["United States", "Canada", "Puerto Rico", "South Africa", "China", "Australia"],
    notes: [
      "As of 2026-05-13, this source is usable in service/base without a browser via curl_cffi-backed HTTP fetches that impersonate a modern browser TLS/session profile.",
      "The numbers list is exposed as ordinary HTML links under /en/numbers.",
      "Inbox entries are rendered as dt/dd pairs with sender and message text.",
      "Numbers are considered live only when a verification-like SMS appeared within the last 30 minutes.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const $ = await this.fetchDocument(sms24NumbersUrl);
    const results: SmsPublicNumber[] = [];

    $("a[href*='/en/numbers/']").each((_, element) => {
      const href = $(element).attr("href");
      const text = normalizeText($(element).text());
      const phoneNumber = normalizeText(text.match(/\+\d[\d\s]*/)?.[0]);
      const countryName = normalizeText(text.replace(phoneNumber, ""));
      const countryCode = inferCountryCode(countryName, phoneNumber);

      if (!href || !phoneNumber) {
        return;
      }

      if (!matchesCountryFilter(countryCode, countryName, options.countryCode, options.countryName)) {
        return;
      }

      const sourceUrl = resolveAbsoluteUrl(this.descriptor.homepageUrl, href);
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

    return filterSms24LiveNumbers(
      dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider),
      async (numberId) => this.getInbox(numberId),
      options.limit ?? this.config.scraping.maxNumbersPerProvider,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await this.fetchDocument(reference.sourceUrl);
    const messages: SmsInboxMessage[] = [];

    $("dt").each((index, element) => {
      const container = $(element).next("dd");
      const content = normalizeText(container.find(".text-break").first().text());
      if (!content || content === "Messages not yet received") {
        return;
      }

      const sender = normalizeText(container.find("a[title^='SMS From']").first().text()).replace(/^From:\s*/i, "");
      const receivedAtIso = normalizeText($(element).find("[data-created]").first().attr("data-created"));

      messages.push({
        id: `${reference.phoneNumber}-${index}`,
        sender,
        receivedAtIso: receivedAtIso || undefined,
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
    const html = await fetchSms24Html(url, this.config);
    if (detectSms24AccessGateHtml(html)) {
      throw new Error(`SMS24 route is currently gated by Cloudflare: ${url}`);
    }
    return load(html);
  }
}

export function isSms24VerificationLikeMessage(
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

  return sms24VerificationKeywordPattern.test(text);
}

function parseSms24ReceivedAtMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function hasRecentSms24VerificationActivity(
  messages: SmsInboxMessage[],
  now: Date = new Date(),
  freshnessWindowMs: number = sms24VerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = messages.find((message) =>
    isSms24VerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const receivedAtMs = parseSms24ReceivedAtMs(latestVerificationMessage.receivedAtIso);
  return receivedAtMs !== undefined
    ? (now.getTime() - receivedAtMs) <= freshnessWindowMs
    : false;
}

export async function filterSms24LiveNumbers(
  candidates: SmsPublicNumber[],
  getInbox: (numberId: string) => Promise<SmsInboxSnapshot>,
  limit: number = Number.MAX_SAFE_INTEGER,
  now: Date = new Date(),
): Promise<SmsPublicNumber[]> {
  const results: SmsPublicNumber[] = [];

  for (const candidate of candidates) {
    try {
      const inbox = await getInbox(candidate.numberId);
      const latestVerificationMessage = inbox.messages.find((message) =>
        isSms24VerificationLikeMessage(message)
      );
      if (!latestVerificationMessage) {
        continue;
      }

      const receivedAtMs = parseSms24ReceivedAtMs(latestVerificationMessage.receivedAtIso);
      if (receivedAtMs === undefined || (now.getTime() - receivedAtMs) > sms24VerificationFreshnessWindowMs) {
        continue;
      }

      results.push({
        ...candidate,
        latestActivityText: latestVerificationMessage.receivedAtIso ?? candidate.latestActivityText,
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
