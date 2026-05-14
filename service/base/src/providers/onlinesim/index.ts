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
const onlineSimVerificationFreshnessWindowMs = 20 * 60 * 1000;
const onlineSimVerificationKeywordPattern =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;

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
    updated_at?: string;
    data_humans?: string;
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
    costTier: "free",
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
      "Lists only the current primary country number exposed by the country-scoped free_numbers_content endpoint.",
      "The current primary number is considered live only when a verification-like SMS arrived within the last 20 minutes.",
      "As of 2026-04-05, public inbox reads resolve only for the current primary country number exposed by OnlineSIM.",
      "When providers.onlineSim.apiKey is configured, API requests use the official apikey-authorized HTTP path instead of relying on masked website views.",
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

    for (const country of countries) {
      const response = await this.fetchCountrySnapshot(country.slug);
      const number = buildOnlineSimLivePrimaryNumber(this.descriptor, country, response);
      if (!number) {
        continue;
      }

      items.push(number);
      if (items.length >= limit) {
        return items;
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
      buildOnlineSimApiUrl(`${providerApiUrl}?lang=en`, this.config.providers.onlineSim.apiKey),
      this.config,
      providerHomepageUrl,
    );
  }

  private async fetchHiddenCatalog(): Promise<OnlineSimHiddenApiResponse> {
    return this.fetchCountrySnapshot(hiddenCatalogSeedSlug);
  }

  private async fetchCountrySnapshot(countrySlug: string): Promise<OnlineSimHiddenApiResponse> {
    return fetchJsonValue<OnlineSimHiddenApiResponse>(
      buildOnlineSimApiUrl(
        `${providerHiddenApiUrl}/${encodeURIComponent(countrySlug)}?page=1`,
        this.config.providers.onlineSim.apiKey,
      ),
      this.config,
      providerHomepageUrl,
    );
  }
}

export function buildOnlineSimApiUrl(url: string, apiKey: string | undefined): string {
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (!normalizedApiKey) {
    return url;
  }

  const target = new URL(url);
  if (!target.searchParams.has("apikey")) {
    target.searchParams.set("apikey", normalizedApiKey);
  }
  return target.toString();
}

export function isOnlineSimVerificationLikeMessage(
  message: Pick<OnlineSimMessageRecord, "text"> | Pick<SmsInboxMessage, "content">,
): boolean {
  const rawText = "text" in message ? message.text : message.content;
  const text = String(rawText ?? "").trim();
  if (!text) {
    return false;
  }

  const condensed = text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
  if (/^\d{4,8}$/.test(condensed)) {
    return true;
  }

  if (!/\d{4,8}/.test(condensed)) {
    return false;
  }

  return onlineSimVerificationKeywordPattern.test(text);
}

export function hasRecentOnlineSimVerificationActivity(
  response: Pick<OnlineSimHiddenApiResponse, "number" | "messages">,
  freshnessWindowMs: number = onlineSimVerificationFreshnessWindowMs,
): boolean {
  const latestVerificationMessage = findLatestOnlineSimVerificationMessage(response.messages?.data ?? []);
  if (!latestVerificationMessage) {
    return false;
  }

  const relativeAgeMs = parseOnlineSimRelativeAgeMs(latestVerificationMessage.data_humans);
  if (relativeAgeMs !== undefined) {
    return relativeAgeMs <= freshnessWindowMs;
  }

  const referenceTimestamp =
    parseOnlineSimNaiveTimestamp(response.number?.updated_at) ??
    parseOnlineSimNaiveTimestamp((response.messages?.data ?? [])[0]?.created_at);
  const verificationTimestamp =
    parseOnlineSimNaiveTimestamp(latestVerificationMessage.created_at);

  if (referenceTimestamp !== undefined && verificationTimestamp !== undefined) {
    return referenceTimestamp - verificationTimestamp <= freshnessWindowMs;
  }

  return false;
}

function buildPublicPageUrl(countrySlug: string, fullNumber: string): string {
  return `${providerHomepageUrl}/${encodeURIComponent(countrySlug)}/${encodeURIComponent(
    fullNumber.replace(/^\+/, ""),
  )}`;
}

function buildOnlineSimLivePrimaryNumber(
  descriptor: ProviderDescriptor,
  country: OnlineSimMergedCountry,
  response: OnlineSimHiddenApiResponse,
): SmsPublicNumber | null {
  const phoneNumber = normalizePhoneNumber(response.number?.full_number);
  if (!phoneNumber) {
    return null;
  }

  if (!hasRecentOnlineSimVerificationActivity(response)) {
    return null;
  }

  const sourceUrl = buildPublicPageUrl(country.slug, response.number?.full_number ?? phoneNumber);
  const latestVerificationMessage = findLatestOnlineSimVerificationMessage(response.messages?.data ?? []);

  return {
    providerKey: descriptor.key,
    providerDisplayName: descriptor.displayName,
    numberId: encodeNumberId({
      providerKey: descriptor.key,
      sourceUrl,
      phoneNumber,
      countryName: country.displayName,
      countryCode: country.dialCode,
    }),
    sourceUrl,
    phoneNumber,
    countryName: country.displayName,
    countryCode: country.dialCode,
    label: country.displayName,
    latestActivityText: latestVerificationMessage?.data_humans ?? response.number?.data_humans,
  };
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

function findLatestOnlineSimVerificationMessage(
  messages: OnlineSimMessageRecord[],
): OnlineSimMessageRecord | undefined {
  return messages.find((message) => isOnlineSimVerificationLikeMessage(message));
}

function parseOnlineSimNaiveTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "0", 10);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function parseOnlineSimRelativeAgeMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const text = value.trim().toLowerCase();
  const amountMatch = /(\d+)/.exec(text);
  const amount = amountMatch ? Number.parseInt(amountMatch[1] ?? "", 10) : 1;

  if (text.includes("минут")) {
    return amount * 60 * 1000;
  }
  if (text.includes("час")) {
    return amount * 60 * 60 * 1000;
  }
  if (text.includes("дн")) {
    return amount * 24 * 60 * 60 * 1000;
  }
  if (text.includes("недел")) {
    return amount * 7 * 24 * 60 * 60 * 1000;
  }
  if (text.includes("меся")) {
    return amount * 30 * 24 * 60 * 60 * 1000;
  }
  if (text.includes("год") || text.includes("лет")) {
    return amount * 365 * 24 * 60 * 60 * 1000;
  }

  return undefined;
}
