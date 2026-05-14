import {
  ActivationProviderError,
  ProviderNotFoundError,
  ValidationError,
} from "../../domain/errors.js";
import type {
  EasySmsRuntimeConfig,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  HeroSmsActivationSession,
  HeroSmsActivationStatusSnapshot,
  HeroSmsActivationStatusUpdateResult,
  HeroSmsCountry,
  HeroSmsCountryPrice,
  HeroSmsOperatorQuote,
  ProviderDescriptor,
} from "../../domain/models.js";

interface HeroSmsApiErrorPayload {
  title?: string;
  details?: string;
  info?: Record<string, unknown>;
}

interface HeroSmsActivationResponsePayload {
  activationId?: number | string;
  phoneNumber?: string;
  activationCost?: number | string;
}

interface HeroSmsStatusResponsePayload {
  verificationType?: number;
  sms?: {
    dateTime?: string;
    code?: string;
    text?: string;
  };
  call?: {
    from?: string;
    text?: string;
    code?: string;
    dateTime?: string;
    url?: string;
  };
}

const providerKey = "hero_sms";
const providerHomepageUrl = "https://hero-sms.com/cn/api#description/introduction";

export const heroSmsActivationProviderDescriptor: ProviderDescriptor = {
  key: providerKey,
  displayName: "HeroSMS",
  homepageUrl: providerHomepageUrl,
  sourceType: "otp-activation-api",
  costTier: "paid",
  capabilities: [
    "list-countries",
    "list-top-countries",
    "list-operators",
    "create-activation",
    "get-activation-status",
    "set-activation-status",
  ],
  enabled: true,
  countryHints: [],
  notes: [
    "Backed by the official HeroSMS SMS-Activate compatible API.",
    "Exposed as a normal SMS provider; free/paid remains a provider attribute instead of an architecture layer.",
  ],
};

export class HeroSmsActivationProvider {
  readonly descriptor = heroSmsActivationProviderDescriptor;

  constructor(private readonly config: EasySmsRuntimeConfig) {}

  async getCountries(): Promise<HeroSmsCountry[]> {
    const data = await this.request("getCountries");
    return parseHeroSmsCountriesResponse(data);
  }

  async getTopCountriesByService(
    service = this.config.providers.heroSms.defaultService,
    ranked = true,
  ): Promise<HeroSmsCountryPrice[]> {
    const action = ranked ? "getTopCountriesByServiceRank" : "getTopCountriesByService";
    const data = await this.request(action, { service });
    return parseHeroSmsTopCountriesResponse(data, service);
  }

  async getPrices(service = this.config.providers.heroSms.defaultService): Promise<unknown> {
    return this.request("getPrices", { service });
  }

  async listCountryPrices(
    service = this.config.providers.heroSms.defaultService,
    countries?: HeroSmsCountry[],
  ): Promise<HeroSmsCountryPrice[]> {
    const countryList = countries ?? await this.getCountries();
    const matrix = await this.getPrices(service);
    const rows: HeroSmsCountryPrice[] = [];
    for (const country of countryList) {
      const parsed = extractHeroSmsCountryPrice(matrix, country.countryId, service);
      if (!parsed || parsed.price === null) {
        continue;
      }

      rows.push({
        providerKey,
        service,
        countryId: country.countryId,
        price: parsed.price,
        count: parsed.count,
        apiName: parsed.apiName || country.apiName,
        dialCode: parsed.dialCode || country.dialCode,
        isoCode: parsed.isoCode || country.isoCode,
      });
    }

    return rows
      .sort((left, right) => {
        if (left.price !== right.price) {
          return left.price - right.price;
        }
        return (right.count ?? 0) - (left.count ?? 0);
      });
  }

  async getOperators(country: number): Promise<string[]> {
    const data = await this.request("getOperators", { country });
    const raw = getRecord(data)?.countryOperators;
    if (!raw || typeof raw !== "object") {
      return [];
    }

    const operators = getRecord(raw)[String(country)] ?? getRecord(raw)[String(Number(country))];
    return Array.isArray(operators)
      ? operators.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
  }

