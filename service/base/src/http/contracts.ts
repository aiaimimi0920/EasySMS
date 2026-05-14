import { ValidationError } from "../domain/errors.js";
import type {
  CostTier,
  GetInboxOptions,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  ListPublicNumbersOptions,
  ObserveSmsMessageInput,
  RecoverSmsSessionByPhoneRequest,
  EasySmsSnapshotMode,
  SmsProviderHealthQueryFilters,
  SmsProviderProbeHistoryQueryFilters,
  SmsSessionMessageQueryFilters,
  SmsSessionMode,
  SmsSessionOutcomeReport,
  SmsSessionQueryFilters,
} from "../domain/models.js";

export const EASY_SMS_HTTP_ROUTES = {
  catalog: "/sms/catalog",
  snapshot: "/sms/snapshot",
  planSession: "/sms/sessions/plan",
  openSession: "/sms/sessions/open",
  recoverSessionByPhone: "/sms/sessions/recover-by-phone",
  reportSessionOutcome: "/sms/sessions/report-outcome",
  observeMessage: "/sms/messages/observe",
  querySessions: "/sms/query/sessions",
  queryMessages: "/sms/query/messages",
  getQuerySession(sessionId: string): string {
    return `/sms/query/sessions/${encodeURIComponent(sessionId)}`;
  },
  getQueryMessage(messageId: string): string {
    return `/sms/query/messages/${encodeURIComponent(messageId)}`;
  },
  queryProviders: "/sms/query/providers",
  queryRuntime: "/sms/query/runtime",
  queryProviderHealth: "/sms/query/providers/health",
  queryProviderProbeHistory: "/sms/query/providers/probe-history",
  queryProviderSelectionPlan: "/sms/query/providers/selection-plan",
  queryHeroSmsStats: "/sms/query/providers/hero_sms/stats",
  queryStats: "/sms/query/stats",
  probeAllProviders: "/sms/providers/probe-all",
  runMaintenance: "/sms/maintenance/run",
  readSessionCode(sessionId: string): string {
    return `/sms/sessions/${encodeURIComponent(sessionId)}/code`;
  },
  readSessionMessages(sessionId: string): string {
    return `/sms/sessions/${encodeURIComponent(sessionId)}/messages`;
  },
  readSessionStatus(sessionId: string): string {
    return `/sms/sessions/${encodeURIComponent(sessionId)}/status`;
  },
  updateSessionAction(sessionId: string): string {
    return `/sms/sessions/${encodeURIComponent(sessionId)}/actions`;
  },
  probeProvider(providerKey: string): string {
    return `/sms/providers/${encodeURIComponent(providerKey)}/probe`;
  },
} as const;

export function parseListPublicNumbersOptions(url: URL): ListPublicNumbersOptions {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  if (limitParam && (!Number.isFinite(limit) || limit <= 0)) {
    throw new ValidationError("limit must be a positive integer.");
  }

  return {
    providerKey: url.searchParams.get("providerKey") ?? undefined,
    limit: limit ?? undefined,
    countryCode: url.searchParams.get("countryCode") ?? undefined,
    countryName: url.searchParams.get("countryName") ?? undefined,
    costTier: parseCostTier(url.searchParams.get("costTier")),
  };
}

export function parseGetInboxOptions(url: URL): GetInboxOptions {
  const providerKey = url.searchParams.get("providerKey");
  const numberId = url.searchParams.get("numberId");

  if (!providerKey) {
    throw new ValidationError("providerKey is required.");
  }

  if (!numberId) {
    throw new ValidationError("numberId is required.");
  }

  return {
    providerKey,
    numberId,
  };
}

export function parseSnapshotModeQuery(url: URL): EasySmsSnapshotMode {
  const mode = url.searchParams.get("mode");
  if (!mode || mode === "summary") {
    return "summary";
  }
  if (mode === "detail") {
    return "detail";
  }
  throw new ValidationError("mode must be either summary or detail.");
}

