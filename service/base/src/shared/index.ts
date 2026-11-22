import type { IncomingMessage, ServerResponse } from "node:http";

import { load, type CheerioAPI } from "cheerio";

import { ValidationError } from "../domain/errors.js";
import type {
  EasySmsRuntimeConfig,
  SmsNumberReference,
  SmsProviderKey,
  SmsPublicNumber,
} from "../domain/models.js";
import { WebHttpSession, type FetchLike } from "./cookie-fetch.js";
import { md5Hex } from "./md5.js";

export { WebCookieJar, WebHttpSession, type CookieFetchOptions, type FetchLike } from "./cookie-fetch.js";
export { md5Hex };

const MIN_PROVIDER_REQUEST_TIMEOUT_MS = 5000;

export const defaultProviderRequestTimeoutMs: Partial<Record<SmsProviderKey, number>> = {
  onlinesim: 15000,
  smstome: 75000,
  receive_smss: 30000,
  receive_sms_free_cc: 30000,
  sms24: 20000,
  yunduanxin: 20000,
  hero_sms: 15000,
};

function normalizeRequestTimeoutMs(value: unknown): number | undefined {
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.trim())
      : undefined;
  if (numericValue === undefined || !Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }
  return Math.max(MIN_PROVIDER_REQUEST_TIMEOUT_MS, Math.ceil(numericValue));
}

export function resolveProviderRequestTimeoutMs(
  config: EasySmsRuntimeConfig,
  providerKey: string,
): number {
  const normalizedProviderKey = providerKey.trim() as SmsProviderKey;
  return normalizeRequestTimeoutMs(config.scraping.providerRequestTimeoutMs?.[normalizedProviderKey])
    ?? normalizeRequestTimeoutMs(defaultProviderRequestTimeoutMs[normalizedProviderKey])
    ?? normalizeRequestTimeoutMs(config.scraping.requestTimeoutMs)
    ?? defaultProviderRequestTimeoutMs.onlinesim
    ?? 15000;
}

export function withProviderRequestTimeout(
  config: EasySmsRuntimeConfig,
  providerKey: string,
): EasySmsRuntimeConfig {
  const requestTimeoutMs = resolveProviderRequestTimeoutMs(config, providerKey);
  return {
    ...config,
    scraping: {
      ...config.scraping,
      requestTimeoutMs,
    },
  };
}

const countryDialCodeByName: Record<string, string> = {
  usa: "+1",
  "united states": "+1",
  canada: "+1",
  "puerto rico": "+1",
  britain: "+44",
  "united kingdom": "+44",
  uk: "+44",
  netherlands: "+31",
  france: "+33",
  spain: "+34",
  hungary: "+36",
  italy: "+39",
  switzerland: "+41",
  austria: "+43",
  denmark: "+45",
  norway: "+47",
  portugal: "+351",
  ireland: "+353",
  latvia: "+371",
  moldova: "+373",
  georgia: "+995",
  finland: "+358",
  sweden: "+46",
  germany: "+49",
  belgium: "+32",
  australia: "+61",
  india: "+91",
  indonesia: "+62",
  korea: "+82",
  "south korea": "+82",
  mexico: "+52",
  morocco: "+212",
  pakistan: "+92",
  poland: "+48",
  serbia: "+381",
  lithuania: "+370",
  brazil: "+55",
  russia: "+7",
  taiwan: "+886",
  argentina: "+54",
  slovenia: "+386",
  "south africa": "+27",
  china: "+86",
  hongkong: "+852",
  "hong kong": "+852",
  malaysia: "+60",
  japan: "+81",
  thailand: "+66",
  philippines: "+63",
  "美国": "+1",
  "英国": "+44",
  "荷兰": "+31",
  "法国": "+33",
  "西班牙": "+34",
  "匈牙利": "+36",
  "意大利": "+39",
  "瑞士": "+41",
  "奥地利": "+43",
  "丹麦": "+45",
  "挪威": "+47",
  "阿根廷": "+54",
  "葡萄牙": "+351",
  "爱尔兰": "+353",
  "拉脱维亚": "+371",
  "摩尔多瓦": "+373",
  "格鲁吉亚": "+995",
  "芬兰": "+358",
  "瑞典": "+46",
  "德国": "+49",
  "比利时": "+32",
  "澳大利亚": "+61",
  "印度": "+91",
  "印度尼西亚": "+62",
  "韩国": "+82",
  "墨西哥": "+52",
  "摩洛哥": "+212",
  "巴基斯坦": "+92",
  "波兰": "+48",
  "塞尔维亚": "+381",
  "立陶宛": "+370",
  "巴西": "+55",
  "俄罗斯": "+7",
  "台湾": "+886",
  "中国": "+86",
  "南非": "+27",
  "斯洛文尼亚": "+386",
  "菲律宾": "+63",
};

