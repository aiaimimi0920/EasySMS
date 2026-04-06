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

const listPages = [
  {
    url: "https://freephonenum.com/us",
    countryName: "United States",
    countryCode: "+1",
  },
  {
    url: "https://freephonenum.com/ca",
    countryName: "Canada",
    countryCode: "+1",
  },
];

export class FreePhoneNumProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "freephonenum",
    displayName: "FreePhoneNum",
    homepageUrl: "https://freephonenum.com",
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["United States", "Canada"],
    notes: [
      "Server-rendered HTML pages are directly scrapable.",
      "Some numbers require registration and are skipped from inbox parsing when unavailable.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const results: SmsPublicNumber[] = [];

    for (const page of listPages) {
      if (
        !matchesCountryFilter(page.countryCode, page.countryName, options.countryCode, options.countryName)
      ) {
        continue;
      }

      const $ = await fetchHtmlDocument(page.url, this.config, this.descriptor.homepageUrl);

      $(".numbers-btn[href*='/receive-sms/']").each((_, element) => {
        const href = $(element).attr("href");
        const label = normalizeText($(element).text());
        if (!href || label.toLowerCase().includes("register to view")) {
          return;
        }

        const sourceUrl = resolveAbsoluteUrl(page.url, href);
        const phoneNumber = normalizeText($(element).find("div").first().text()) || normalizeText(label);
        const latestActivityText = normalizeText($(element).find(".sms-count").text()) || undefined;

        results.push({
          providerKey: this.descriptor.key,
          providerDisplayName: this.descriptor.displayName,
          numberId: encodeNumberId({
            providerKey: this.descriptor.key,
            sourceUrl,
            phoneNumber,
            countryName: page.countryName,
            countryCode: page.countryCode,
          }),
          sourceUrl,
          phoneNumber,
          countryName: page.countryName,
          countryCode: page.countryCode,
          latestActivityText,
        });
      });
    }

    return dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, this.descriptor.homepageUrl);
    const messages: SmsInboxMessage[] = [];

    $("table.table tbody tr").each((index, row) => {
      const columns = $(row).find("td");
      const receivedAtText = normalizeText($(columns[0]).text());
      const sender = normalizeText($(columns[1]).text());
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
}
