export type SmsProviderKey =
  | "onlinesim"
  | "smstome"
  | "receive_smss"
  | "receive_sms_free_cc"
  | "yunduanxin"
  | "sms24"
  | "hero_sms";

export type CostTier = "free" | "paid";
export type SmsSessionMode = "paid-api" | "synthetic-public-inbox";

export interface ProviderDescriptor {
  key: SmsProviderKey;
  displayName: string;
  homepageUrl: string;
  sourceType: "public-web-scrape" | "otp-activation-api";
  costTier: CostTier;
  capabilities: string[];
  enabled: boolean;
  countryHints?: string[];
  notes: string[];
}

export interface HeroSmsCountry {
  providerKey: SmsProviderKey;
  countryId: number;
  apiName: string;
  isoCode?: string;
  dialCode?: string;
  visible?: boolean;
  retry?: boolean;
}

export interface HeroSmsCountryPrice extends HeroSmsCountry {
  service: string;
  price: number;
  count?: number | null;
}

export interface HeroSmsOperatorQuote {
  providerKey: SmsProviderKey;
  service: string;
  countryId: number;
  operator: string;
  price?: number | null;
  count?: number | null;
  error?: string;
}

export type HeroSmsSelectionMode = "price-first" | "success-first" | "stock-first" | "balanced";

export interface HeroSmsActivationCreateInput {
  service?: string;
  country?: number;
  countryCode?: string;
  countryName?: string;
  numberId?: string;
  operator?: string;
  maxPrice?: number;
  fixedPrice?: boolean;
  ref?: string;
  phoneException?: string;
  selectionMode?: HeroSmsSelectionMode;
  allowReuse?: boolean;
  businessKey?: string;
  maxBindingsPerPhone?: number;
}

export interface HeroSmsActivationSession {
  providerKey: SmsProviderKey;
  activationId: number;
  upstreamActivationId?: number;
  sessionId?: string;
  phoneNumber: string;
  service: string;
  countryId: number;
  countryCode?: string;
  countryName?: string;
  numberId?: string;
  sourceUrl?: string;
  operator?: string;
  activationCost?: number | null;
  costTier?: CostTier;
  sessionMode?: SmsSessionMode;
  selectionMode?: HeroSmsSelectionMode;
  businessKey?: string;
  assignmentIndex?: number;
  maxBindingsPerPhone?: number;
  refundableCancelAvailableAtIso?: string;
  leaseExpiresAtIso?: string;
  refundEligible?: boolean;
  createdAtIso: string;
}

export interface HeroSmsActivationStatusSnapshot {
  providerKey: SmsProviderKey;
  activationId: number;
  upstreamActivationId?: number;
  sessionId?: string;
  fetchedAtIso: string;
  received: boolean;
  cancelled: boolean;
  numberId?: string;
  sourceUrl?: string;
  countryCode?: string;
  countryName?: string;
  messageCount?: number;
  verificationType?: number;
  code?: string;
  text?: string;
  receivedAtIso?: string;
  callFrom?: string;
  callText?: string;
  callCode?: string;
  callReceivedAtIso?: string;
  callAudioUrl?: string;
  rawStatusText?: string;
  costTier?: CostTier;
  sessionMode?: SmsSessionMode;
  selectionMode?: HeroSmsSelectionMode;
  businessKey?: string;
  assignmentIndex?: number;
  maxBindingsPerPhone?: number;
  refundableCancelAvailableAtIso?: string;
  leaseExpiresAtIso?: string;
  refundEligible?: boolean;
}

export type HeroSmsActivationAction = "request-code" | "complete" | "cancel";

export interface HeroSmsActivationStatusUpdateResult {
  providerKey: SmsProviderKey;
  activationId: number;
  upstreamActivationId?: number;
  sessionId?: string;
  requestedAction: HeroSmsActivationAction;
  requestedStatus: number;
  resultText: string;
  costTier?: CostTier;
  sessionMode?: SmsSessionMode;
  selectionMode?: HeroSmsSelectionMode;
  businessKey?: string;
  assignmentIndex?: number;
  maxBindingsPerPhone?: number;
  refundableCancelAvailableAtIso?: string;
  leaseExpiresAtIso?: string;
  refundEligible?: boolean;
  updatedAtIso: string;
}