  async getOperatorQuoteOptions(
    service = this.config.providers.heroSms.defaultService,
    country = this.config.providers.heroSms.defaultCountry,
  ): Promise<HeroSmsOperatorQuote[]> {
    const operators = await this.getOperators(country);
    if (operators.length === 0) {
      return [];
    }

    const options: HeroSmsOperatorQuote[] = [];
    for (const operator of operators) {
      try {
        const matrix = await this.request("getPrices", { service, country, operator });
        const parsed = extractHeroSmsCountryPrice(matrix, country, service);
        options.push({
          providerKey,
          service,
          countryId: country,
          operator,
          price: parsed?.price ?? null,
          count: parsed?.count ?? null,
        });
      } catch (error) {
        options.push({
          providerKey,
          service,
          countryId: country,
          operator,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return options;
  }

  async createActivation(input: HeroSmsActivationCreateInput = {}): Promise<HeroSmsActivationSession> {
    const service = input.service?.trim() || this.config.providers.heroSms.defaultService;
    const country = Number.isFinite(input.country)
      ? Number(input.country)
      : this.config.providers.heroSms.defaultCountry;

    if (!service) {
      throw new ValidationError("HeroSMS activation service is required.");
    }

    if (!Number.isFinite(country)) {
      throw new ValidationError("HeroSMS activation country must be a valid number.");
    }

    const data = await this.request("getNumberV2", {
      service,
      country,
      operator: input.operator,
      maxPrice: input.maxPrice,
      fixedPrice: input.fixedPrice ? "true" : undefined,
      ref: input.ref,
      phoneException: input.phoneException,
    });

    return normalizeHeroSmsActivationResponse(data, {
      service,
      country,
      operator: input.operator,
    });
  }

  async getActivationStatus(activationId: number): Promise<HeroSmsActivationStatusSnapshot> {
    if (!Number.isFinite(activationId)) {
      throw new ValidationError("activationId must be a valid number.");
    }

    const data = await this.request("getStatusV2", { id: activationId });
    return normalizeHeroSmsStatusResponse(activationId, data);
  }

  async setActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    if (!Number.isFinite(activationId)) {
      throw new ValidationError("activationId must be a valid number.");
    }

    const requestedStatus = mapHeroSmsStatusAction(action);
    const data = await this.request("setStatus", { id: activationId, status: requestedStatus });
    return {
      providerKey,
      activationId,
      requestedAction: action,
      requestedStatus,
      resultText: typeof data === "string" ? data : JSON.stringify(data),
      updatedAtIso: new Date().toISOString(),
    };
  }

  private assertConfigured(): void {
    if (!this.config.providers.heroSms.enabled) {
      throw new ProviderNotFoundError(providerKey);
    }

    if (!this.config.providers.heroSms.apiKey?.trim()) {
      throw new ValidationError("HeroSMS is enabled but providers.heroSms.apiKey is not configured.");
    }
  }

  private async request(
    action: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<unknown> {
    this.assertConfigured();

    const url = new URL(this.config.providers.heroSms.baseUrl);
    url.searchParams.set("api_key", this.config.providers.heroSms.apiKey as string);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
          "user-agent": this.config.scraping.userAgent,
        },
        signal: AbortSignal.timeout(this.config.scraping.requestTimeoutMs),
      });
    } catch (error) {
      throw new ActivationProviderError(
        providerKey,
        error instanceof Error ? error.message : "HeroSMS request failed.",
      );
    }

    const rawText = (await response.text()).trim();
    const payload = parseHeroSmsApiPayload(rawText);

    if (!response.ok) {
      throw new ActivationProviderError(
        providerKey,
        extractHeroSmsErrorMessage(payload) || `HeroSMS HTTP ${response.status}`,
      );
    }

    if (typeof payload === "string") {
      const normalized = payload.trim();
      if (normalized === "BAD_KEY") {
        throw new ActivationProviderError(providerKey, "HeroSMS API key is invalid.");
      }
      if (normalized === "NO_BALANCE") {
        throw new ActivationProviderError(providerKey, "HeroSMS balance is insufficient.");
      }
      if (normalized === "NO_NUMBERS") {
        throw new ActivationProviderError(providerKey, "HeroSMS has no numbers available for the requested criteria.", 409);
      }
    }

    return payload;
  }
}

