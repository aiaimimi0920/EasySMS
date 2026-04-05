import type { CheerioAPI } from "cheerio";

import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
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

const providerHomepageUrl = "https://jiemahao.com/";
const displayNameByChineseCountry: Record<string, string> = {
  "美国": "United States",
  "英国": "United Kingdom",
  "加拿大": "Canada",
  "德国": "Germany",
  "香港": "Hong Kong",
  "泰国": "Thailand",
  "印尼": "Indonesia",
  "印度尼西亚": "Indonesia",
  "马来西亚": "Malaysia",
  "菲律宾": "Philippines",
};
const staticCountryTargets: JiemahaoCountryTarget[] = [
  { countryCode: "+1", countryName: "United States", sourceUrl: "https://jiemahao.com/us/" },
  { countryCode: "+44", countryName: "United Kingdom", sourceUrl: "https://jiemahao.com/gb/" },
  { countryCode: "+1", countryName: "Canada", sourceUrl: "https://jiemahao.com/ca/" },
  { countryCode: "+49", countryName: "Germany", sourceUrl: "https://jiemahao.com/de/" },
  { countryCode: "+852", countryName: "Hong Kong", sourceUrl: "https://jiemahao.com/hk/" },
  { countryCode: "+66", countryName: "Thailand", sourceUrl: "https://jiemahao.com/th/" },
  { countryCode: "+62", countryName: "Indonesia", sourceUrl: "https://jiemahao.com/id/" },
  { countryCode: "+60", countryName: "Malaysia", sourceUrl: "https://jiemahao.com/my/" },
  { countryCode: "+63", countryName: "Philippines", sourceUrl: "https://jiemahao.com/ph/" },
];

interface JiemahaoCountryTarget {
  countryCode?: string;
  countryName: string;
  sourceUrl: string;
}

export class JiemahaoProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "jiemahao",
    displayName: "接码号",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers"],
    enabled: true,
    countryHints: [
      "United States",
      "United Kingdom",
      "Canada",
      "Germany",
      "Hong Kong",
      "Thailand",
      "Indonesia",
      "Malaysia",
      "Philippines",
    ],
    notes: [
      "Country pages such as /us/ and /gb/ expose public number lists directly in server-rendered HTML.",
      "As of 2026-04-05, inbox content behind /sms/?phone=... requires Turnstile verification and an interactive form submission.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const targets = (await this.fetchCountryCatalog()).filter((target) =>
      matchesCountryFilter(target.countryCode, target.countryName, options.countryCode, options.countryName),
    );

    if (targets.length === 0) {
      return [];
    }

    const settled = await Promise.allSettled(
      targets.map(async (target) => {
        const $ = await fetchHtmlDocument(target.sourceUrl, this.config, providerHomepageUrl);
        return parseJiemahaoCountryPageNumbers($, this.descriptor, target.countryName, target.countryCode);
      }),
    );

    const countryGroups = settled
      .filter((result): result is PromiseFulfilledResult<SmsPublicNumber[]> => result.status === "fulfilled")
      .map((result) => result.value);

    if (countryGroups.length === 0) {
      const rejected = settled.find((result) => result.status === "rejected");
      if (rejected) {
        throw rejected.reason instanceof Error ? rejected.reason : new Error("Failed to fetch Jiemahao country pages.");
      }

      return [];
    }

    const items = options.countryCode || options.countryName
      ? countryGroups.flat()
      : takeRoundRobinAcrossCountries(countryGroups, limit);

    return dedupeAndLimit(items, limit);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await fetchHtmlDocument(reference.sourceUrl, this.config, providerHomepageUrl);
    const gateMessage = detectJiemahaoGateMessage($);
    if (gateMessage) {
      throw new Error(gateMessage);
    }

    throw new Error("Jiemahao inbox is unavailable without an interactive verification flow.");
  }

  private async fetchCountryCatalog(): Promise<JiemahaoCountryTarget[]> {
    return staticCountryTargets;
  }
}

export function parseJiemahaoCountryCatalog($: CheerioAPI): JiemahaoCountryTarget[] {
  const results: JiemahaoCountryTarget[] = [];
  const seen = new Set<string>();

  $(".home-cathumbs a[href], .menu a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const sourceUrl = resolveAbsoluteUrl(providerHomepageUrl, href);
    const pathname = new URL(sourceUrl).pathname;
    if (!/^\/[a-z]{2}\/$/i.test(pathname)) {
      return;
    }

    if (seen.has(sourceUrl)) {
      return;
    }

    const rawName = normalizeChineseCountryName(
      normalizeText($(element).find("h4").first().text())
      || normalizeText($(element).find("img").first().attr("alt"))
      || normalizeText($(element).text()),
    );
    const countryName = displayNameByChineseCountry[rawName];
    if (!countryName) {
      return;
    }

    seen.add(sourceUrl);
    results.push({
      countryCode: inferCountryCode(rawName, countryName),
      countryName,
      sourceUrl,
    });
  });

  return results;
}

export function parseJiemahaoCountryPageNumbers(
  $: CheerioAPI,
  descriptor: ProviderDescriptor,
  countryName: string,
  countryCode: string | undefined,
): SmsPublicNumber[] {
  const results: SmsPublicNumber[] = [];

  $("a.article-title.center[href*='/sms/?phone=']").each((_, element) => {
    const href = $(element).attr("href");
    const sourceUrl = href ? resolveAbsoluteUrl(providerHomepageUrl, href) : undefined;
    if (!sourceUrl) {
      return;
    }

    const phoneNumber = formatPhoneNumber($(element).text());
    if (!phoneNumber) {
      return;
    }

    const latestActivityText = normalizeJiemahaoLatestActivityText(
      normalizeText($(element).closest("li").find(".tit").first().text()),
    );

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
      latestActivityText,
    });
  });

  return results;
}

export function detectJiemahaoGateMessage($: CheerioAPI): string | undefined {
  const pageText = normalizeText($("body").text());
  if ($(".cf-turnstile").length > 0 || pageText.includes("查看短信")) {
    return "Jiemahao inbox currently requires Turnstile verification and an interactive form submission.";
  }

  return undefined;
}

function formatPhoneNumber(value: string): string | undefined {
  const digits = normalizeText(value).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : undefined;
}

function normalizeJiemahaoLatestActivityText(value: string): string | undefined {
  if (!value || value === "01/01/1970") {
    return undefined;
  }

  return value;
}

function normalizeChineseCountryName(value: string): string {
  return value.replace(/(电话号码|号码)/g, "").trim();
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

function takeRoundRobinAcrossCountries(
  countryGroups: SmsPublicNumber[][],
  limit: number,
): SmsPublicNumber[] {
  const groups = countryGroups
    .map((group) => [...group])
    .filter((group) => group.length > 0);
  const output: SmsPublicNumber[] = [];

  while (output.length < limit) {
    let consumedAny = false;

    for (const group of groups) {
      const item = group.shift();
      if (!item) {
        continue;
      }

      output.push(item);
      consumedAny = true;

      if (output.length >= limit) {
        return output;
      }
    }

    if (!consumedAny) {
      break;
    }
  }

  return output;
}