export interface EasySmsManagedSessionSnapshot {
  id: string;
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  activationId: number;
  upstreamActivationId?: number;
  sessionMode: SmsSessionMode;
  costTier: CostTier;
  numberId?: string;
  phoneNumber: string;
  sourceUrl?: string;
  service: string;
  countryId: number;
  countryCode?: string;
  countryName?: string;
  operator?: string;
  activationCost?: number | null;
  selectionMode?: HeroSmsSelectionMode;
  businessKey?: string;
  assignmentIndex?: number;
  maxBindingsPerPhone?: number;
  refundableCancelAvailableAtIso?: string;
  leaseExpiresAtIso?: string;
  baselineCode?: string;
  baselineText?: string;
  baselineReceivedAtIso?: string;
  openedAtIso: string;
  cancelledAtIso?: string;
  completedAtIso?: string;
  lastRequestedCodeAtIso?: string;
  lastStatusAtIso?: string;
  lastCode?: string;
  lastCodeAtIso?: string;
  lastText?: string;
  lastReportedOutcome?: SmsSessionOutcomeReportSnapshot;
}

export interface SmsSessionMessage {
  id: string;
  sessionId: string;
  providerKey: SmsProviderKey;
  sourceType: "provider-inbox" | "activation-status" | "manual-observe";
  sender?: string;
  receivedAtText?: string;
  receivedAtIso?: string;
  content: string;
  code?: string;
  sourceUrl?: string;
  observedAtIso: string;
}

export interface SmsSessionCodeResult {
  sessionId: string;
  providerKey: SmsProviderKey;
  code?: string;
  source: "provider-inbox" | "activation-status" | "manual-observe" | "none";
  observedMessageId?: string;
  receivedAtIso?: string;
  text?: string;
  candidates: string[];
}

export interface SmsSessionPlanResult {
  planned: boolean;
  routeKind: "open-sms-session";
  providerKey?: SmsProviderKey;
  providerDisplayName?: string;
  costTier?: CostTier;
  sessionMode?: SmsSessionMode;
  countryId?: number;
  countryCode?: string;
  countryName?: string;
  numberId?: string;
  phoneNumber?: string;
  compatibilityAction?: "getNumberV2";
  notes: string[];
}

export interface SmsSessionOutcomeReport {
  sessionId: string;
  success: boolean;
  failureReason?: string;
  observedAt?: string;
  source?: string;
  detail?: string;
}

export interface SmsSessionOutcomeReportSnapshot extends SmsSessionOutcomeReport {
  recordedAtIso: string;
  providerKey: SmsProviderKey;
}

export interface SmsSessionOutcomeReportResult {
  accepted: boolean;
  sessionId: string;
  providerKey: SmsProviderKey;
  recordedAtIso: string;
  detail?: string;
}

export interface ObserveSmsMessageInput {
  sessionId: string;
  sender?: string;
  receivedAtText?: string;
  receivedAtIso?: string;
  content: string;
  code?: string;
  sourceUrl?: string;
}

export interface RecoverSmsSessionByPhoneRequest {
  phoneNumber: string;
  providerKey?: SmsProviderKey;
}

export interface RecoverSmsSessionByPhoneResult {
  recovered: boolean;
  strategy: "session_restore" | "not_supported";
  session?: EasySmsManagedSessionSnapshot;
  detail?: string;
}

export interface SmsCatalog {
  providers: ProviderDescriptor[];
  strategyModeId: string;
  compatibility: {
    facadePath: string;
    supportedActions: string[];
  };
}

export interface EasySmsRuntimeLoopSnapshot {
  enabled: boolean;
  intervalMs?: number;
  runCount: number;
  successCount: number;
  failureCount: number;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  lastDurationMs?: number;
  detail?: string;
  lastError?: string;
}

export interface EasySmsRuntimeStateLoadSnapshot {
  attempted: boolean;
  status: "not_attempted" | "skipped" | "loaded" | "empty" | "failed";
  checkedAt?: string;
  detail?: string;
  lastError?: string;
}

export interface EasySmsRuntimeDiagnostics {
  serviceStartedAt: string;
  stateStore: {
    enabled: boolean;
    driver: string;
    filePath: string;
  };
  stateLoad: EasySmsRuntimeStateLoadSnapshot;
  maintenanceLoop: EasySmsRuntimeLoopSnapshot;
  activeProbeLoop: EasySmsRuntimeLoopSnapshot;
  persistenceLoop: EasySmsRuntimeLoopSnapshot;
}

export type EasySmsSnapshotMode = "summary" | "detail";