export function parseSessionQueryFilters(url: URL): SmsSessionQueryFilters {
  const providerKey = url.searchParams.get("providerKey");
  const since = parseDateTimeQuery(url.searchParams.get("since"), "since");
  const until = parseDateTimeQuery(url.searchParams.get("until"), "until");
  validateDateTimeRange(since, until);
  return {
    providerKey: providerKey ? providerKey as SmsSessionQueryFilters["providerKey"] : undefined,
    costTier: parseCostTier(url.searchParams.get("costTier")),
    sessionMode: parseSessionMode(url.searchParams.get("sessionMode")),
    phoneNumber: url.searchParams.get("phoneNumber") ?? undefined,
    service: url.searchParams.get("service") ?? undefined,
    countryCode: url.searchParams.get("countryCode") ?? undefined,
    countryName: url.searchParams.get("countryName") ?? undefined,
    hasCode: parseBooleanQuery(url.searchParams.get("hasCode")),
    hasOutcome: parseBooleanQuery(url.searchParams.get("hasOutcome")),
    since,
    until,
    newestFirst: parseBooleanQuery(url.searchParams.get("newestFirst")),
    limit: parseLimitQuery(url.searchParams.get("limit")),
  };
}

export function parseSessionMessageQueryFilters(url: URL): SmsSessionMessageQueryFilters {
  const providerKey = url.searchParams.get("providerKey");
  const since = parseDateTimeQuery(url.searchParams.get("since"), "since");
  const until = parseDateTimeQuery(url.searchParams.get("until"), "until");
  validateDateTimeRange(since, until);
  const sourceType = url.searchParams.get("sourceType");
  if (
    sourceType !== null
    && sourceType !== "provider-inbox"
    && sourceType !== "activation-status"
    && sourceType !== "manual-observe"
  ) {
    throw new ValidationError("sourceType must be provider-inbox, activation-status, or manual-observe.");
  }
  return {
    sessionId: url.searchParams.get("sessionId") ?? undefined,
    providerKey: providerKey ? providerKey as SmsSessionMessageQueryFilters["providerKey"] : undefined,
    sourceType: sourceType ? sourceType as SmsSessionMessageQueryFilters["sourceType"] : undefined,
    extractedCodeOnly: parseBooleanQuery(url.searchParams.get("extractedCodeOnly")),
    includeProjected: parseBooleanQuery(url.searchParams.get("includeProjected")),
    includeManual: parseBooleanQuery(url.searchParams.get("includeManual")),
    refreshProjected: parseBooleanQuery(url.searchParams.get("refreshProjected")),
    since,
    until,
    newestFirst: parseBooleanQuery(url.searchParams.get("newestFirst")),
    limit: parseLimitQuery(url.searchParams.get("limit")),
  };
}

export function parseProviderProbeHistoryQuery(url: URL): SmsProviderProbeHistoryQueryFilters {
  const providerKey = url.searchParams.get("providerKey");
  const since = parseDateTimeQuery(url.searchParams.get("since"), "since");
  const until = parseDateTimeQuery(url.searchParams.get("until"), "until");
  validateDateTimeRange(since, until);
  const routeKind = url.searchParams.get("routeKind");
  if (routeKind !== null && routeKind !== "list-public-numbers" && routeKind !== "read-public-inbox") {
    throw new ValidationError("routeKind must be list-public-numbers or read-public-inbox.");
  }
  const healthState = url.searchParams.get("healthState");
  if (
    healthState !== null
    && healthState !== "unknown"
    && healthState !== "healthy"
    && healthState !== "empty"
    && healthState !== "challenge"
    && healthState !== "blocked"
    && healthState !== "degraded"
  ) {
    throw new ValidationError("healthState must be one of unknown, healthy, empty, challenge, blocked, degraded.");
  }

  return {
    providerKey: parseProviderKeyQuery(providerKey),
    mode: parseResponseShapeMode(url.searchParams.get("mode"), "detail"),
    includeHistory: parseBooleanQuery(url.searchParams.get("includeHistory")),
    includeTrends: parseBooleanQuery(url.searchParams.get("includeTrends")),
    routeKind: routeKind ? routeKind as SmsProviderProbeHistoryQueryFilters["routeKind"] : undefined,
    healthState: healthState ? healthState as SmsProviderProbeHistoryQueryFilters["healthState"] : undefined,
    since,
    until,
    newestFirst: parseBooleanQuery(url.searchParams.get("newestFirst")),
    limit: parseLimitQuery(url.searchParams.get("limit")),
  };
}

