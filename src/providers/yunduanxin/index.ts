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

export class YunDuanXinProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "yunduanxin",
    displayName: "云短信",
    homepageUrl: "https://yunduanxin.net",
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["美国", "法国", "英国", "中国", "西班牙", "瑞典", "荷兰"],
    notes: [
      "Home page exposes public numbers as card blocks.",
      "Message pages are directly readable without a hidden API.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const $ = await fetchHtmlDocument(this.descriptor.homepageUrl, this.config, this.descriptor.homepageUrl);
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

    return dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, this.descriptor.homepageUrl);
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
}
