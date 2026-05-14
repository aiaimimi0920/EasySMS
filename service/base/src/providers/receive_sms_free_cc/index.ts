import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxMessage,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../domain/models.js";
import type { SmsProvider } from "../contracts.js";
import { load } from "cheerio";
import { inferCountryCode, matchesCountryFilter, normalizeText, resolveAbsoluteUrl } from "../../shared/index.js";
import { TempLikeProvider } from "../shared/temp-like-provider.js";
import {
  fetchReceiveSmsFreeCcHtml,
  resolveReceiveSmsFreeCcAuthConfig,
} from "./session-helper.js";

const receiveSmsFreeCcVerificationFreshnessWindowMs = 30 * 60 * 1000;
const receiveSmsFreeCcVerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;
const receiveSmsFreeCcHomepageUrl = "https://receive-sms-free.cc/";
const receiveSmsFreeCcRegionsUrl = "https://receive-sms-free.cc/regions/";
const receiveSmsFreeCcCountryDirectoryLinkPattern = /\/Free-[A-Za-z-]+-Phone-Number\/$/i;

const descriptor: ProviderDescriptor = {
  key: "receive_sms_free_cc",
  displayName: "Receive-SMS-Free.cc",
  homepageUrl: "https://receive-sms-free.cc",
  sourceType: "public-web-scrape",
  costTier: "free",
  capabilities: ["list-public-numbers", "read-public-inbox"],
  enabled: true,
  countryHints: ["United States", "United Kingdom", "Finland", "Netherlands", "Slovenia"],
  notes: [
    "Template is very similar to temporary-phone-number.com, so the same parser is reused.",
    "As of 2026-05-13, this source is usable in service/base without a browser by replaying the site's real HTTP login flow and then reading the protected number page in the same session.",
    "When providers.receiveSmsFreeCc.email/password are configured, all page fetches use the same HTTP login bootstrap before reading the target number page.",
    "Numbers are considered live only when a verification-like SMS appeared within the last 30 minutes.",
    "This provider is enabled by default in the runtime catalog, but protected regions still require configured site credentials for reliable reads.",
  ],
};

export class ReceiveSmsFreeCcProvider implements SmsProvider {
  readonly descriptor = descriptor;
  private readonly baseProvider: TempLikeProvider;

  public constructor(private readonly config: EasySmsRuntimeConfig) {
    this.baseProvider = new TempLikeProvider(config, {
      descriptor,
      fetchMode: "html",
      listUrl: receiveSmsFreeCcHomepageUrl,
      linkMatcher: /\/[A-Za-z-]+-Phone-Number\/\d+\/$/i,
      documentFetcher: async (url) => load(
        await fetchReceiveSmsFreeCcHtml(
          url,
          config,
          resolveReceiveSmsFreeCcAuthConfig(config),
        ),
      ),
    });
  }

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const listUrl = await resolveReceiveSmsFreeCcListUrl(this.config, options);
    const listProvider = new TempLikeProvider(this.config, {
      descriptor,
      fetchMode: "html",
      listUrl,
      linkMatcher: /\/[A-Za-z-]+-Phone-Number\/\d+\/$/i,
      documentFetcher: this.baseProvider.documentFetcher,
    });
    const candidates = await listProvider.listPublicNumbers(options);
    return filterReceiveSmsFreeCcLiveNumbers(
      candidates,
      async (numberId) => this.baseProvider.getInbox(numberId),
      limit,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    return this.baseProvider.getInbox(numberId);
  }
}

export function createReceiveSmsFreeCcProvider(config: EasySmsRuntimeConfig): ReceiveSmsFreeCcProvider {
  return new ReceiveSmsFreeCcProvider(config);
}

async function resolveReceiveSmsFreeCcListUrl(
  config: EasySmsRuntimeConfig,
  options: ListPublicNumbersOptions,
): Promise<string> {
  if (!options.countryCode && !options.countryName) {
    return receiveSmsFreeCcHomepageUrl;
  }

  const auth = resolveReceiveSmsFreeCcAuthConfig(config);
  const $ = load(await fetchReceiveSmsFreeCcHtml(receiveSmsFreeCcRegionsUrl, config, auth));
  let matchedUrl: string | undefined;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !receiveSmsFreeCcCountryDirectoryLinkPattern.test(href)) {
      return;
    }

    const sourceUrl = resolveAbsoluteUrl(receiveSmsFreeCcRegionsUrl, href);
    const text = normalizeText($(element).text());
    const countryName = normalizeText(text.replace(/Phone Number.+$/i, ""));
    const countryCode = inferCountryCode(countryName);
    if (matchesCountryFilter(countryCode, countryName, options.countryCode, options.countryName)) {
      matchedUrl = sourceUrl;
      return false;
    }
  });

  return matchedUrl ?? receiveSmsFreeCcHomepageUrl;
}

export function isReceiveSmsFreeCcVerificationLikeMessage(
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

  return receiveSmsFreeCcVerificationKeywordPattern.test(text);
}

export function parseReceiveSmsFreeCcRelativeAgeMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const text = value.trim().toLowerCase();
  const amountMatch = text.match(/(\d+)/);
  const amount = amountMatch ? Number.parseInt(amountMatch[1] ?? "", 10) : 1;

  if (text.includes("sec")) {
    return amount * 1000;
  }
  if (text.includes("min")) {
    return amount * 60 * 1000;
  }
  if (text.includes("hour")) {
    return amount * 60 * 60 * 1000;
  }
  if (text.includes("day")) {
    return amount * 24 * 60 * 60 * 1000;
  }
  if (text.includes("month")) {
    return amount * 30 * 24 * 60 * 60 * 1000;
  }
  if (text.includes("year")) {
    return amount * 365 * 24 * 60 * 60 * 1000;
  }

  return undefined;
}

export function hasRecentReceiveSmsFreeCcVerificationActivity(
  messages: SmsInboxMessage[],
  freshnessWindowMs: number = receiveSmsFreeCcVerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = messages.find((message) =>
    isReceiveSmsFreeCcVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseReceiveSmsFreeCcRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined ? ageMs <= freshnessWindowMs : false;
}

export async function filterReceiveSmsFreeCcLiveNumbers(
  candidates: SmsPublicNumber[],
  getInbox: (numberId: string) => Promise<SmsInboxSnapshot>,
  limit: number = Number.MAX_SAFE_INTEGER,
): Promise<SmsPublicNumber[]> {
  const results: SmsPublicNumber[] = [];

  for (const candidate of candidates) {
    const listedAgeMs = parseReceiveSmsFreeCcRelativeAgeMs(candidate.latestActivityText);
    if (listedAgeMs !== undefined && listedAgeMs > receiveSmsFreeCcVerificationFreshnessWindowMs) {
      continue;
    }

    try {
      const inbox = await getInbox(candidate.numberId);
      const latestVerificationMessage = inbox.messages.find((message) =>
        isReceiveSmsFreeCcVerificationLikeMessage(message)
      );
      if (!latestVerificationMessage) {
        continue;
      }

      const ageMs = parseReceiveSmsFreeCcRelativeAgeMs(latestVerificationMessage.receivedAtText);
      if (ageMs === undefined || ageMs > receiveSmsFreeCcVerificationFreshnessWindowMs) {
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
