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
  fetchHtmlDocument,
  inferCountryCode,
  matchesCountryFilter,
  normalizeText,
  resolveAbsoluteUrl,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";

const providerHomepageUrl = "https://temp-number.com/temporary-numbers";
const providerCountriesUrl = "https://temp-number.com/countries";

interface TempNumberCountryTarget {
  countryCode?: string;
  countryName: string;
  sourceUrl: string;
}

export class TempNumberProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "temp_number",
    displayName: "Temp Number",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: [
      "United Kingdom",
      "United States",
      "Canada",
      "Netherlands",
      "Slovenia",
      "Germany",
      "Finland",
    ],
    notes: [
      "The live directory at /temporary-numbers is server-rendered and exposes recent public inboxes across countries.",
      "Country-specific pages under /countries/{slug} expose larger per-country pools when a country filter is requested.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const hasCountryFilter = Boolean(options.countryCode || options.countryName);
    const results: SmsPublicNumber[] = [];

    if (hasCountryFilter) {
      const targets = (await this.fetchCountryCatalog()).filter((target) =>
        matchesCountryFilter(target.countryCode, target.countryName, options.countryCode, options.countryName),
      );

      for (const target of targets) {
        const $ = await fetchHtmlDocument(target.sourceUrl, this.config, providerHomepageUrl);
        results.push(...parseTempNumberDirectoryCards($, this.descriptor));

        if (results.length >= limit) {
          break;
        }
      }
    } else {
      const $ = await fetchHtmlDocument(providerHomepageUrl, this.config, providerHomepageUrl);
      results.push(...parseTempNumberDirectoryCards($, this.descriptor));
    }

    return dedupeAndLimit(
      results.filter((item) =>
        matchesCountryFilter(item.countryCode, item.countryName, options.countryCode, options.countryName),
      ),
      limit,
    );
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, providerHomepageUrl);
    const messages = parseTempNumberInboxMessages($, reference.sourceUrl, reference.phoneNumber);

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

  private async fetchCountryCatalog(): Promise<TempNumberCountryTarget[]> {
    const $ = await fetchHtmlDocument(providerCountriesUrl, this.config, providerHomepageUrl);
    return parseTempNumberCountryCatalog($);
  }
}

export function parseTempNumberDirectoryCards(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
): SmsPublicNumber[] {
  const cards = [
    ...parseTempNumberGlobalDirectoryCards($, descriptor),
    ...parseTempNumberCountryDirectoryCards($, descriptor),
  ];

  return dedupeAndLimit(cards, Number.MAX_SAFE_INTEGER);
}

export function parseTempNumberCountryCatalog($: CheerioAPI): TempNumberCountryTarget[] {
  const results: TempNumberCountryTarget[] = [];
  const seen = new Set<string>();

  $("a[href*='/countries/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const sourceUrl = resolveAbsoluteUrl(providerCountriesUrl, href);
    const { pathname } = new URL(sourceUrl);
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "countries") {
      return;
    }

    if (seen.has(sourceUrl)) {
      return;
    }

    seen.add(sourceUrl);
    const countryName = humanizeSlug(parts[1]);
    const countryCode = inferCountryCode(countryName, normalizeText($(element).text()));

    results.push({
      countryCode,
      countryName,
      sourceUrl,
    });
  });

  return results;
}

export function parseTempNumberInboxMessages(
  $: CheerioAPI,
  sourceUrl: string,
  phoneNumber: string,
): SmsInboxMessage[] {
  const messages: SmsInboxMessage[] = [];

  $(".msg-card").each((index, element) => {
    const content = normalizeText($(element).find(".msg-body").first().text());
    if (!content) {
      return;
    }

    const sender = normalizeText($(element).find(".msg-from").first().text()).replace(
      /^(business|phone)\s+/i,
      "",
    );
    const receivedAtText = normalizeText($(element).find(".msg-time").first().text());

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

function parseTempNumberGlobalDirectoryCards(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
): SmsPublicNumber[] {
  const results: SmsPublicNumber[] = [];

  $("article.number-card").each((_, element) => {
    const href = $(element).find("a.number-card__link").attr("href");
    const sourceUrl = href ? resolveAbsoluteUrl(providerHomepageUrl, href) : undefined;
    if (!sourceUrl || !looksLikeTempNumberInboxUrl(sourceUrl)) {
      return;
    }

    const phoneNumber = formatPhoneNumber($(element).find(".number-card__number").first().text());
    const countryName = normalizeText($(element).find(".number-card__country-name").first().text());
    const countryCode = inferCountryCode(countryName, phoneNumber);
    if (!phoneNumber) {
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
      latestActivityText: joinParts(
        normalizeText($(element).find(".number-card__date").first().text()),
        normalizeText($(element).find(".number-card__msgs").first().text()),
      ),
    });
  });

  return results;
}

function parseTempNumberCountryDirectoryCards(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
): SmsPublicNumber[] {
  const results: SmsPublicNumber[] = [];

  $(".country-box.number-card").each((_, element) => {
    const link = $(element).find("a.country-link").first();
    const href = link.attr("href");
    const sourceUrl = href ? resolveAbsoluteUrl(providerHomepageUrl, href) : undefined;
    if (!sourceUrl || !looksLikeTempNumberInboxUrl(sourceUrl)) {
      return;
    }

    const phoneNumber = formatPhoneNumber(link.find(".card-title").first().text());
    if (!phoneNumber) {
      return;
    }

    const countryName = humanizeSlug(new URL(sourceUrl).pathname.split("/").filter(Boolean)[1] ?? "");
    const countryCode = inferCountryCode(countryName, phoneNumber);

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
      latestActivityText: joinParts(
        normalizeText($(element).find(".ribbon-green").first().text()),
        normalizeText($(element).find(".add_time-top").first().text()),
      ),
    });
  });

  return results;
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

function humanizeSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function joinParts(...parts: Array<string | undefined>): string | undefined {
  const normalized = parts.filter((part) => typeof part === "string" && part.trim());
  return normalized.length > 0 ? normalized.join(" | ") : undefined;
}

function looksLikeTempNumberInboxUrl(url: string): boolean {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return parts.length >= 3 && parts[0] === "temporary-numbers" && /^\d+$/.test(parts[2]);
}
