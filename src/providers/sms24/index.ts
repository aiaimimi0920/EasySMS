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

export class Sms24Provider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "sms24",
    displayName: "SMS24.me",
    homepageUrl: "https://sms24.me/en",
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["United States", "Canada", "Puerto Rico", "South Africa"],
    notes: [
      "The numbers list is exposed as ordinary HTML links under /en/numbers.",
      "Inbox entries are rendered as dt/dd pairs with sender and message text.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const $ = await fetchHtmlDocument("https://sms24.me/en/numbers", this.config, this.descriptor.homepageUrl);
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

    return dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, this.descriptor.homepageUrl);
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
}
