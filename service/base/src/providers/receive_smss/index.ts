import { load, type CheerioAPI } from "cheerio";

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
  detectReceiveSmssAccessGateHtml,
  fetchReceiveSmssHtml,
  resolveReceiveSmssAuthConfig,
} from "./session-helper.js";

const providerHomepageUrl = "https://receive-smss.com/";
const receiveSmssVerificationFreshnessWindowMs = 30 * 60 * 1000;
const receiveSmssVerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;

export class ReceiveSmssProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "receive_smss",
    displayName: "Receive SMSS",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: [
      "United States",
      "United Kingdom",
      "Germany",
      "Netherlands",
      "Denmark",
      "Spain",
      "India",
    ],
    notes: [
      "As of 2026-05-13, this source is usable in service/base without a browser via curl_cffi-backed HTTP fetches that impersonate a modern browser TLS/session profile.",
      "When providers.receiveSmss.username/password are configured, page fetches first replay the site's /login/ form POST and then fetch the target page in the same HTTP session.",
      "Numbers are considered live only when a verification-like SMS appeared within the last 30 minutes.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const $ = await this.fetchDocument(providerHomepageUrl);
    const candidates = dedupeAndLimit(
      parseReceiveSmssDirectoryCards($, this.descriptor).filter((item) =>
        matchesCountryFilter(
          item.countryCode,
          item.countryName,
          options.countryCode,
          options.countryName,
        )
      ),
      limit,
    );
    return filterReceiveSmssLiveNumbers(
      candidates,
      async (numberId) => this.getInbox(numberId),
      limit,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await this.fetchDocument(reference.sourceUrl);
    const messages = parseReceiveSmssInboxMessages(
      $,
      reference.sourceUrl,
      reference.phoneNumber,
    );

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

  private async fetchDocument(url: string): Promise<CheerioAPI> {
    const html = await fetchReceiveSmssHtml(
      url,
      this.config,
      resolveReceiveSmssAuthConfig(this.config),
    );
    if (detectReceiveSmssAccessGateHtml(html)) {
      throw new Error(`Receive-SMSS route is currently gated by Cloudflare: ${url}`);
    }
    return load(html);
  }
}

export function createReceiveSmssProvider(config: EasySmsRuntimeConfig): ReceiveSmssProvider {
  return new ReceiveSmssProvider(config);
}

export function parseReceiveSmssDirectoryCards(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
): SmsPublicNumber[] {
  const results: SmsPublicNumber[] = [];

  $(".number-boxes-item").each((_, element) => {
    const sourceUrl = resolveReceiveSmssInboxUrl(
      $(element).find("a[href*='/sms/']").last().attr("href")
        ?? $(element).closest("a[href*='/sms/']").attr("href"),
    );
    const phoneNumber = formatPhoneNumber(
      $(element).find(".number-boxes-itemm-number, .number-boxes-item-number").first().text(),
    );
    const countryName = normalizeText(
      $(element).find(".number-boxes-item-country, .number-boxess-item-country").first().text(),
    );
    const countryCode = inferCountryCode(countryName, phoneNumber);

    if (!sourceUrl || !phoneNumber || !countryName) {
      return;
    }

      results.push({
        providerKey: descriptor.key,
        providerDisplayName: descriptor.displayName,
        numberId: encodeNumberId({
          providerKey: descriptor.key,
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

  return dedupeAndLimit(results, Number.MAX_SAFE_INTEGER);
}

export function parseReceiveSmssInboxMessages(
  $: CheerioAPI,
  sourceUrl: string,
  phoneNumber: string,
): SmsInboxMessage[] {
  const messages: SmsInboxMessage[] = [];

  $(".message_details").each((index, element) => {
    const content = normalizeText(
      $(element).find(".msg > span, .msgg > span").first().text()
        || stripLeadingFieldLabel($(element).find(".msg, .msgg").first().text(), "Message"),
    );
    if (!content) {
      return;
    }

    const sender = normalizeText(
      $(element).find(".sender > a, .senderr > a").first().text()
        || stripLeadingFieldLabel($(element).find(".sender, .senderr").first().text(), "Sender"),
    );
    const receivedAtText = normalizeText(
      stripLeadingFieldLabel($(element).find(".time").first().text(), "Time"),
    );

    messages.push({
      id: `${phoneNumber}-${index}`,
      sender: sender || undefined,
      receivedAtText: receivedAtText || undefined,
      content,
      sourceUrl,
    });
  });

  return messages;
}

export function isReceiveSmssVerificationLikeMessage(
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

  return receiveSmssVerificationKeywordPattern.test(text);
}

export function parseReceiveSmssRelativeAgeMs(value: string | undefined): number | undefined {
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

export function hasRecentReceiveSmssVerificationActivity(
  messages: SmsInboxMessage[],
  freshnessWindowMs: number = receiveSmssVerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = messages.find((message) =>
    isReceiveSmssVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseReceiveSmssRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined ? ageMs <= freshnessWindowMs : false;
}

export async function filterReceiveSmssLiveNumbers(
  candidates: SmsPublicNumber[],
  getInbox: (numberId: string) => Promise<SmsInboxSnapshot>,
  limit: number = Number.MAX_SAFE_INTEGER,
): Promise<SmsPublicNumber[]> {
  const results: SmsPublicNumber[] = [];

  for (const candidate of candidates) {
    try {
      const inbox = await getInbox(candidate.numberId);
      const latestVerificationMessage = inbox.messages.find((message) =>
        isReceiveSmssVerificationLikeMessage(message)
      );
      if (!latestVerificationMessage) {
        continue;
      }

      const ageMs = parseReceiveSmssRelativeAgeMs(latestVerificationMessage.receivedAtText);
      if (ageMs === undefined || ageMs > receiveSmssVerificationFreshnessWindowMs) {
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

export function detectReceiveSmssBrowserGateMessage($: CheerioAPI): string | undefined {
  const title = normalizeText($("title").text());
  const bodyText = normalizeText($("body").text());

  if (title.includes("Attention Required! | Cloudflare")) {
    return title;
  }

  if (
    title.includes("Just a moment")
    || bodyText.includes("Enable JavaScript and cookies to continue")
    || bodyText.includes("正在进行安全验证")
    || bodyText.includes("Cloudflare")
  ) {
    return title || "Cloudflare challenge";
  }

  return undefined;
}
function formatPhoneNumber(value: string): string | undefined {
  const digits = normalizeText(value).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : undefined;
}

function resolveReceiveSmssInboxUrl(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }

  const sourceUrl = resolveAbsoluteUrl(providerHomepageUrl, href);
  const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "sms" || !/^\d+$/.test(parts[1])) {
    return undefined;
  }

  return sourceUrl;
}

function stripLeadingFieldLabel(value: string, label: string): string {
  return normalizeText(value).replace(new RegExp(`^${label}\\s*`, "i"), "");
}