export interface EasySmsPublicRuntimeStateSnapshot {
  providers: SmsProviderHealthSnapshot[];
  routes: SmsProviderRouteHealthSnapshot[];
  probeHistory?: SmsProviderProbeHistoryEntry[];
  nextSyntheticActivationId?: number;
  nextSessionSequence?: number;
  updatedAt: string;
}

export interface EasySmsSnapshot {
  mode: EasySmsSnapshotMode;
  catalog: SmsCatalog;
  runtime: EasySmsRuntimeDiagnostics;
  runtimeState: EasySmsPublicRuntimeStateSnapshot;
  sessions?: EasySmsManagedSessionSnapshot[];
  observedMessages?: SmsSessionMessage[];
  projectedMessages?: SmsSessionMessage[];
}

export interface SmsSessionQueryFilters {
  providerKey?: SmsProviderKey;
  costTier?: CostTier;
  sessionMode?: SmsSessionMode;
  phoneNumber?: string;
  service?: string;
  countryCode?: string;
  countryName?: string;
  hasCode?: boolean;
  hasOutcome?: boolean;
  since?: Date;
  until?: Date;
  newestFirst?: boolean;
  limit?: number;
}

export interface SmsSessionMessageQueryFilters {
  sessionId?: string;
  providerKey?: SmsProviderKey;
  sourceType?: SmsSessionMessage["sourceType"];
  extractedCodeOnly?: boolean;
  includeProjected?: boolean;
  includeManual?: boolean;
  refreshProjected?: boolean;
  since?: Date;
  until?: Date;
  newestFirst?: boolean;
  limit?: number;
}

export interface SmsProviderProbeHistoryQueryFilters {
  providerKey?: SmsProviderKey;
  mode?: EasySmsSnapshotMode;
  includeHistory?: boolean;
  includeTrends?: boolean;
  routeKind?: SmsProviderRouteKind;
  healthState?: SmsProviderHealthState;
  since?: Date;
  until?: Date;
  newestFirst?: boolean;
  limit?: number;
}

export interface SmsProviderHealthQueryFilters {
  providerKey?: SmsProviderKey;
  mode?: EasySmsSnapshotMode;
  includeProviders?: boolean;
  includeRoutes?: boolean;
  includeTrends?: boolean;
}

export interface SmsPersistenceStats {
  sessionCount: number;
  observedMessageCount: number;
  providerCount: number;
  syntheticSessionCount: number;
  paidSessionCount: number;
  storedObservedMessageCount: number;
  cachedProjectedMessageCount: number;
  heroSmsPaidLeaseCount: number;
  heroSmsActiveReusableLeaseCount: number;
  heroSmsSelectionStats: HeroSmsSelectionStatsSnapshot[];
}

export interface HeroSmsSelectionStatsSnapshot {
  providerKey: "hero_sms";
  service: string;
  countryId: number;
  operator?: string;
  assignmentCount: number;
  successCount: number;
  failureCount: number;
  refundedCancelCount: number;
  paidCancelCount: number;
  successRate: number;
  lastSuccessAtIso?: string;
  lastFailureAtIso?: string;
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
  providerKey: string;
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
  providerKey: string;
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
  providerKey: string;
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
  providerKey: string;
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
  providerKey: string;
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
  managedSessions?: EasySmsManagedSessionSnapshot[];
  observedMessages?: SmsSessionMessage[];
  projectedMessages?: SmsSessionMessage[];
  issuedNumbers?: EasySmsIssuedNumberReference[];
  nextSyntheticActivationId?: number;
  nextSessionSequence?: number;
  updatedAt: string;
}

export interface EasySmsIssuedNumberReference {
  numberId: string;
  reference: SmsNumberReference;
}

export interface SmsProviderSelectionCandidate {
  providerKey: string;
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
  costTier?: CostTier;
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
    onlineSim: {
      apiKey?: string;
    };
    smsToMe: {
      email?: string;
      password?: string;
    };
    receiveSmss: {
      username?: string;
      password?: string;
    };
    receiveSmsFreeCc: {
      email?: string;
      password?: string;
    };
    synthetic: {
      leaseWindowSeconds: number;
      terminalOutcomeCooldownSeconds: number;
    };
    heroSms: {
      enabled: boolean;
      apiKey?: string;
      baseUrl: string;
      defaultService: string;
      defaultCountry: number;
      selectionMode: HeroSmsSelectionMode;
      reuseEnabled: boolean;
      defaultMaxBindingsPerPhone: number;
      refundableCancelWindowSeconds: number;
      leaseWindowSeconds: number;
    };
  };
}
