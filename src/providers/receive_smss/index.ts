import type { CheerioAPI } from "cheerio";

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
  encodeNumberId,
  fetchBrowserRenderedDocumentWithNativeUserAgent,
  inferCountryCode,
  matchesCountryFilter,
  normalizeText,
  resolveAbsoluteUrl,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";

const providerHomepageUrl = "https://receive-smss.com/";

export class ReceiveSmssProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "receive_smss",
    displayName: "Receive SMSS",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
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
      "The public homepage and inbox pages are readable through native browser DOM rendering without overriding the browser user agent.",
      "As of 2026-04-05, bare HTTP requests and custom browser user agents frequently hit Cloudflare, so this provider intentionally uses the native browser UA fallback path.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const $ = await fetchBrowserRenderedDocumentWithNativeUserAgent(providerHomepageUrl, this.config);
    const gateMessage = detectReceiveSmssBrowserGateMessage($);
    if (gateMessage) {
      throw new Error(`Receive-SMSS directory is currently gated by Cloudflare: ${gateMessage}`);
    }

    return dedupeAndLimit(
      parseReceiveSmssDirectoryCards($, this.descriptor).filter((item) =>
        matchesCountryFilter(item.countryCode, item.countryName, options.countryCode, options.countryName),
      ),
      limit,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchBrowserRenderedDocumentWithNativeUserAgent(reference.sourceUrl, this.config);
    const gateMessage = detectReceiveSmssBrowserGateMessage($);
    if (gateMessage) {
      throw new Error(`Receive-SMSS inbox is currently gated by Cloudflare: ${gateMessage}`);
    }

    return {
      providerKey: this.descriptor.key,
      providerDisplayName: this.descriptor.displayName,
      numberId,
      phoneNumber: reference.phoneNumber,
      countryName: reference.countryName,
      countryCode: reference.countryCode ?? inferCountryCode(reference.countryName, reference.phoneNumber),
      sourceUrl: reference.sourceUrl,
      fetchedAtIso: new Date().toISOString(),
      messages: parseReceiveSmssInboxMessages($, reference.sourceUrl, reference.phoneNumber),
    };
  }
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
      $(element).find(".msgg > span").first().text()
        || stripLeadingFieldLabel($(element).find(".msgg").first().text(), "Message"),
    );
    if (!content) {
      return;
    }

    const sender = normalizeText(
      $(element).find(".senderr > a").first().text()
        || stripLeadingFieldLabel($(element).find(".senderr").first().text(), "Sender"),
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

function dedupeAndLimit(items: SmsPublicNumber[], limit: number): SmsPublicNumber[] {
  const seen = new Set<string>();
  const deduped: SmsPublicNumber[] = [];

  for (const item of items) {
    if (seen.has(item.sourceUrl)) {
      continue;
    }

    seen.add(item.sourceUrl);
    deduped.push(item);
  }

  return deduped.slice(0, limit);
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
