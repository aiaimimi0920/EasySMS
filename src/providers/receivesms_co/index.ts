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
  dedupeAndLimit,
  encodeNumberId,
  fetchHtmlDocument,
  inferCountryCode,
  matchesCountryFilter,
  normalizeText,
  resolveAbsoluteUrl,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";

const providerHomepageUrl = "https://www.receivesms.co/";
const providerActiveNumbersUrl = "https://www.receivesms.co/active-numbers";
const providerCountriesUrl = "https://www.receivesms.co/available-countries";

interface ReceiveSmsCoCountryTarget {
  iso2: string;
  countryCode?: string;
  countryName: string;
  sourceUrl: string;
}

export class ReceiveSmsCoProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "receivesms_co",
    displayName: "ReceiveSMS.co",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: [
      "United States",
      "Canada",
      "United Kingdom",
      "Sweden",
      "Netherlands",
      "Lithuania",
      "Latvia",
      "Croatia",
    ],
    notes: [
      "The /active-numbers directory exposes mixed-country public numbers in server-rendered HTML.",
      "Country pages under /available-countries expose larger per-country pools when a country filter is requested.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const catalog = await this.fetchCountryCatalog();

    if (options.countryCode || options.countryName) {
      const targets = catalog.filter((target) =>
        matchesCountryFilter(target.countryCode, target.countryName, options.countryCode, options.countryName),
      );

      const results: SmsPublicNumber[] = [];
      for (const target of targets) {
        const $ = await fetchHtmlDocument(target.sourceUrl, this.config, providerHomepageUrl);
        results.push(...parseReceiveSmsCoNumberCards($, this.descriptor, new Map(), target));
        if (results.length >= limit) {
          break;
        }
      }

      return dedupeAndLimit(results, limit);
    }

    const countryTargetByIso = new Map(catalog.map((target) => [target.iso2, target]));
    const $ = await fetchHtmlDocument(providerActiveNumbersUrl, this.config, providerHomepageUrl);
    return dedupeAndLimit(parseReceiveSmsCoNumberCards($, this.descriptor, countryTargetByIso), limit);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, providerHomepageUrl);

    return {
      providerKey: this.descriptor.key,
      providerDisplayName: this.descriptor.displayName,
      numberId,
      phoneNumber: reference.phoneNumber,
      countryName: reference.countryName,
      countryCode: reference.countryCode ?? inferCountryCode(reference.countryName, reference.phoneNumber),
      sourceUrl: reference.sourceUrl,
      fetchedAtIso: new Date().toISOString(),
      messages: parseReceiveSmsCoInboxMessages($, reference.sourceUrl, reference.phoneNumber),
    };
  }

  private async fetchCountryCatalog(): Promise<ReceiveSmsCoCountryTarget[]> {
    const $ = await fetchHtmlDocument(providerCountriesUrl, this.config, providerHomepageUrl);
    return parseReceiveSmsCoCountryCatalog($);
  }
}

export function parseReceiveSmsCoCountryCatalog($: CheerioAPI): ReceiveSmsCoCountryTarget[] {
  const results: ReceiveSmsCoCountryTarget[] = [];
  const seen = new Set<string>();

  $("a[href*='-phone-numbers/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const sourceUrl = resolveAbsoluteUrl(providerHomepageUrl, href);
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    const iso2 = parts.at(-1)?.toLowerCase();
    if (!iso2 || !/^[a-z]{2}$/.test(iso2) || seen.has(sourceUrl)) {
      return;
    }

    seen.add(sourceUrl);
    const countryName = normalizeText($(element).contents().first().text()) || normalizeText($(element).text()).split("Active numbers")[0]?.trim();
    if (!countryName) {
      return;
    }

    results.push({
      iso2,
      countryCode: inferCountryCode(countryName),
      countryName,
      sourceUrl,
    });
  });

  return results;
}

export function parseReceiveSmsCoNumberCards(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
  countryTargetByIso: Map<string, ReceiveSmsCoCountryTarget>,
  forcedCountry?: ReceiveSmsCoCountryTarget,
): SmsPublicNumber[] {
  const results: SmsPublicNumber[] = [];

  $("a.card.card-link[href*='-phone-number/']").each((_, element) => {
    const href = $(element).attr("href");
    const sourceUrl = href ? resolveAbsoluteUrl(providerHomepageUrl, href) : undefined;
    if (!sourceUrl) {
      return;
    }

    const phoneNumber = formatPhoneNumber($(element).find("strong").first().text() || $(element).text());
    if (!phoneNumber) {
      return;
    }

    const iso2 = normalizeText(
      $(element).find("img.flag").first().attr("title")
        || $(element).find("img.flag").first().attr("alt"),
    ).toLowerCase();
    const countryTarget = forcedCountry ?? countryTargetByIso.get(iso2);
    const countryName = countryTarget?.countryName;
    const countryCode = countryTarget?.countryCode ?? inferCountryCode(countryName, phoneNumber);

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

export function parseReceiveSmsCoInboxMessages(
  $: CheerioAPI,
  sourceUrl: string,
  phoneNumber: string,
): SmsInboxMessage[] {
  const messages: SmsInboxMessage[] = [];

  $("article.entry-card").each((index, element) => {
    const content = normalizeText($(element).find(".entry-body .sms").first().text());
    if (!content) {
      return;
    }

    const sender = normalizeText($(element).find(".from-link").first().text());
    const receivedAtText = normalizeText($(element).find(".entry-right .muted").last().text());

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

function formatPhoneNumber(value: string): string | undefined {
  const digits = normalizeText(value).replace(/[^\d+]/g, "");
  if (!digits) {
    return undefined;
  }

  return digits.startsWith("+") ? digits : `+${digits.replace(/[^\d]/g, "")}`;
}