export function parseProviderHealthQuery(url: URL): SmsProviderHealthQueryFilters {
  return {
    providerKey: parseProviderKeyQuery(url.searchParams.get("providerKey")),
    mode: parseResponseShapeMode(url.searchParams.get("mode"), "detail"),
    includeProviders: parseBooleanQuery(url.searchParams.get("includeProviders")),
    includeRoutes: parseBooleanQuery(url.searchParams.get("includeRoutes")),
    includeTrends: parseBooleanQuery(url.searchParams.get("includeTrends")),
  };
}

export function parseProviderCatalogQuery(
  url: URL,
): { costTier?: CostTier; capability?: string } {
  const capability = url.searchParams.get("capability")?.trim() || undefined;
  return {
    costTier: parseCostTier(url.searchParams.get("costTier")),
    capability,
  };
}

export function parseHeroSmsServiceQuery(url: URL): string | undefined {
  const service = url.searchParams.get("service")?.trim();
  return service || undefined;
}

export function parseHeroSmsCountryQuery(url: URL): number {
  const rawCountry = url.searchParams.get("country");
  const country = rawCountry ? Number.parseInt(rawCountry, 10) : Number.NaN;
  if (!rawCountry || !Number.isFinite(country)) {
    throw new ValidationError("country must be a valid integer.");
  }
  return country;
}

export function parseHeroSmsRankedQuery(url: URL): boolean {
  const rawRanked = url.searchParams.get("ranked");
  if (rawRanked === null) {
    return true;
  }
  if (rawRanked === "true") {
    return true;
  }
  if (rawRanked === "false") {
    return false;
  }
  throw new ValidationError("ranked must be true or false.");
}

export function parseHeroSmsActivationId(value: string | undefined): number {
  const activationId = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!value || !Number.isFinite(activationId)) {
    throw new ValidationError("activationId must be a valid integer.");
  }
  return activationId;
}

export function parseHandlerApiAction(url: URL): string {
  const action = url.searchParams.get("action")?.trim();
  if (!action) {
    throw new ValidationError("action is required.");
  }
  return action;
}

export function parseHeroSmsActivationCreateInput(body: unknown): HeroSmsActivationCreateInput {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const input: HeroSmsActivationCreateInput = {};

  if (typeof payload.service === "string" && payload.service.trim()) {
    input.service = payload.service.trim();
  }
  if (payload.country !== undefined) {
    const country = Number.parseInt(String(payload.country), 10);
    if (!Number.isFinite(country)) {
      throw new ValidationError("country must be a valid integer when provided.");
    }
    input.country = country;
  }
  if (typeof payload.countryCode === "string" && payload.countryCode.trim()) {
    input.countryCode = payload.countryCode.trim();
  }
  if (typeof payload.countryName === "string" && payload.countryName.trim()) {
    input.countryName = payload.countryName.trim();
  }
  if (typeof payload.numberId === "string" && payload.numberId.trim()) {
    input.numberId = payload.numberId.trim();
  }
  if (typeof payload.operator === "string" && payload.operator.trim()) {
    input.operator = payload.operator.trim();
  }
  if (payload.maxPrice !== undefined) {
    const maxPrice = Number(payload.maxPrice);
    if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
      throw new ValidationError("maxPrice must be a positive number when provided.");
    }
    input.maxPrice = maxPrice;
  }
  if (payload.fixedPrice !== undefined) {
    if (typeof payload.fixedPrice !== "boolean") {
      throw new ValidationError("fixedPrice must be a boolean when provided.");
    }
    input.fixedPrice = payload.fixedPrice;
  }
  if (typeof payload.ref === "string" && payload.ref.trim()) {
    input.ref = payload.ref.trim();
  }
  if (typeof payload.phoneException === "string" && payload.phoneException.trim()) {
    input.phoneException = payload.phoneException.trim();
  }
  if (typeof payload.selectionMode === "string" && payload.selectionMode.trim()) {
    const selectionMode = payload.selectionMode.trim();
    if (!["price-first", "success-first", "stock-first", "balanced"].includes(selectionMode)) {
      throw new ValidationError("selectionMode must be price-first, success-first, stock-first, or balanced when provided.");
    }
    input.selectionMode = selectionMode as HeroSmsActivationCreateInput["selectionMode"];
  }
  if (payload.allowReuse !== undefined) {
    if (typeof payload.allowReuse !== "boolean") {
      throw new ValidationError("allowReuse must be a boolean when provided.");
    }
    input.allowReuse = payload.allowReuse;
  }
  if (typeof payload.businessKey === "string" && payload.businessKey.trim()) {
    input.businessKey = payload.businessKey.trim();
  }
  if (payload.maxBindingsPerPhone !== undefined) {
    const maxBindingsPerPhone = Number.parseInt(String(payload.maxBindingsPerPhone), 10);
    if (!Number.isFinite(maxBindingsPerPhone) || maxBindingsPerPhone <= 0) {
      throw new ValidationError("maxBindingsPerPhone must be a positive integer when provided.");
    }
    input.maxBindingsPerPhone = maxBindingsPerPhone;
  }

  return input;
}

