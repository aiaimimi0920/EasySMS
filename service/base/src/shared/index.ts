import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { load, type CheerioAPI } from "cheerio";

import { ValidationError } from "../domain/errors.js";
import type {
  EasySmsRuntimeConfig,
  SmsNumberReference,
  SmsProviderKey,
  SmsPublicNumber,
} from "../domain/models.js";

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

const execFileAsync = promisify(execFile);
const knownDialCodes = Array.from(new Set(Object.values(countryDialCodeByName))).sort(
  (left, right) => right.length - left.length,
);

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const maxBodySizeBytes = 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;
    if (totalBytes > maxBodySizeBytes) {
      throw new ValidationError("Request body exceeds maximum allowed size (1 MB).");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function resolveAbsoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function encodeNumberId(reference: SmsNumberReference): string {
  return Buffer.from(JSON.stringify(reference), "utf8").toString("base64url");
}

export function decodeNumberId(numberId: string): SmsNumberReference {
  try {
    const payload = Buffer.from(numberId, "base64url").toString("utf8");
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
  try {
    return JSON.parse(
      await fetchTextResponse(url, config, "application/json,text/plain;q=0.9,*/*;q=0.8", referer),
    ) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${url}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function fetchBrowserRenderedHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  virtualTimeBudgetMs = Math.max(8000, config.scraping.requestTimeoutMs - 2000),
): Promise<string> {
  return fetchBrowserRenderedHtmlInternal(url, config, virtualTimeBudgetMs, config.scraping.userAgent);
}

export async function fetchBrowserRenderedHtmlWithNativeUserAgent(
  url: string,
  config: EasySmsRuntimeConfig,
  virtualTimeBudgetMs = Math.max(8000, config.scraping.requestTimeoutMs - 2000),
): Promise<string> {
  return fetchBrowserRenderedHtmlInternal(url, config, virtualTimeBudgetMs);
}

export async function fetchBrowserRenderedDocumentWithNativeUserAgent(
  url: string,
  config: EasySmsRuntimeConfig,
  virtualTimeBudgetMs?: number,
): Promise<CheerioAPI> {
  return load(await fetchBrowserRenderedHtmlWithNativeUserAgent(url, config, virtualTimeBudgetMs));
}

async function fetchBrowserRenderedHtmlInternal(
  url: string,
  config: EasySmsRuntimeConfig,
  virtualTimeBudgetMs: number,
  userAgent?: string,
): Promise<string> {
  const candidates = resolveBrowserExecutableCandidates();
  let lastError: unknown;

  for (const command of candidates) {
    try {
      const { stdout } = await execFileAsync(command, buildBrowserDumpDomArgs(url, virtualTimeBudgetMs, userAgent), {
        maxBuffer: 16 * 1024 * 1024,
        timeout: config.scraping.requestTimeoutMs,
      });
      if (stdout.trim()) {
        return stdout;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (candidates.length === 0) {
    throw new Error("No supported browser executable was found for DOM rendering fallback.");
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to render ${url} with a local browser.`);
}

export async function fetchBrowserRenderedDocument(
  url: string,
  config: EasySmsRuntimeConfig,
  virtualTimeBudgetMs?: number,
): Promise<CheerioAPI> {
  return load(await fetchBrowserRenderedHtml(url, config, virtualTimeBudgetMs));
}

async function fetchTextResponse(
  url: string,
  config: EasySmsRuntimeConfig,
  acceptHeader: string,
  referer?: string,
): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: acceptHeader,
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": config.scraping.userAgent,
        ...(referer ? { referer } : {}),
      },
      signal: AbortSignal.timeout(config.scraping.requestTimeoutMs),
    });

    if (response.ok) {
      return await response.text();
    }
  } catch {
    // fetch failed; fall through to curl
  }

  return fetchTextViaCurl(url, config, acceptHeader, referer);
}

async function fetchTextViaCurl(
  url: string,
  config: EasySmsRuntimeConfig,
  acceptHeader: string,
  referer?: string,
): Promise<string> {
  const candidates = process.platform === "win32" ? ["curl.exe", "curl"] : ["curl"];
  const baseArgs = [
    "-A",
    config.scraping.userAgent,
    "-L",
    "--max-redirs",
    "5",
    "--connect-timeout",
    String(Math.max(5, Math.ceil(config.scraping.requestTimeoutMs / 1000))),
    "-H",
    `Accept: ${acceptHeader}`,
    "-H",
    "Accept-Language: en-US,en;q=0.9,zh-CN;q=0.8",
    "-H",
    "Cache-Control: no-cache",
    "-H",
    "Pragma: no-cache",
  ];

  if (referer) {
    baseArgs.push("-e", referer);
  }

  baseArgs.push(url);

  let lastError: unknown;
  for (const command of candidates) {
    try {
      const { stdout } = await execFileAsync(command, baseArgs, {
        maxBuffer: 16 * 1024 * 1024,
        timeout: config.scraping.requestTimeoutMs,
      });
      return stdout;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch response with curl.");
}

function buildBrowserDumpDomArgs(
  url: string,
  virtualTimeBudgetMs: number,
  userAgent?: string,
): string[] {
  const sandboxArgs = process.platform === "linux"
    ? ["--no-sandbox", "--disable-dev-shm-usage"]
    : [];

  return [
    "--headless",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-default-browser-check",
    "--no-first-run",
    ...sandboxArgs,
    ...(userAgent ? [`--user-agent=${userAgent}`] : []),
    "--window-size=1366,768",
    `--virtual-time-budget=${virtualTimeBudgetMs}`,
    "--dump-dom",
    url,
  ];
}

function resolveBrowserExecutableCandidates(): string[] {
  const rawCandidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "msedge.exe",
          "chrome.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "microsoft-edge",
            "google-chrome",
            "chromium",
            "chromium-browser",
          ]
        : ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"];

  return rawCandidates.filter((candidate, index, items) => {
    if (items.indexOf(candidate) !== index) {
      return false;
    }

    return isExecutableCandidateAvailable(candidate);
  });
}

function isExecutableCandidateAvailable(candidate: string): boolean {
  if (candidate.includes("\\") || candidate.startsWith("/")) {
    return existsSync(candidate);
  }

  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [candidate], { stdio: "ignore" });
      return true;
    }

    execFileSync("/bin/sh", ["-lc", `command -v ${candidate} >/dev/null 2>&1`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
