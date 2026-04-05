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
  fetchBrowserRenderedDocument,
  fetchJsonValue,
  matchesCountryFilter,
  normalizeText,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";
import {
  buildQuackrNumberUrl,
  getQuackrCountryMetadata,
  getQuackrLocaleRank,
  parseQuackrAddedAt,
} from "./catalog.js";

const providerHomepageUrl = "https://quackr.io/temporary-numbers";
const providerNumbersUrl = "https://quackr.io/numbers.json";
const providerMessagesApiUrl = "https://quackr.io/api/messages";

interface QuackrNumberRecord {
  added?: number | string;
  locale?: string;
  number?: string;
  provider?: string;
  status?: string;
}

interface QuackrPreparedNumber {
  locale: string;
  rank: number;
  addedAtMs?: number;
  item: SmsPublicNumber;
}

type QuackrApiResponse =
  | QuackrApiMessage[]
  | { data?: QuackrApiMessage[]; error?: string; messages?: QuackrApiMessage[]; results?: QuackrApiMessage[] };

interface QuackrApiMessage {
  body?: string;
  content?: string;
  created_at?: string;
  createdAt?: string;
  date?: string;
  from?: string;
  id?: number | string;
  message?: string;
  receivedAt?: string;
  sender?: string;
  service?: string;
  text?: string;
  timestamp?: number | string;
}

interface QuackrBrowserInspection {
  gateMessage?: string;
  waitingForMessages: boolean;
}

export class QuackrProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "quackr",
    displayName: "Quackr",
    homepageUrl: providerHomepageUrl,
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers"],
    enabled: true,
    countryHints: [
      "United States",
      "United Kingdom",
      "Germany",
      "Netherlands",
      "Sweden",
      "Finland",
      "France",
      "Belgium",
      "Austria",
      "China",
      "Korea",
      "South Africa",
    ],
    notes: [
      "Public numbers are listed from quackr.io/numbers.json.",
      "As of 2026-04-05, the public inbox API is gated by verification and the browser-rendered number pages also show a register/log-in gate across tested locales.",
    ],
  };

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const items = (await this.fetchNumbers())
      .filter((item) =>
        matchesCountryFilter(item.item.countryCode, item.item.countryName, options.countryCode, options.countryName),
      )
      .sort((left, right) => {
        if (left.rank !== right.rank) {
          return left.rank - right.rank;
        }

        return (right.addedAtMs ?? 0) - (left.addedAtMs ?? 0);
      });

    if (options.countryCode || options.countryName) {
      return items.slice(0, limit).map((item) => item.item);
    }

    return takeRoundRobinByLocale(items, limit).map((item) => item.item);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const url = new URL(`${providerMessagesApiUrl}/${reference.phoneNumber.replace(/[^\d]/g, "")}`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("timeFilter", "all");

    let errorMessage: string | undefined;

    try {
      const response = await fetchJsonValue<QuackrApiResponse>(url.toString(), this.config, reference.sourceUrl);
      errorMessage = extractQuackrError(response);
      if (!errorMessage) {
        return this.buildInboxSnapshot(
          reference,
          numberId,
          extractQuackrMessages(response).map((message, index) => ({
            id: String(message.id ?? index),
            sender: pickString(message.sender, message.from, message.service),
            receivedAtText: pickString(
              message.receivedAt,
              message.createdAt,
              message.created_at,
              message.date,
              typeof message.timestamp === "string" ? message.timestamp : undefined,
            ),
            content: pickString(message.content, message.message, message.text, message.body) ?? "",
            sourceUrl: reference.sourceUrl,
          })),
        );
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unknown error";
    }

    const browserInspection = await this.inspectBrowserInbox(reference.sourceUrl);
    if (browserInspection?.gateMessage) {
      throw new Error(
        `Quackr inbox is currently gated by site verification/login requirements: ${browserInspection.gateMessage}`,
      );
    }

    if (browserInspection?.waitingForMessages) {
      return this.buildInboxSnapshot(reference, numberId, []);
    }

    throw new Error(
      `Quackr inbox is currently gated by site verification/login requirements: ${errorMessage ?? "Verification failed"}`,
    );
  }

  private async fetchNumbers(): Promise<QuackrPreparedNumber[]> {
    const records = await fetchJsonValue<QuackrNumberRecord[]>(providerNumbersUrl, this.config, providerHomepageUrl);
    const items: QuackrPreparedNumber[] = [];
    const seenPhoneNumbers = new Set<string>();

    for (const record of records) {
      if ((record.status ?? "").toLowerCase() !== "online") {
        continue;
      }

      const phoneDigits = (record.number ?? "").replace(/[^\d]/g, "");
      if (!phoneDigits || seenPhoneNumbers.has(phoneDigits)) {
        continue;
      }

      const metadata = getQuackrCountryMetadata(record.locale);
      if (!metadata) {
        continue;
      }

      seenPhoneNumbers.add(phoneDigits);
      const addedAtMs = parseQuackrAddedAt(record.added);
      const sourceUrl = buildQuackrNumberUrl(metadata.slug, phoneDigits);

      items.push({
        locale: metadata.locale,
        rank: getQuackrLocaleRank(metadata.locale),
        addedAtMs,
        item: {
          providerKey: this.descriptor.key,
          providerDisplayName: this.descriptor.displayName,
          numberId: encodeNumberId({
            providerKey: this.descriptor.key,
            sourceUrl,
            phoneNumber: `+${phoneDigits}`,
            countryName: metadata.countryName,
            countryCode: metadata.countryCode,
            label: record.provider,
          }),
          sourceUrl,
          phoneNumber: `+${phoneDigits}`,
          countryName: metadata.countryName,
          countryCode: metadata.countryCode,
          label: record.provider ?? "public",
          latestActivityText: formatLatestActivity(record.provider, addedAtMs),
        },
      });
    }

    return items;
  }

  private buildInboxSnapshot(
    reference: ReturnType<typeof decodeNumberId>,
    numberId: string,
    messages: SmsInboxMessage[],
  ): SmsInboxSnapshot {
    return {
      providerKey: this.descriptor.key,
      providerDisplayName: this.descriptor.displayName,
      numberId,
      phoneNumber: reference.phoneNumber,
      countryName: reference.countryName,
      countryCode: reference.countryCode,
      sourceUrl: reference.sourceUrl,
      fetchedAtIso: new Date().toISOString(),
      messages: messages.filter((message) => message.content),
    };
  }

  private async inspectBrowserInbox(sourceUrl: string): Promise<QuackrBrowserInspection | undefined> {
    try {
      const $ = await fetchBrowserRenderedDocument(sourceUrl, this.config);
      return {
        gateMessage: extractQuackrBrowserGateMessage($),
        waitingForMessages: normalizeText($("body").text()).includes("Waiting on incoming messages..."),
      };
    } catch {
      return undefined;
    }
  }
}