export function parseHeroSmsCountriesResponse(data: unknown): HeroSmsCountry[] {
  const record = getRecord(data);
  const countries: HeroSmsCountry[] = [];

  for (const [key, value] of Object.entries(record)) {
    const payload = getRecord(value);
    const countryId = parseIntegerValue(payload.id ?? key);
    if (!Number.isFinite(countryId)) {
      continue;
    }

    countries.push({
      providerKey,
      countryId,
      apiName: String(payload.chn ?? payload.eng ?? payload.rus ?? payload.name ?? "").trim(),
      isoCode: String(payload.isoCode ?? payload.iso ?? payload.code ?? payload.iso2 ?? "").trim().toUpperCase() || undefined,
      dialCode: normalizeDialCode(payload.dialCode ?? payload.phoneCode ?? payload.prefix),
      visible: parseOptionalBoolean(payload.visible),
      retry: parseOptionalBoolean(payload.retry),
    });
  }

  return countries.sort((left, right) => left.countryId - right.countryId);
}

export function parseHeroSmsTopCountriesResponse(data: unknown, service: string): HeroSmsCountryPrice[] {
  const rows: HeroSmsCountryPrice[] = [];

  const pushRow = (item: unknown): void => {
    const payload = getRecord(item);
    const countryId = parseIntegerValue(
      payload.country ?? payload.countryId ?? payload.country_id ?? payload.id,
    );
    const price = parseNumberValue(payload.price ?? payload.cost ?? payload.retail_price ?? payload.retailPrice);
    if (!Number.isFinite(countryId) || price === null) {
      return;
    }

    rows.push({
      providerKey,
      service,
      countryId,
      price,
      count: parseIntegerValue(payload.count ?? payload.qty ?? payload.available ?? payload.stock ?? payload.total),
      apiName: String(
        payload.name
        ?? payload.countryName
        ?? payload.country_name
        ?? payload.title
        ?? payload.text
        ?? payload.label
        ?? "",
      ).trim(),
      isoCode: String(payload.isoCode ?? payload.iso ?? payload.code ?? payload.iso2 ?? "").trim().toUpperCase() || undefined,
      dialCode: normalizeDialCode(payload.dialCode ?? payload.phoneCode ?? payload.prefix ?? payload.phone_prefix),
    });
  };

  if (Array.isArray(data)) {
    data.forEach(pushRow);
  } else {
    for (const [key, value] of Object.entries(getRecord(data))) {
      if (/^\d+$/.test(key)) {
        pushRow(value);
      }
    }
  }

  return rows.sort((left, right) => {
    if (left.price !== right.price) {
      return left.price - right.price;
    }
    return (right.count ?? 0) - (left.count ?? 0);
  });
}

export function extractHeroSmsCountryPrice(
  raw: unknown,
  countryId: number,
  service: string,
): HeroSmsCountryPrice | undefined {
  const matrix = unwrapHeroSmsPriceMatrix(raw);
  const serviceKey = String(service);
  const countryKey = String(countryId);

  let node: unknown;
  if (Array.isArray(matrix)) {
    node = matrix.find((item) => {
      const payload = getRecord(item);
      return parseIntegerValue(payload.country ?? payload.countryId ?? payload.country_id ?? payload.id) === countryId;
    });
  } else {
    const record = getRecord(matrix);
    node = getRecord(record[serviceKey])[countryKey]
      ?? getRecord(record[countryKey])[serviceKey]
      ?? record[countryKey]
      ?? record[serviceKey];
  }

  const payload = getRecord(node);
  const price = parseNumberValue(payload.cost ?? payload.price ?? payload.activationCost ?? payload.amount ?? payload.rate);
  if (price === null) {
    return undefined;
  }

  return {
    providerKey,
    service,
    countryId,
    price,
    count: parseIntegerValue(payload.count ?? payload.qty ?? payload.available ?? payload.stock ?? payload.total),
    apiName: String(
      payload.name
      ?? payload.countryName
      ?? payload.country_name
      ?? payload.title
      ?? "",
    ).trim(),
    isoCode: String(payload.isoCode ?? payload.iso ?? payload.code ?? payload.iso2 ?? "").trim().toUpperCase() || undefined,
    dialCode: normalizeDialCode(payload.dialCode ?? payload.phoneCode ?? payload.prefix),
  };
}

