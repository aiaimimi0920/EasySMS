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
  fetchBrowserRenderedDocumentWithNativeUserAgent,
  fetchHtmlDocument,
  inferCountryCode,
  matchesCountryFilter,
  normalizeText,
  resolveAbsoluteUrl,
} from "../../shared/index.js";
import type { SmsProvider } from "../contracts.js";

export type TempLikeFetchMode = "browser-native-ua" | "html";

export interface TempLikeProviderDefinition {
  descriptor: ProviderDescriptor;
  fetchMode?: TempLikeFetchMode;
  listUrl: string;
  linkMatcher: RegExp;
  documentFetcher?: TempLikeDocumentFetcher;
}

interface TempLikeDocumentFetcherDeps {
  browserNativeUaFetcher: typeof fetchBrowserRenderedDocumentWithNativeUserAgent;
  htmlFetcher: typeof fetchHtmlDocument;
}

type TempLikeDocumentFetcher = (
  url: string,
  config: EasySmsRuntimeConfig,
  referer?: string,
) => Promise<Awaited<ReturnType<typeof fetchHtmlDocument>>>;

const tempLikeDocumentFetcherDeps: TempLikeDocumentFetcherDeps = {
  browserNativeUaFetcher: fetchBrowserRenderedDocumentWithNativeUserAgent,
  htmlFetcher: fetchHtmlDocument,
};

export class TempLikeProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor;
  readonly fetchMode: TempLikeFetchMode;
  readonly listUrl: string;
  readonly linkMatcher: RegExp;
  readonly documentFetcher: TempLikeDocumentFetcher;

  constructor(
    private readonly config: EasySmsRuntimeConfig,
    definition: TempLikeProviderDefinition,
  ) {
    this.descriptor = definition.descriptor;
    this.fetchMode = definition.fetchMode ?? "html";
    this.listUrl = definition.listUrl;
    this.linkMatcher = definition.linkMatcher;
    this.documentFetcher = definition.documentFetcher
      ?? resolveTempLikeDocumentFetcher(this.fetchMode, tempLikeDocumentFetcherDeps);
  }

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    const $ = await this.fetchDocument(this.listUrl, this.descriptor.homepageUrl);
    const results: SmsPublicNumber[] = [];

    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href || !this.linkMatcher.test(href)) {
        return;
      }

      const sourceUrl = resolveAbsoluteUrl(this.listUrl, href);
      const text = normalizeText($(element).text());
      const phoneNumber = normalizeText(text.match(/\+\d[\d\s]+/)?.[0]);
      if (!phoneNumber) {
        return;
      }

      const countryName = normalizeText(text.replace(phoneNumber, "").replace(/Latest:.+$/i, "").replace(/Online.+$/i, ""));
      const countryCode = inferCountryCode(countryName, phoneNumber);
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
        latestActivityText: normalizeText(text.replace(`${countryName} ${phoneNumber}`, "")) || undefined,
      });
    });

    return dedupeAndLimit(results, options.limit ?? this.config.scraping.maxNumbersPerProvider);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const reference = decodeNumberId(numberId);
    const $ = await this.fetchDocument(reference.sourceUrl, this.descriptor.homepageUrl);
    const messages = [
      ...parseDirectChatMessages($, reference.sourceUrl, reference.phoneNumber),
      ...parseCardMessages($, reference.sourceUrl, reference.phoneNumber),
    ];

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

  private async fetchDocument(url: string, referer?: string) {
    return this.documentFetcher(url, this.config, referer);
  }
}

export function resolveTempLikeDocumentFetcher(
  fetchMode: TempLikeFetchMode | undefined,
  deps: TempLikeDocumentFetcherDeps,
): TempLikeDocumentFetcher {
  if (fetchMode === "browser-native-ua") {
    return async (url, config) => deps.browserNativeUaFetcher(url, config);
  }

  return (url, config, referer) => deps.htmlFetcher(url, config, referer);
}

function parseDirectChatMessages(
  $: Awaited<ReturnType<typeof fetchHtmlDocument>>,
  sourceUrl: string,
  phoneNumber: string,
): SmsInboxMessage[] {
  const messages: SmsInboxMessage[] = [];

  $(".direct-chat-msg").each((index, element) => {
    const content = normalizeText($(element).find(".direct-chat-text").first().text());
    if (!content) {
      return;
    }

    const senderRaw = normalizeText($(element).find(".direct-chat-info .pull-right").first().text());
    const sender =
      senderRaw.replace(/^From\s+/i, "")
      || normalizeText($(element).find(".direct-chat-name").first().text());
    const receivedAtText = normalizeText($(element).find(".direct-chat-timestamp").first().text());

    messages.push({
      id: `${phoneNumber}-direct-${index}`,
      sender,
      receivedAtText,
      content,
      sourceUrl,
    });
  });

  return messages;
}

function parseCardMessages(
  $: Awaited<ReturnType<typeof fetchHtmlDocument>>,
  sourceUrl: string,
  phoneNumber: string,
): SmsInboxMessage[] {
  const messages: SmsInboxMessage[] = [];

  $(".sms-item").each((index, element) => {
    const content = normalizeText($(element).find(".sms-content").first().text());
    if (!content) {
      return;
    }

    const sender = normalizeText($(element).find(".sender-badge").first().text());
    const receivedAtText = normalizeText($(element).find(".time-text").first().text());
    messages.push({
      id: `${phoneNumber}-card-${index}`,
      sender,
      receivedAtText,
      content,
      sourceUrl,
    });
  });

  return messages;
}