function extractQuackrError(response: QuackrApiResponse): string | undefined {
  if (Array.isArray(response)) {
    return undefined;
  }

  return typeof response.error === "string" && response.error ? response.error : undefined;
}

function extractQuackrMessages(response: QuackrApiResponse): QuackrApiMessage[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response.messages)) {
    return response.messages;
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (Array.isArray(response.results)) {
    return response.results;
  }

  return [];
}

function formatLatestActivity(providerName: string | undefined, addedAtMs: number | undefined): string | undefined {
  const parts: string[] = [];
  if (providerName) {
    parts.push(providerName);
  }

  if (addedAtMs) {
    parts.push(new Date(addedAtMs).toISOString());
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function pickString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function extractQuackrBrowserGateMessage(
  $: Awaited<ReturnType<typeof fetchBrowserRenderedDocument>>,
): string | undefined {
  const bodyText = normalizeText($("body").text());
  const match = bodyText.match(
    /Unfortunately due to new regulations,\s*(.+?)\s*virtual numbers are required to register or log in before accessing our content\./i,
  );
  if (match) {
    return normalizeText(match[0]);
  }

  if (bodyText.includes("required to register or log in before accessing our content")) {
    return "Verification failed";
  }

  return undefined;
}

function takeRoundRobinByLocale(items: QuackrPreparedNumber[], limit: number): QuackrPreparedNumber[] {
  const localeOrder = Array.from(new Set(items.map((item) => item.locale)));
  const groups = new Map<string, QuackrPreparedNumber[]>();

  for (const locale of localeOrder) {
    groups.set(
      locale,
      items.filter((item) => item.locale === locale).sort((left, right) => (right.addedAtMs ?? 0) - (left.addedAtMs ?? 0)),
    );
  }

  const output: QuackrPreparedNumber[] = [];
  while (output.length < limit) {
    let consumedAny = false;

    for (const locale of localeOrder) {
      const group = groups.get(locale);
      if (!group || group.length === 0) {
        continue;
      }

      output.push(group.shift() as QuackrPreparedNumber);
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