export function parseActivationCreateInputFromUrl(url: URL): HeroSmsActivationCreateInput {
  const payload: Record<string, unknown> = {};
  for (const key of [
    "service",
    "country",
    "countryCode",
    "countryName",
    "numberId",
    "operator",
    "maxPrice",
    "fixedPrice",
    "ref",
    "phoneException",
    "selectionMode",
    "allowReuse",
    "businessKey",
    "maxBindingsPerPhone",
  ]) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      payload[key] = value;
    }
  }

  if (payload.fixedPrice !== undefined) {
    payload.fixedPrice = String(payload.fixedPrice).toLowerCase() === "true";
  }
  if (payload.allowReuse !== undefined) {
    payload.allowReuse = String(payload.allowReuse).toLowerCase() === "true";
  }

  return parseHeroSmsActivationCreateInput(payload);
}

export function parseHeroSmsActivationAction(value: string | undefined): HeroSmsActivationAction {
  switch (value) {
    case "request-code":
    case "complete":
    case "cancel":
      return value;
    default:
      throw new ValidationError("HeroSMS activation action must be request-code, complete, or cancel.");
  }
}

export function parseActivationProviderSelectorFromUrl(
  url: URL,
): { providerKey?: string; costTier?: CostTier } {
  return {
    providerKey: url.searchParams.get("providerKey") ?? undefined,
    costTier: parseCostTier(url.searchParams.get("costTier")),
  };
}

export function parseActivationCreateRequest(
  body: unknown,
): { providerKey?: string; costTier?: CostTier; input: HeroSmsActivationCreateInput } {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  return {
    providerKey: typeof payload.providerKey === "string" && payload.providerKey.trim()
      ? payload.providerKey.trim()
      : undefined,
    costTier: parseCostTier(typeof payload.costTier === "string" ? payload.costTier : null),
    input: parseHeroSmsActivationCreateInput(body),
  };
}

export function parseSmsSessionOpenRequest(
  body: unknown,
): { providerKey?: string; costTier?: CostTier; input: HeroSmsActivationCreateInput } {
  return parseActivationCreateRequest(body);
}

export function parseSmsSessionPlanRequest(
  body: unknown,
): { providerKey?: string; costTier?: CostTier; input: HeroSmsActivationCreateInput } {
  return parseActivationCreateRequest(body);
}

export function parseActivationActionRequest(
  body: unknown,
): { providerKey?: string; costTier?: CostTier; action: HeroSmsActivationAction } {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  return {
    providerKey: typeof payload.providerKey === "string" && payload.providerKey.trim()
      ? payload.providerKey.trim()
      : undefined,
    costTier: parseCostTier(typeof payload.costTier === "string" ? payload.costTier : null),
    action: parseHeroSmsActivationAction(
      typeof payload.action === "string" ? payload.action : undefined,
    ),
  };
}

export function parseRecoverSessionByPhoneRequest(body: unknown): RecoverSmsSessionByPhoneRequest {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const phoneNumber = typeof payload.phoneNumber === "string" ? payload.phoneNumber.trim() : "";
  if (!phoneNumber) {
    throw new ValidationError("phoneNumber is required.");
  }

  return {
    phoneNumber,
    providerKey: typeof payload.providerKey === "string" && payload.providerKey.trim()
      ? payload.providerKey.trim() as RecoverSmsSessionByPhoneRequest["providerKey"]
      : undefined,
  };
}

