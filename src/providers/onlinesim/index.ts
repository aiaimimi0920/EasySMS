import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxMessage,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../domain/models.js";
import { decodeNumberId, encodeNumberId, fetchJsonValue, matchesCountryFilter } from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";

const providerApiUrl = "https://onlinesim.io/api/getFreeList";
const providerHiddenApiUrl = "https://onlinesim.io/api/v1/free_numbers_content/countries";
const providerHomepageUrl = "https://onlinesim.io/free_numbers";
const hiddenCatalogSeedSlug = "germany";

interface OnlineSimOfficialCountry {
  country: number;
  country_text: string;
  country_original: string;
}

interface OnlineSimOfficialApiResponse {
  response: number;
  countries?: OnlineSimOfficialCountry[];
}

interface OnlineSimHiddenCountry {
  country: number;
  name: string;
  locale?: string;
  online?: boolean;
}

interface OnlineSimHiddenNumberRecord {
  country: number;
  data_humans?: string;
  full_number: string;
  number: string;
  code?: string;
  is_archive?: boolean;
}

interface OnlineSimMessageRecord {
  id: number;
  text: string;
  in_number?: string;
  created_at?: string;
  data_humans?: string;
}

interface OnlineSimHiddenApiResponse {
  response: number;
  code?: number;
  counties?: OnlineSimHiddenCountry[];
  numbers?: OnlineSimHiddenNumberRecord[];
  number?: {
    full_number?: string;
  };
  messages?: {
    data?: OnlineSimMessageRecord[];
  };
}

interface OnlineSimMergedCountry {
  dialCode: string;
  displayName: string;
  slug: string;
}

export class OnlineSimProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "onlinesim",
    displayName: "OnlineSIM Free Numbers",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: [
      "Netherlands",
      "France",
      "Spain",
      "Hungary",
      "Italy",
      "Switzerland",
      "Austria",
      "Denmark",
      "Sweden",
      "Norway",
      "Germany",
      "Argentina",
      "Portugal",
      "Ireland",
      "Latvia",
      "Moldova",
      "Georgia",
    ],
    notes: [
      "Lists public numbers from the country-scoped free_numbers_content endpoint.",
      "As of 2026-04-05, public inbox reads resolve only for the current primary country number exposed by OnlineSIM.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const countries = (await this.fetchCatalog()).filter((country) =>
      matchesCountryFilter(country.dialCode, country.displayName, options.countryCode, options.countryName),
    );

    if (countries.length === 0) {
      return [];
    }

    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const items: SmsPublicNumber[] = [];
    const seenPhoneNumbers = new Set<string>();

    for (const country of countries) {
      const response = await this.fetchCountrySnapshot(country.slug);
      for (const number of response.numbers ?? []) {
        const phoneNumber = normalizePhoneNumber(number.full_number);
        if (!phoneNumber || seenPhoneNumbers.has(phoneNumber)) {
          continue;
        }

        seenPhoneNumbers.add(phoneNumber);
        const sourceUrl = buildPublicPageUrl(country.slug, number.full_number);

        items.push({
          providerKey: this.descriptor.key,
          providerDisplayName: this.descriptor.displayName,
          numberId: encodeNumberId({
            providerKey: this.descriptor.key,
            sourceUrl,
            phoneNumber,
            countryName: country.displayName,
            countryCode: country.dialCode,
          }),
          sourceUrl,
          phoneNumber,
          countryName: country.displayName,
          countryCode: country.dialCode,
          label: number.is_archive ? `${country.displayName} archived` : country.displayName,
          latestActivityText: number.data_humans,
        });

        if (items.length >= limit) {
          return items;
        }
      }
    }

    return items;
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const slug = extractCountrySlug(reference.sourceUrl);
    const response = await this.fetchCountrySnapshot(slug);
    const resolvedPhoneNumber = normalizePhoneNumber(response.number?.full_number);

    if (!resolvedPhoneNumber) {
      throw new Error("OnlineSIM did not expose a current public number for this country page.");
    }

    if (resolvedPhoneNumber !== normalizePhoneNumber(reference.phoneNumber)) {
      throw new Error(
        "OnlineSIM currently exposes public inbox data only for the current primary number on a country page.",
      );
    }

    const messages: SmsInboxMessage[] = (response.messages?.data ?? [])
      .filter((message) => message.text?.trim())
      .map((message) => ({
        id: String(message.id),
        sender: message.in_number,
        receivedAtText: message.created_at ?? message.data_humans,
        content: message.text.trim(),
        sourceUrl: reference.sourceUrl,
      }));

    return {
      providerKey: this.descriptor.key,
      providerDisplayName: this.descriptor.displayName,
      numberId,
      phoneNumber: reference.phoneNumber,
      countryName: reference.countryName,
      countryCode: reference.countryCode,
      sourceUrl: reference.sourceUrl,
      fetchedAtIso: new Date().toISOString(),
      messages,
    };
  }

  private async fetchCatalog(): Promise<OnlineSimMergedCountry[]> {
    const [officialCatalog, hiddenCatalog] = await Promise.all([
      this.fetchOfficialCatalog(),
      this.fetchHiddenCatalog(),
    ]);
    const officialByCode = new Map(
      (officialCatalog.countries ?? []).map((country) => [country.country, country]),
    );

    return (hiddenCatalog.counties ?? [])
      .filter((country) => country.online)
      .map((country) => {
        const official = officialByCode.get(country.country);
        return {
          dialCode: `+${country.country}`,
          displayName: official?.country_text ?? humanizeSlug(country.name),
          slug: country.name,
        };
      });
  }

  private async fetchOfficialCatalog(): Promise<OnlineSimOfficialApiResponse> {
    return fetchJsonValue<OnlineSimOfficialApiResponse>(
      `${providerApiUrl}?lang=en`,
      this.config,
      providerHomepageUrl,
    );
  }

  private async fetchHiddenCatalog(): Promise<OnlineSimHiddenApiResponse> {
    return this.fetchCountrySnapshot(hiddenCatalogSeedSlug);
  }

  private async fetchCountrySnapshot(countrySlug: string): Promise<OnlineSimHiddenApiResponse> {
    return fetchJsonValue<OnlineSimHiddenApiResponse>(
      `${providerHiddenApiUrl}/${encodeURIComponent(countrySlug)}?page=1`,
      this.config,
      providerHomepageUrl,
    );
  }
}

function buildPublicPageUrl(countrySlug: string, fullNumber: string): string {
  return `${providerHomepageUrl}/${encodeURIComponent(countrySlug)}/${encodeURIComponent(
    fullNumber.replace(/^\+/, ""),
  )}`;
}

function extractCountrySlug(sourceUrl: string): string {
  const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("OnlineSIM numberId is missing a country slug.");
  }

  return parts[1];
}

function humanizeSlug(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePhoneNumber(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : undefined;
}
