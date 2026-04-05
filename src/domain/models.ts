export type SmsProviderKey =
  | "freephonenum"
  | "jiemahao"
  | "onlinesim"
  | "quackr"
  | "receivesms_co"
  | "receive_smss"
  | "temp_number"
  | "temporary_phone_number"
  | "receive_sms_free_cc"
  | "yunduanxin"
  | "sms24";

export interface ProviderDescriptor {
  key: SmsProviderKey;
  displayName: string;
  homepageUrl: string;
  sourceType: "public-web-scrape";
  capabilities: string[];
  enabled: boolean;
  countryHints: string[];
  notes: string[];
}

export interface SmsNumberReference {
  providerKey: SmsProviderKey;
  sourceUrl: string;
  phoneNumber: string;
  countryName?: string;
  countryCode?: string;
  label?: string;
}

export interface SmsPublicNumber {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  numberId: string;
  sourceUrl: string;
  phoneNumber: string;
  countryName?: string;
  countryCode?: string;
  label?: string;
  latestActivityText?: string;
}

export interface SmsInboxMessage {
  id: string;
  sender?: string;
  receivedAtText?: string;
  receivedAtIso?: string;
  content: string;
  sourceUrl: string;
}

export interface SmsInboxSnapshot {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  numberId: string;
  phoneNumber: string;
  countryName?: string;
  countryCode?: string;
  sourceUrl: string;
  fetchedAtIso: string;
  messages: SmsInboxMessage[];
}

export interface ProviderFetchIssue {
  providerKey: string;
  message: string;
}

export type SmsProviderOperationalStatus =
  | "active"
  | "cooling"
  | "temporarily_disabled"
  | "degraded"
  | "offline";

export type SmsProviderHealthState =
  | "unknown"
  | "healthy"
  | "empty"
  | "challenge"
  | "blocked"
  | "degraded";

export type SmsProviderRouteKind = "list-public-numbers" | "read-public-inbox";
export type SmsProviderRouteScopeKind = "provider" | "country";

export interface SmsProviderHealthSnapshot {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  status: SmsProviderOperationalStatus;
  healthState: SmsProviderHealthState;
  healthScore: number;
  consecutiveFailures: number;
  activeRouteCoolingCount: number;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastEmptyAt?: string;
  lastRouteKind?: SmsProviderRouteKind;
  lastDetail?: string;
  lastErrorClass?: string;
  lastErrorMessage?: string;
  cooldownUntil?: string;
  temporarilyDisabledUntil?: string;
  temporarilyDisabledReason?: string;
}

export interface SmsProviderRouteHealthSnapshot {
  routeKey: string;
  providerKey: SmsProviderKey;
  routeKind: SmsProviderRouteKind;
  scopeKind: SmsProviderRouteScopeKind;
  scopeValue: string;
  penalty: number;
  consecutiveFailures: number;
  cooldownUntil?: string;
  lastErrorClass?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastReportedAt?: string;
}

export interface SmsProviderHealthProbeResult {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  ok: boolean;
  status: SmsProviderOperationalStatus;
  healthState: SmsProviderHealthState;
  healthScore: number;
  routeKind: SmsProviderRouteKind;
  checkedAt: string;
  detail?: string;
  publicNumberCount?: number;
  inboxMessageCount?: number;
  routeKey?: string;
  cooldownApplied?: boolean;
}

export interface SmsProviderProbeHistoryEntry {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  checkedAt: string;
  routeKind: SmsProviderRouteKind;
  ok: boolean;
  healthState: SmsProviderHealthState;
  status: SmsProviderOperationalStatus;
  errorClass?: string;
  detail?: string;
  publicNumberCount?: number;
  inboxMessageCount?: number;
}

export interface SmsProviderProbeTrendSnapshot {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  windowStartAt?: string;
  windowEndAt: string;
  sampleCount: number;
  successCount: number;
  emptyCount: number;
  challengeCount: number;
  blockedCount: number;
  degradedCount: number;
  errorClassCounts: Record<string, number>;
  lastCheckedAt?: string;
  trendPenalty: number;
  trendScore: number;
}

export interface SmsProviderHealthSummary {
  totalProviders: number;
  activeCount: number;
  coolingCount: number;
  temporarilyDisabledCount: number;
  degradedCount: number;
  challengeCount: number;
  blockedCount: number;
  emptyCount: number;
}

export interface EasySmsRuntimeStateSnapshot {
  providers: SmsProviderHealthSnapshot[];
  routes: SmsProviderRouteHealthSnapshot[];
  probeHistory: SmsProviderProbeHistoryEntry[];
  updatedAt: string;
}

export interface SmsProviderSelectionCandidate {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  routeKind: SmsProviderRouteKind;
  scopeKind: SmsProviderRouteScopeKind;
  scopeValue: string;
  providerStatus: SmsProviderOperationalStatus;
  healthState: SmsProviderHealthState;
  healthScore: number;
  available: boolean;
  availabilityIssue?: string;
  exactRoutePenalty: number;
  providerRoutePenalty: number;
  errorClassPenalty: number;
  emptyPenalty: number;
  statusPenalty: number;
  trendPenalty: number;
  trendScore: number;
  effectiveScore: number;
  fallbackRank: number;
  notes: string[];
}

export interface ListPublicNumbersOptions {
  providerKey?: string;
  limit?: number;
  countryCode?: string;
  countryName?: string;
}

export interface GetInboxOptions {
  providerKey: string;
  numberId: string;
}

export interface ListPublicNumbersResult {
  items: SmsPublicNumber[];
  errors: ProviderFetchIssue[];
}

export interface EasySmsRuntimeConfig {
  server: {
    host: string;
    port: number;
    apiKey?: string;
  };
  strategy: {
    strictProviderMode: boolean;
    providerStrategyModeId: string;
  };
  maintenance: {
    enabled: boolean;
    intervalMs: number;
    keepRecentCount: number;
    activeProbeEnabled: boolean;
    activeProbeIntervalMs: number;
    probeHistoryMaxEntries: number;
    probeHistoryWindowMs: number;
  };
  persistence: {
    enabled: boolean;
    driver: string;
    intervalMs: number;
    filePath: string;
  };
  scraping: {
    requestTimeoutMs: number;
    maxNumbersPerProvider: number;
    userAgent: string;
  };
  providers: {
    enabledProviders: string[];
  };
}