export function parseSessionOutcomeReport(body: unknown): SmsSessionOutcomeReport {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (!sessionId) {
    throw new ValidationError("sessionId is required.");
  }
  if (typeof payload.success !== "boolean") {
    throw new ValidationError("success must be a boolean.");
  }

  return {
    sessionId,
    success: payload.success,
    failureReason: typeof payload.failureReason === "string" && payload.failureReason.trim()
      ? payload.failureReason.trim()
      : undefined,
    observedAt: typeof payload.observedAt === "string" && payload.observedAt.trim()
      ? payload.observedAt.trim()
      : undefined,
    source: typeof payload.source === "string" && payload.source.trim()
      ? payload.source.trim()
      : undefined,
    detail: typeof payload.detail === "string" && payload.detail.trim()
      ? payload.detail.trim()
      : undefined,
  };
}

export function parseObserveSmsMessageRequest(body: unknown): ObserveSmsMessageInput {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!sessionId) {
    throw new ValidationError("sessionId is required.");
  }
  if (!content) {
    throw new ValidationError("content is required.");
  }

  return {
    sessionId,
    sender: typeof payload.sender === "string" && payload.sender.trim() ? payload.sender.trim() : undefined,
    receivedAtText: typeof payload.receivedAtText === "string" && payload.receivedAtText.trim()
      ? payload.receivedAtText.trim()
      : undefined,
    receivedAtIso: typeof payload.receivedAtIso === "string" && payload.receivedAtIso.trim()
      ? payload.receivedAtIso.trim()
      : undefined,
    content,
    code: typeof payload.code === "string" && payload.code.trim() ? payload.code.trim() : undefined,
    sourceUrl: typeof payload.sourceUrl === "string" && payload.sourceUrl.trim() ? payload.sourceUrl.trim() : undefined,
  };
}

export function parseTemporaryDisableInput(
  body: unknown,
  now: Date = new Date(),
): { reason: string; until: Date } {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const reason = typeof payload.reason === "string" && payload.reason.trim()
    ? payload.reason.trim()
    : "manual_temporary_disable";
  const durationMs = typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
    ? payload.durationMs
    : undefined;
  const until = typeof payload.until === "string" && payload.until.trim()
    ? new Date(payload.until)
    : undefined;

  if (until && Number.isNaN(until.getTime())) {
    throw new ValidationError("until must be a valid ISO timestamp.");
  }

  if (durationMs !== undefined && durationMs <= 0) {
    throw new ValidationError("durationMs must be a positive number.");
  }

  if (!until && durationMs === undefined) {
    return {
      reason,
      until: new Date(now.getTime() + 60 * 60 * 1000),
    };
  }

  return {
    reason,
    until: until ?? new Date(now.getTime() + (durationMs as number)),
  };
}

function parseCostTier(value: string | null): CostTier | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  if (value === "free" || value === "paid") {
    return value;
  }

  throw new ValidationError("costTier must be free or paid.");
}

function parseDateTimeQuery(value: string | null, fieldName: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid ISO datetime.`);
  }
  return parsed;
}

function validateDateTimeRange(since: Date | undefined, until: Date | undefined): void {
  if (!since || !until) {
    return;
  }
  if (since.getTime() > until.getTime()) {
    throw new ValidationError("since must be earlier than or equal to until.");
  }
}

function parseResponseShapeMode(
  value: string | null,
  defaultMode: EasySmsSnapshotMode,
): EasySmsSnapshotMode {
  if (!value || value.trim() === "") {
    return defaultMode;
  }
  if (value === "summary" || value === "detail") {
    return value;
  }
  throw new ValidationError("mode must be either summary or detail.");
}

function parseProviderKeyQuery(value: string | null): SmsProviderHealthQueryFilters["providerKey"] | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }
  return value.trim() as SmsProviderHealthQueryFilters["providerKey"];
}

function parseSessionMode(value: string | null): SmsSessionMode | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  if (value === "paid-api" || value === "synthetic-public-inbox") {
    return value;
  }

  throw new ValidationError("sessionMode must be paid-api or synthetic-public-inbox.");
}

function parseBooleanQuery(value: string | null): boolean | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new ValidationError(`Boolean query value is invalid: ${value}`);
}

function parseLimitQuery(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`Limit query value is invalid: ${value}`);
  }

  return parsed;
}