export function normalizeHeroSmsActivationResponse(
  data: unknown,
  context: { service: string; country: number; operator?: string },
): HeroSmsActivationSession {
  if (typeof data === "string") {
    throw new ActivationProviderError(providerKey, `HeroSMS activation request failed: ${data}`);
  }

  const payload = getRecord(data) as HeroSmsActivationResponsePayload;
  const activationId = parseIntegerValue(payload.activationId);
  const phoneNumber = normalizePhoneNumber(payload.phoneNumber);
  if (!Number.isFinite(activationId) || !phoneNumber) {
    throw new ActivationProviderError(providerKey, "HeroSMS activation response is missing activationId or phoneNumber.");
  }

  return {
    providerKey,
    activationId,
    phoneNumber,
    service: context.service,
    countryId: context.country,
    operator: context.operator,
    activationCost: parseNumberValue(payload.activationCost),
    createdAtIso: new Date().toISOString(),
  };
}

export function normalizeHeroSmsStatusResponse(
  activationId: number,
  data: unknown,
): HeroSmsActivationStatusSnapshot {
  if (typeof data === "string") {
    const statusText = data.trim();
    if (statusText === "STATUS_WAIT_CODE") {
      return {
        providerKey,
        activationId,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: false,
        rawStatusText: statusText,
      };
    }

    if (statusText === "STATUS_CANCEL") {
      return {
        providerKey,
        activationId,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: true,
        rawStatusText: statusText,
      };
    }

    if (statusText.startsWith("STATUS_OK:")) {
      return {
        providerKey,
        activationId,
        fetchedAtIso: new Date().toISOString(),
        received: true,
        cancelled: false,
        code: statusText.split(":")[1],
        rawStatusText: statusText,
      };
    }
  }

  const payload = getRecord(data) as HeroSmsStatusResponsePayload;
  return {
    providerKey,
    activationId,
    fetchedAtIso: new Date().toISOString(),
    received: Boolean(payload.sms?.code),
    cancelled: false,
    verificationType: parseIntegerValue(payload.verificationType) ?? undefined,
    code: payload.sms?.code,
    text: payload.sms?.text,
    receivedAtIso: payload.sms?.dateTime,
    callFrom: payload.call?.from,
    callText: payload.call?.text,
    callCode: payload.call?.code,
    callReceivedAtIso: payload.call?.dateTime,
    callAudioUrl: payload.call?.url,
  };
}

function mapHeroSmsStatusAction(action: HeroSmsActivationAction): number {
  switch (action) {
    case "request-code":
      return 3;
    case "complete":
      return 6;
    case "cancel":
      return 8;
    default:
      throw new ValidationError(`Unsupported HeroSMS action: ${String(action)}`);
  }
}

function parseHeroSmsApiPayload(rawText: string): unknown {
  if (!rawText) {
    return "";
  }

  if (rawText.startsWith("{") || rawText.startsWith("[")) {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }

  return rawText;
}

function extractHeroSmsErrorMessage(data: unknown): string | undefined {
  if (typeof data === "string") {
    return data;
  }

  const payload = getRecord(data) as HeroSmsApiErrorPayload;
  if (payload.title && payload.details) {
    return `${payload.title}: ${payload.details}`;
  }
  if (payload.details) {
    return payload.details;
  }
  if (payload.title) {
    return payload.title;
  }
  return undefined;
}

function unwrapHeroSmsPriceMatrix(raw: unknown): unknown {
  const payload = getRecord(raw);
  for (const key of ["data", "result", "prices", "countries", "response"]) {
    if (payload[key] && typeof payload[key] === "object") {
      return unwrapHeroSmsPriceMatrix(payload[key]);
    }
  }
  return raw;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function parseIntegerValue(value: unknown): number | null {
  const normalized = Number.parseInt(String(value ?? "").replace(/[^0-9-]+/g, ""), 10);
  return Number.isFinite(normalized) ? normalized : null;
}

function parseNumberValue(value: unknown): number | null {
  const normalized = Number.parseFloat(String(value ?? "").replace(/[^0-9.]+/g, ""));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeDialCode(value: unknown): string | undefined {
  const normalized = String(value ?? "").replace(/^\+/, "").trim();
  return normalized ? `+${normalized}` : undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  const numeric = parseIntegerValue(value);
  if (numeric === 0) {
    return false;
  }
  if (numeric === 1) {
    return true;
  }
  return undefined;
}

function normalizePhoneNumber(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}