const knownDialCodes = Array.from(new Set(Object.values(countryDialCodeByName))).sort(
  (left, right) => right.length - left.length,
);

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const maxBodySizeBytes = 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const encoder = new TextEncoder();

  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > maxBodySizeBytes) {
      throw new ValidationError("Request body exceeds maximum allowed size (1 MB).");
    }
    chunks.push(bytes);
  }

  if (chunks.length === 0) {
    return {};
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8").decode(combined));
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

export function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload, null, 2);
  const byteLength = new TextEncoder().encode(body).byteLength;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": byteLength.toString(),
  });
  response.end(body);
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function redactSensitiveText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\b(Bearer\s+)(?!<redacted>)[A-Za-z0-9._-]+/gi, "$1<redacted>")
    .replace(
      /\b((?:api[_-]?key|apikey|access[_-]?token|token|password|secret|key)=)(?!<redacted>)([^&\s"']+)/gi,
      "$1<redacted>",
    );
}

export function resolveAbsoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function encodeNumberId(reference: SmsNumberReference): string {
  const bytes = new TextEncoder().encode(JSON.stringify(reference));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeNumberId(numberId: string): SmsNumberReference {
  try {
    const normalized = String(numberId ?? "").replace(/-/g, "+").replace(/_/g, "/");
    if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) {
      throw new Error("Invalid base64url");
    }
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(payload) as SmsNumberReference;
  } catch {
    throw new ValidationError("Invalid numberId.");
  }
}

export function inferCountryCode(countryName?: string, phoneNumber?: string): string | undefined {
  const normalizedName = normalizeText(countryName).toLowerCase();
  if (normalizedName && countryDialCodeByName[normalizedName]) {
    return countryDialCodeByName[normalizedName];
  }

  const normalizedPhone = normalizeText(phoneNumber);
  for (const dialCode of knownDialCodes) {
    if (normalizedPhone.startsWith(dialCode)) {
      return dialCode;
    }
  }

  const codeMatch = normalizedPhone.match(/^\+\d{1,4}(?=\s|$)/);
  return codeMatch?.[0];
}

export function matchesCountryFilter(
  phoneCountryCode: string | undefined,
  phoneCountryName: string | undefined,
  requestedCountryCode: string | undefined,
  requestedCountryName: string | undefined,
): boolean {
  if (requestedCountryCode) {
    return phoneCountryCode === requestedCountryCode;
  }

  if (requestedCountryName) {
    const normalizedPhoneCountryName = normalizeText(phoneCountryName).toLowerCase();
    const normalizedRequestedCountryName = normalizeText(requestedCountryName).toLowerCase();
    if (normalizedPhoneCountryName === normalizedRequestedCountryName) {
      return true;
    }

    const requestedCountryDialCode = inferCountryCode(requestedCountryName);
    if (requestedCountryDialCode && phoneCountryCode) {
      return requestedCountryDialCode === phoneCountryCode;
    }

    return false;
  }

  return true;
}

export function dedupeAndLimit(items: SmsPublicNumber[], limit: number): SmsPublicNumber[] {
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

export function takeRoundRobin<T>(groups: T[][], limit: number): T[] {
  const copies = groups.map((group) => [...group]).filter((group) => group.length > 0);
  const output: T[] = [];

  while (output.length < limit) {
    let consumedAny = false;

    for (const group of copies) {
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

export async function fetchHtmlDocument(
  url: string,
  config: EasySmsRuntimeConfig,
  referer?: string,
): Promise<CheerioAPI> {
  return load(
    await fetchTextResponse(
      url,
      config,
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      referer,
    ),
  );
}

export async function fetchJsonValue<T>(
  url: string,
  config: EasySmsRuntimeConfig,
  referer?: string,
): Promise<T> {
  let rawText: string;
  try {
    rawText = await fetchTextResponse(url, config, "application/json,text/plain;q=0.9,*/*;q=0.8", referer);
  } catch (error) {
    throw new Error(
      `Failed to fetch JSON from ${redactSensitiveText(url)}: ${redactSensitiveText(
        error instanceof Error ? error.message : "Unknown error",
      )}`,
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${redactSensitiveText(url)}: ${redactSensitiveText(
        error instanceof Error ? error.message : "Unknown error",
      )}`,
    );
  }
}

async function fetchTextResponse(
  url: string,
  config: EasySmsRuntimeConfig,
  acceptHeader: string,
  referer?: string,
  fetchImpl?: FetchLike,
): Promise<string> {
  const session = new WebHttpSession(fetchImpl);
  try {
    return await session.getText(url, {
      timeoutMs: config.scraping.requestTimeoutMs,
      headers: {
        Accept: acceptHeader,
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": config.scraping.userAgent,
        ...(referer ? { Referer: referer } : {}),
      },
    });
  } catch (error) {
    throw error instanceof Error
      ? new Error(redactSensitiveText(error.message))
      : new Error("Failed to fetch upstream HTTP response.");
  }
}
