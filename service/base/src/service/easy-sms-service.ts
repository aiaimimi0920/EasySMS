import {
  ActivationSessionNotFoundError,
  ProviderFetchError,
  ProviderNotFoundError,
  ProviderRouteUnavailableError,
  SmsSessionNotFoundError,
  ValidationError,
} from "../domain/errors.js";
import type {
  CostTier,
  EasySmsManagedSessionSnapshot,
  EasySmsSnapshot,
  EasySmsRuntimeDiagnostics,
  EasySmsRuntimeLoopSnapshot,
  EasySmsSnapshotMode,
  EasySmsPublicRuntimeStateSnapshot,
  ObserveSmsMessageInput,
  RecoverSmsSessionByPhoneRequest,
  RecoverSmsSessionByPhoneResult,
  EasySmsRuntimeStateSnapshot,
  EasySmsRuntimeConfig,
  GetInboxOptions,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  HeroSmsActivationSession,
  HeroSmsActivationStatusSnapshot,
  HeroSmsActivationStatusUpdateResult,
  HeroSmsCountry,
  HeroSmsCountryPrice,
  HeroSmsOperatorQuote,
  HeroSmsSelectionStatsSnapshot,
  HeroSmsSelectionMode,
  ListPublicNumbersOptions,
  ListPublicNumbersResult,
  ProviderDescriptor,
  SmsProviderKey,
  SmsCatalog,
  SmsPersistenceStats,
  SmsProviderHealthProbeResult,
  SmsProviderHealthSnapshot,
  SmsProviderHealthSummary,
  SmsProviderProbeHistoryQueryFilters,
  SmsProviderProbeHistoryEntry,
  SmsProviderProbeTrendSnapshot,
  SmsProviderSelectionCandidate,
  SmsSessionCodeResult,
  SmsSessionMessage,
  SmsSessionMessageQueryFilters,
  SmsSessionOutcomeReport,
  SmsSessionOutcomeReportResult,
  SmsSessionPlanResult,
  SmsSessionQueryFilters,
  SmsProviderRouteHealthSnapshot,
  SmsProviderRouteKind,
  SmsPublicNumber,
  SmsInboxSnapshot,
  SmsNumberReference,
} from "../domain/models.js";
import type { SmsProvider } from "../providers/contracts.js";
import { OnlineSimProvider } from "../providers/onlinesim/index.js";
import { SmsToMeProvider } from "../providers/smstome/index.js";
import { createReceiveSmssProvider } from "../providers/receive_smss/index.js";
import { createReceiveSmsFreeCcProvider } from "../providers/receive_sms_free_cc/index.js";
import { Sms24Provider } from "../providers/sms24/index.js";
import { YunDuanXinProvider } from "../providers/yunduanxin/index.js";
import {
  HeroSmsActivationProvider,
  heroSmsActivationProviderDescriptor,
} from "../activation-providers/hero_sms/index.js";
import { decodeNumberId, inferCountryCode, normalizeText } from "../shared/index.js";
import {
  type SmsProviderRouteContext,
  EasySmsProviderOperationalState,
} from "./provider-operational-state.js";

const DEFAULT_SYNTHETIC_ACTIVATION_SERVICE = "public-web-sms";
const DEFAULT_SYNTHETIC_COUNTRY_ID = 0;
const INITIAL_SYNTHETIC_ACTIVATION_ID = 900000000;
const INITIAL_SESSION_SEQUENCE = 1;
const OTP_CODE_PATTERN = /(?:^|[^\d])(\d{4,8})(?!\d)/;
const FREE_FACADE_COUNTRY_ID_OFFSET = 700000000;
const HEROSMS_DEFAULT_BUSINESS_KEY = "default";

function mapActivationActionToStatus(action: HeroSmsActivationAction): number {
  switch (action) {
    case "request-code":
      return 3;
    case "complete":
      return 6;
    case "cancel":
      return 8;
    default:
      return 3;
  }
}

function mapSyntheticActivationResultText(action: HeroSmsActivationAction): string {
  switch (action) {
    case "request-code":
      return "ACCESS_RETRY_GET";
    case "complete":
      return "ACCESS_ACTIVATION";
    case "cancel":
      return "ACCESS_CANCEL";
    default:
      return "OK";
  }
}

function findLatestOtpMessage(messages: SmsInboxSnapshot["messages"]): SmsInboxSnapshot["messages"][number] | undefined {
  return messages.find((message) => OTP_CODE_PATTERN.test(message.content));
}

function extractOtpCode(message: SmsInboxSnapshot["messages"][number] | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const match = message.content.match(OTP_CODE_PATTERN);
  return match?.[1];
}

function extractOtpCandidates(text: string | undefined): string[] {
  if (!text) {
    return [];
  }

  return Array.from(text.matchAll(/\b\d{4,8}\b/g), (match) => match[0]).filter(Boolean);
}

function normalizePhoneNumberForLookup(phoneNumber: string | undefined): string {
  return String(phoneNumber ?? "").replace(/[^\d+]/g, "");
}

interface SyntheticCountryProjection {
  providerKey: ProviderDescriptor["key"];
  countryId: number;
  apiName: string;
  dialCode?: string;
  publicNumberCount: number;
  providerCounts: Map<string, number>;
}

interface HeroSmsSelectionStats {
  service: string;
  countryId: number;
  operator?: string;
  assignmentCount: number;
  successCount: number;
  failureCount: number;
  refundedCancelCount: number;
  paidCancelCount: number;
  lastSuccessAtIso?: string;
  lastFailureAtIso?: string;
}

interface GetInboxRuntimeOptions {
  ignoreAvailabilityIssue?: boolean;
}

interface HeroSmsPaidLeaseRecord {
  upstreamActivationId: number;
  phoneNumber: string;
  service: string;
  countryId: number;
  countryCode?: string;
  countryName?: string;
  operator?: string;
  activationCost?: number | null;
  selectionMode: HeroSmsSelectionMode;
  businessKey: string;
  maxBindingsPerPhone: number;
  openedAtIso: string;
  leaseExpiresAtIso: string;
  refundableCancelAvailableAtIso: string;
  cancelledAtIso?: string;
  completedAtIso?: string;
  logicalActivationIds: number[];
}

interface SyntheticActivationLeaseRecord {
  providerKey: string;
  numberId: string;
  sourceUrl?: string;
  phoneNumber: string;
  service: string;
  countryId: number;
  countryCode?: string;
  countryName?: string;
  operator?: string;
  selectionMode?: HeroSmsSelectionMode;
  businessKey: string;
  maxBindingsPerPhone: number;
  openedAtIso: string;
  logicalActivationIds: number[];
}

interface HeroSmsActivationRequestPlan {
  service: string;
  countryId: number;
  countryCode?: string;
  countryName?: string;
  operator?: string;
  maxPrice?: number;
  fixedPrice?: boolean;
  ref?: string;
  phoneException?: string;
  selectionMode: HeroSmsSelectionMode;
  allowReuse: boolean;
  businessKey: string;
  maxBindingsPerPhone: number;
}

function buildSyntheticCountryId(countryName: string, countryCode?: string): number {
  const input = `${normalizeText(countryName).toLowerCase()}|${normalizeText(countryCode).toLowerCase()}`;
  let hash = 0;
  for (const char of input) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return FREE_FACADE_COUNTRY_ID_OFFSET + (hash % 100000000);
}

export class EasySmsService {
  readonly config: EasySmsRuntimeConfig;
  readonly providers: Map<string, SmsProvider>;
  readonly operationalState: EasySmsProviderOperationalState;
  readonly heroSmsActivationProvider?: HeroSmsActivationProvider;
  readonly syntheticActivationSessions: Map<number, EasySmsManagedSessionSnapshot>;
  readonly syntheticActivationLeasesByKey: Map<string, SyntheticActivationLeaseRecord>;
  readonly managedSessions: Map<string, EasySmsManagedSessionSnapshot>;
  readonly managedSessionIdByActivationId: Map<number, string>;
  readonly heroSmsPaidLeasesByUpstreamActivationId: Map<number, HeroSmsPaidLeaseRecord>;
  readonly heroSmsSelectionStats: Map<string, HeroSmsSelectionStats>;
  readonly observedMessages: Map<string, SmsSessionMessage[]>;
  readonly projectedMessages: Map<string, SmsSessionMessage[]>;
  readonly issuedNumbers: Map<string, SmsNumberReference>;
  readonly runtimeDiagnostics: EasySmsRuntimeDiagnostics;
  private nextSyntheticActivationId: number;
  private nextSessionSequence: number;

  constructor(config: EasySmsRuntimeConfig, providers: SmsProvider[]) {
    this.config = config;
    this.providers = new Map(providers.map((provider) => [provider.descriptor.key, provider]));
    this.operationalState = new EasySmsProviderOperationalState(this.listScrapeProviderDescriptors());
    this.heroSmsActivationProvider = config.providers.heroSms.enabled
      ? new HeroSmsActivationProvider(config)
      : undefined;
    this.syntheticActivationSessions = new Map();
    this.syntheticActivationLeasesByKey = new Map();
    this.managedSessions = new Map();
    this.managedSessionIdByActivationId = new Map();
    this.heroSmsPaidLeasesByUpstreamActivationId = new Map();
    this.heroSmsSelectionStats = new Map();
    this.observedMessages = new Map();
    this.projectedMessages = new Map();
    this.issuedNumbers = new Map();
    this.runtimeDiagnostics = this.createInitialRuntimeDiagnostics(config);
    this.nextSyntheticActivationId = INITIAL_SYNTHETIC_ACTIVATION_ID;
    this.nextSessionSequence = INITIAL_SESSION_SEQUENCE;
  }

  private createInitialRuntimeDiagnostics(config: EasySmsRuntimeConfig): EasySmsRuntimeDiagnostics {
    return {
      serviceStartedAt: new Date().toISOString(),
      stateStore: {
        enabled: config.persistence.enabled,
        driver: config.persistence.driver,
        filePath: config.persistence.filePath,
      },
      stateLoad: {
        attempted: false,
        status: config.persistence.enabled ? "not_attempted" : "skipped",
        detail: config.persistence.enabled ? undefined : "Persistence is disabled.",
      },
      maintenanceLoop: this.createRuntimeLoopSnapshot(
        config.maintenance.enabled,
        config.maintenance.enabled ? config.maintenance.intervalMs : undefined,
      ),
      activeProbeLoop: this.createRuntimeLoopSnapshot(
        config.maintenance.enabled && config.maintenance.activeProbeEnabled,
        config.maintenance.enabled && config.maintenance.activeProbeEnabled
          ? config.maintenance.activeProbeIntervalMs
          : undefined,
      ),
      persistenceLoop: this.createRuntimeLoopSnapshot(
        config.persistence.enabled,
        config.persistence.enabled ? config.persistence.intervalMs : undefined,
      ),
    };
  }

  private createRuntimeLoopSnapshot(enabled: boolean, intervalMs?: number): EasySmsRuntimeLoopSnapshot {
    return {
      enabled,
      intervalMs,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
    };
  }

  listProviders(filters: { costTier?: CostTier; capability?: string } = {}): ProviderDescriptor[] {
    return this.listProviderCatalog().filter((provider) => {
      if (filters.costTier && provider.costTier !== filters.costTier) {
        return false;
      }
      if (filters.capability && !provider.capabilities.includes(filters.capability)) {
        return false;
      }
      return true;
    });
  }

  getCatalog(): SmsCatalog {
    return {
      providers: this.listProviders(),
      strategyModeId: this.config.strategy.providerStrategyModeId,
      compatibility: {
        facadePath: "/stubs/handler_api.php",
        supportedActions: [
          "getCountries",
          "getPrices",
          "getTopCountriesByService",
          "getTopCountriesByServiceRank",
          "getOperators",
          "getNumberV2",
          "getStatus",
          "getStatusV2",
          "setStatus",
        ],
      },
    };
  }

  getSnapshot(mode: EasySmsSnapshotMode = "summary", now: Date = new Date()): EasySmsSnapshot {
    const snapshot: EasySmsSnapshot = {
      mode,
      catalog: this.getCatalog(),
      runtime: this.getRuntimeDiagnostics(),
      runtimeState: this.getPublicRuntimeStateSnapshot(mode, now),
    };

    if (mode === "detail") {
      snapshot.sessions = this.querySessions({ newestFirst: true });
      snapshot.observedMessages = this.queryStoredObservedMessages({ newestFirst: true });
      snapshot.projectedMessages = this.queryStoredProjectedMessages({ newestFirst: true });
    }

    return snapshot;
  }

  private getPublicRuntimeStateSnapshot(
    mode: EasySmsSnapshotMode = "summary",
    now: Date = new Date(),
  ): EasySmsPublicRuntimeStateSnapshot {
    const runtimeState = this.getRuntimeStateSnapshot(now);
    return {
      providers: runtimeState.providers,
      routes: runtimeState.routes,
      ...(mode === "detail" ? { probeHistory: runtimeState.probeHistory } : {}),
      nextSyntheticActivationId: runtimeState.nextSyntheticActivationId,
      nextSessionSequence: runtimeState.nextSessionSequence,
      updatedAt: runtimeState.updatedAt,
    };
  }

  getRuntimeDiagnostics(): EasySmsRuntimeDiagnostics {
    return structuredClone(this.runtimeDiagnostics);
  }

  async listHeroSmsCountries(): Promise<HeroSmsCountry[]> {
    return this.requireHeroSmsProvider().getCountries();
  }

  async listHeroSmsTopCountries(
    service = this.config.providers.heroSms.defaultService,
    ranked = true,
  ): Promise<HeroSmsCountryPrice[]> {
    return this.requireHeroSmsProvider().getTopCountriesByService(service, ranked);
  }

  async getHeroSmsPrices(service = this.config.providers.heroSms.defaultService): Promise<unknown> {
    return this.requireHeroSmsProvider().getPrices(service);
  }

  async listFacadeCountries(
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsCountry[]> {
    if (this.shouldUsePaidFacade(options)) {
      return this.listHeroSmsCountries();
    }

    return (await this.buildSyntheticCountryProjections(options)).map((item) => ({
      providerKey: item.providerKey,
      countryId: item.countryId,
      apiName: item.apiName,
      dialCode: item.dialCode,
      visible: true,
      retry: true,
    }));
  }

  async getFacadePrices(
    service = this.config.providers.heroSms.defaultService,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<unknown> {
    if (this.shouldUsePaidFacade(options)) {
      return this.getHeroSmsPrices(service);
    }

    const countries = await this.buildSyntheticCountryProjections(options);
    return {
      [service]: Object.fromEntries(
        countries.map((item) => [
          String(item.countryId),
          {
            cost: 0,
            count: item.publicNumberCount,
            country: item.countryId,
            name: item.apiName,
            dialCode: item.dialCode,
            providers: Array.from(item.providerCounts.keys()),
            providerCount: item.providerCounts.size,
          },
        ]),
      ),
    };
  }

  async listFacadeTopCountries(
    service = this.config.providers.heroSms.defaultService,
    ranked = true,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsCountryPrice[]> {
    if (this.shouldUsePaidFacade(options)) {
      return this.listHeroSmsTopCountries(service, ranked);
    }

    const countries = await this.buildSyntheticCountryProjections(options);
    const rows = countries.map((item) => ({
      providerKey: item.providerKey,
      service,
      countryId: item.countryId,
      price: 0,
      count: item.publicNumberCount,
      apiName: item.apiName,
      dialCode: item.dialCode,
    }));

    if (!ranked) {
      return rows.sort((left, right) => left.countryId - right.countryId);
    }

    return rows.sort((left, right) => {
      if ((right.count ?? 0) !== (left.count ?? 0)) {
        return (right.count ?? 0) - (left.count ?? 0);
      }
      return left.apiName.localeCompare(right.apiName);
    });
  }

  async listFacadeOperatorQuotes(
    country: number,
    service = this.config.providers.heroSms.defaultService,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsOperatorQuote[]> {
    if (this.shouldUsePaidFacade(options)) {
      return this.listHeroSmsOperatorQuotes(country, service);
    }

    const countryProjection = await this.resolveSyntheticCountry(country, options);
    return Array.from(countryProjection.providerCounts.entries())
      .map(([providerKey, count]) => ({
        providerKey: countryProjection.providerKey,
        service,
        countryId: countryProjection.countryId,
        operator: providerKey,
        price: 0,
        count,
      }))
      .sort((left, right) => {
        if ((right.count ?? 0) !== (left.count ?? 0)) {
          return (right.count ?? 0) - (left.count ?? 0);
        }
        return left.operator.localeCompare(right.operator);
      });
  }

  async resolveFacadeCountry(
    countryId: number,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<{ countryId: number; countryCode?: string; countryName?: string }> {
    if (this.shouldUsePaidFacade(options)) {
      const countries = await this.listHeroSmsCountries();
      const country = countries.find((item) => item.countryId === countryId);
      if (!country) {
        throw new ProviderRouteUnavailableError(
          "hero_sms",
          `Unknown HeroSMS country id: ${countryId}.`,
        );
      }

      return {
        countryId: country.countryId,
        countryCode: country.dialCode,
        countryName: country.apiName,
      };
    }

    const country = await this.resolveSyntheticCountry(countryId, options);
    return {
      countryId: country.countryId,
      countryCode: country.dialCode,
      countryName: country.apiName,
    };
  }

  async listHeroSmsOperatorQuotes(
    country: number,
    service = this.config.providers.heroSms.defaultService,
  ): Promise<HeroSmsOperatorQuote[]> {
    return this.requireHeroSmsProvider().getOperatorQuoteOptions(service, country);
  }

  async createHeroSmsActivation(input: HeroSmsActivationCreateInput): Promise<HeroSmsActivationSession> {
    return this.createActivation(input, { providerKey: "hero_sms", costTier: "paid" });
  }

  async getHeroSmsActivationStatus(activationId: number): Promise<HeroSmsActivationStatusSnapshot> {
    return this.getActivationStatus(activationId, { providerKey: "hero_sms", costTier: "paid" });
  }

  async setHeroSmsActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    return this.setActivationStatus(activationId, action, { providerKey: "hero_sms", costTier: "paid" });
  }

  listProviderHealth(now: Date = new Date()): SmsProviderHealthSnapshot[] {
    const trackedSnapshots = new Map(
      this.operationalState.listProviderHealth(now).map((snapshot) => [snapshot.providerKey, snapshot] as const),
    );

    return this.listProviders().map((descriptor) =>
      trackedSnapshots.get(descriptor.key)
      ?? this.createSyntheticProviderHealthSnapshot(descriptor)
    );
  }

  listRouteHealth(providerKey?: string, now: Date = new Date()): SmsProviderRouteHealthSnapshot[] {
    return this.operationalState.listRouteHealth(providerKey, now);
  }

  listProbeHistory(filters: SmsProviderProbeHistoryQueryFilters = {}, now: Date = new Date()): SmsProviderProbeHistoryEntry[] {
    return this.operationalState.listProbeHistory(filters, now);
  }

  listProbeTrends(providerKey?: string, now: Date = new Date()): SmsProviderProbeTrendSnapshot[] {
    return this.operationalState.listProbeTrends(providerKey, now);
  }

  getListSelectionPlan(
    options: Pick<ListPublicNumbersOptions, "countryCode" | "countryName" | "providerKey" | "costTier" | "limit"> = {},
    now: Date = new Date(),
  ): SmsProviderSelectionCandidate[] {
    const limit = options.limit;
    if (options.providerKey) {
      const provider = this.providers.get(options.providerKey);
      if (!provider) {
        throw new ProviderNotFoundError(options.providerKey);
      }

      const ranked = this.operationalState.rankSelectionCandidates([
        this.operationalState.getSelectionCandidate(this.buildListRouteContext(provider, options), now),
      ]);
      return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
    }

    const ranked = this.operationalState.rankSelectionCandidates(
      Array.from(this.providers.values(), (provider) =>
        !this.matchesListCostTier(provider.descriptor, options.costTier)
          ? undefined
          : this.operationalState.getSelectionCandidate(this.buildListRouteContext(provider, options), now)
      ).filter((candidate): candidate is SmsProviderSelectionCandidate => candidate !== undefined)
    );
    return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
  }

  getAvailableActivationProviders(filters: { costTier?: CostTier } = {}): ProviderDescriptor[] {
    return this.listProviders({ ...filters, capability: "create-activation" });
  }

  async createActivation(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsActivationSession> {
    if (!options.providerKey && !options.costTier) {
      try {
        const activation = await this.createSyntheticActivation(input);
        return this.registerManagedSessionFromActivation(activation);
      } catch (error) {
        if (!(error instanceof ProviderRouteUnavailableError)) {
          throw error;
        }
      }

      const reusableLease = this.findReusableHeroSmsLeaseForInput(input);
      if (reusableLease) {
        const baselineStatus = await this.requireHeroSmsProvider().getActivationStatus(reusableLease.upstreamActivationId);
        return this.createHeroSmsLogicalAssignment(
          reusableLease,
          this.buildHeroSmsReusePlan(reusableLease, input),
          baselineStatus,
        );
      }

      if (this.heroSmsActivationProvider) {
        return this.createManagedHeroSmsActivation(input);
      }

      throw new ProviderRouteUnavailableError(
        "activation",
        "No activation-capable providers are currently available.",
      );
    }

    let activation: HeroSmsActivationSession;
    if (options.providerKey) {
      if (options.providerKey === "hero_sms") {
        activation = await this.createManagedHeroSmsActivation(input);
      } else {
        activation = await this.createSyntheticActivation(input, options.providerKey);
      }
    } else if (options.costTier === "paid") {
      activation = await this.createManagedHeroSmsActivation(input);
    } else if (options.costTier === "free" || this.hasSyntheticActivationProviders()) {
      activation = await this.createSyntheticActivation(input);
    } else if (this.heroSmsActivationProvider) {
      activation = await this.createManagedHeroSmsActivation(input);
    } else {
      throw new ProviderRouteUnavailableError(
        "activation",
        "No activation-capable providers are currently available.",
      );
    }

    return this.registerManagedSessionFromActivation(activation);
  }

  async getActivationStatus(
    activationId: number,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsActivationStatusSnapshot> {
    let status: HeroSmsActivationStatusSnapshot;
    if (options.providerKey) {
      if (options.providerKey === "hero_sms") {
        status = await this.getManagedHeroSmsActivationStatus(activationId);
      } else {
        status = await this.getSyntheticActivationStatus(activationId, options.providerKey);
      }
    } else if (options.costTier === "paid") {
      status = await this.getManagedHeroSmsActivationStatus(activationId);
    } else {
      const syntheticSession = this.syntheticActivationSessions.get(activationId);
      if (options.costTier === "free" || syntheticSession) {
        status = await this.getSyntheticActivationStatus(activationId);
      } else if (this.heroSmsActivationProvider) {
        status = await this.getManagedHeroSmsActivationStatus(activationId);
      } else {
        throw new ActivationSessionNotFoundError(activationId);
      }
    }

    return this.decorateActivationStatus(status);
  }

  async setActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    let result: HeroSmsActivationStatusUpdateResult;
    if (options.providerKey) {
      if (options.providerKey === "hero_sms") {
        result = await this.setManagedHeroSmsActivationStatus(activationId, action);
      } else {
        result = await this.setSyntheticActivationStatus(activationId, action, options.providerKey);
      }
    } else if (options.costTier === "paid") {
      result = await this.setManagedHeroSmsActivationStatus(activationId, action);
    } else {
      const syntheticSession = this.syntheticActivationSessions.get(activationId);
      if (options.costTier === "free" || syntheticSession) {
        result = await this.setSyntheticActivationStatus(activationId, action);
      } else if (this.heroSmsActivationProvider) {
        result = await this.setManagedHeroSmsActivationStatus(activationId, action);
      } else {
        throw new ActivationSessionNotFoundError(activationId);
      }
    }

    return this.decorateActivationStatusUpdate(result);
  }

  private async createManagedHeroSmsActivation(
    input: HeroSmsActivationCreateInput,
  ): Promise<HeroSmsActivationSession> {
    const plan = await this.resolveHeroSmsActivationRequestPlan(input);
    const reusableLease = plan.allowReuse
      ? await this.tryAcquireReusableHeroSmsLease(plan)
      : undefined;

    if (reusableLease) {
      return this.createHeroSmsLogicalAssignment(reusableLease.lease, plan, reusableLease.baselineStatus);
    }

    const provider = this.requireHeroSmsProvider();
    const upstreamActivation = await provider.createActivation({
      service: plan.service,
      country: plan.countryId,
      operator: plan.operator,
      maxPrice: plan.maxPrice,
      fixedPrice: plan.fixedPrice,
      ref: plan.ref,
      phoneException: plan.phoneException,
    });

    const openedAtIso = upstreamActivation.createdAtIso || new Date().toISOString();
    const openedAtMs = Date.parse(openedAtIso) || Date.now();
    const lease: HeroSmsPaidLeaseRecord = {
      upstreamActivationId: upstreamActivation.activationId,
      phoneNumber: upstreamActivation.phoneNumber,
      service: plan.service,
      countryId: plan.countryId,
      countryCode: plan.countryCode ?? upstreamActivation.countryCode,
      countryName: plan.countryName ?? upstreamActivation.countryName,
      operator: plan.operator ?? upstreamActivation.operator,
      activationCost: upstreamActivation.activationCost,
      selectionMode: plan.selectionMode,
      businessKey: plan.businessKey,
      maxBindingsPerPhone: Math.max(1, plan.maxBindingsPerPhone),
      openedAtIso,
      leaseExpiresAtIso: new Date(openedAtMs + this.config.providers.heroSms.leaseWindowSeconds * 1000).toISOString(),
      refundableCancelAvailableAtIso: new Date(
        openedAtMs + this.config.providers.heroSms.refundableCancelWindowSeconds * 1000,
      ).toISOString(),
      logicalActivationIds: [],
    };
    this.heroSmsPaidLeasesByUpstreamActivationId.set(lease.upstreamActivationId, lease);

    return this.createHeroSmsLogicalAssignment(lease, plan);
  }

  private async getManagedHeroSmsActivationStatus(
    activationId: number,
  ): Promise<HeroSmsActivationStatusSnapshot> {
    const sessionId = this.managedSessionIdByActivationId.get(activationId);
    if (!sessionId) {
      return this.requireHeroSmsProvider().getActivationStatus(activationId);
    }

    const session = this.getManagedSession(sessionId);
    if (session.providerKey !== "hero_sms" || session.sessionMode !== "paid-api") {
      return this.requireHeroSmsProvider().getActivationStatus(activationId);
    }

    const upstreamActivationId = session.upstreamActivationId ?? activationId;
    const lease = this.heroSmsPaidLeasesByUpstreamActivationId.get(upstreamActivationId);
    let status = await this.requireHeroSmsProvider().getActivationStatus(upstreamActivationId);
    status = this.rewriteHeroSmsStatusForLogicalAssignment(status, session, lease);
    this.maybeRecordHeroSmsSessionSuccess(session, status);
    return status;
  }

  private async setManagedHeroSmsActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    const sessionId = this.managedSessionIdByActivationId.get(activationId);
    if (!sessionId) {
      return this.requireHeroSmsProvider().setActivationStatus(activationId, action);
    }

    const session = this.getManagedSession(sessionId);
    if (session.providerKey !== "hero_sms" || session.sessionMode !== "paid-api") {
      return this.requireHeroSmsProvider().setActivationStatus(activationId, action);
    }

    const upstreamActivationId = session.upstreamActivationId ?? activationId;
    const lease = this.heroSmsPaidLeasesByUpstreamActivationId.get(upstreamActivationId);
    const result = await this.requireHeroSmsProvider().setActivationStatus(upstreamActivationId, action);
    const decorated = this.decorateHeroSmsStatusUpdateResultForLogicalAssignment(result, session, lease);
    this.applyHeroSmsLeaseAction(session, lease, action, decorated.updatedAtIso);
    return decorated;
  }

  private async resolveHeroSmsActivationRequestPlan(
    input: HeroSmsActivationCreateInput,
  ): Promise<HeroSmsActivationRequestPlan> {
    const service = input.service?.trim() || this.config.providers.heroSms.defaultService;
    const selectionMode = this.resolveHeroSmsSelectionMode(input.selectionMode);
    const allowReuse = this.config.providers.heroSms.reuseEnabled && input.allowReuse !== false;
    const businessKey = normalizeText(input.businessKey) || HEROSMS_DEFAULT_BUSINESS_KEY;
    const maxBindingsPerPhone = Math.max(
      1,
      Number.isFinite(input.maxBindingsPerPhone)
        ? Number(input.maxBindingsPerPhone)
        : this.config.providers.heroSms.defaultMaxBindingsPerPhone,
    );

    let countryChoice: HeroSmsCountryPrice | undefined;
    if (Number.isFinite(input.country)) {
      countryChoice = await this.resolveExplicitHeroSmsCountry(service, Number(input.country));
    } else if (input.countryCode?.trim() || input.countryName?.trim()) {
      countryChoice = await this.resolveFilteredHeroSmsCountry(service, input.countryCode, input.countryName);
    } else {
      countryChoice = await this.selectHeroSmsCountryByStrategy(service, selectionMode);
    }

    if (!countryChoice) {
      throw new ProviderRouteUnavailableError("hero_sms", "No HeroSMS country matched the requested selection strategy.");
    }

    const operator = input.operator?.trim() || await this.selectHeroSmsOperatorByStrategy(
      service,
      countryChoice,
      selectionMode,
    );

    return {
      service,
      countryId: countryChoice.countryId,
      countryCode: countryChoice.dialCode ?? input.countryCode,
      countryName: countryChoice.apiName || input.countryName,
      operator,
      maxPrice: input.maxPrice,
      fixedPrice: input.fixedPrice,
      ref: input.ref,
      phoneException: input.phoneException,
      selectionMode,
      allowReuse,
      businessKey,
      maxBindingsPerPhone,
    };
  }

  private resolveHeroSmsSelectionMode(value: HeroSmsActivationCreateInput["selectionMode"]): HeroSmsSelectionMode {
    return value ?? this.config.providers.heroSms.selectionMode;
  }

  private findReusableHeroSmsLeaseForInput(
    input: HeroSmsActivationCreateInput,
  ): HeroSmsPaidLeaseRecord | undefined {
    if (!this.config.providers.heroSms.reuseEnabled || input.allowReuse === false) {
      return undefined;
    }

    const service = input.service?.trim() || this.config.providers.heroSms.defaultService;
    const businessKey = normalizeText(input.businessKey) || HEROSMS_DEFAULT_BUSINESS_KEY;
    const maxBindingsPerPhone = Math.max(
      1,
      Number.isFinite(input.maxBindingsPerPhone)
        ? Number(input.maxBindingsPerPhone)
        : this.config.providers.heroSms.defaultMaxBindingsPerPhone,
    );
    const wantedCountryId = Number.isFinite(input.country) ? Number(input.country) : undefined;
    const wantedCountryCode = normalizeText(input.countryCode);
    const wantedCountryName = normalizeText(input.countryName).toLowerCase();
    const wantedOperator = input.operator?.trim();

    return Array.from(this.heroSmsPaidLeasesByUpstreamActivationId.values())
      .filter((lease) => lease.businessKey === businessKey)
      .filter((lease) => lease.service === service)
      .filter((lease) => !lease.cancelledAtIso && !lease.completedAtIso)
      .filter((lease) => Date.parse(lease.leaseExpiresAtIso) > Date.now())
      .filter((lease) => lease.logicalActivationIds.length < Math.max(lease.maxBindingsPerPhone, maxBindingsPerPhone))
      .filter((lease) => !wantedCountryId || lease.countryId === wantedCountryId)
      .filter((lease) => !wantedCountryCode || normalizeText(lease.countryCode) === wantedCountryCode)
      .filter((lease) => !wantedCountryName || normalizeText(lease.countryName).toLowerCase().includes(wantedCountryName))
      .filter((lease) => !wantedOperator || lease.operator === wantedOperator)
      .sort((left, right) => Date.parse(left.openedAtIso) - Date.parse(right.openedAtIso))[0];
  }

  private buildHeroSmsReusePlan(
    lease: HeroSmsPaidLeaseRecord,
    input: HeroSmsActivationCreateInput,
  ): HeroSmsActivationRequestPlan {
    return {
      service: lease.service,
      countryId: lease.countryId,
      countryCode: lease.countryCode,
      countryName: lease.countryName,
      operator: input.operator?.trim() || lease.operator,
      maxPrice: input.maxPrice,
      fixedPrice: input.fixedPrice,
      ref: input.ref,
      phoneException: input.phoneException,
      selectionMode: this.resolveHeroSmsSelectionMode(input.selectionMode ?? lease.selectionMode),
      allowReuse: this.config.providers.heroSms.reuseEnabled && input.allowReuse !== false,
      businessKey: normalizeText(input.businessKey) || lease.businessKey,
      maxBindingsPerPhone: Math.max(
        1,
        Number.isFinite(input.maxBindingsPerPhone)
          ? Number(input.maxBindingsPerPhone)
          : lease.maxBindingsPerPhone,
      ),
    };
  }

  private buildSyntheticLeaseKey(
    providerKey: string,
    numberId: string,
    businessKey: string,
    service: string,
  ): string {
    return [providerKey, numberId, businessKey, service].join("::");
  }

  private async findReusableSyntheticLeaseForInput(
    input: HeroSmsActivationCreateInput,
    providerKey?: string,
  ): Promise<SyntheticActivationLeaseRecord | undefined> {
    const service = input.service?.trim() || DEFAULT_SYNTHETIC_ACTIVATION_SERVICE;
    const businessKey = normalizeText(input.businessKey) || HEROSMS_DEFAULT_BUSINESS_KEY;
    const maxBindingsPerPhone = Math.max(
      1,
      Number.isFinite(input.maxBindingsPerPhone)
        ? Number(input.maxBindingsPerPhone)
        : 1,
    );
    const wantedProviderKey = providerKey?.trim();
    const wantedNumberId = input.numberId?.trim();
    const wantedCountryId = Number.isFinite(input.country) ? Number(input.country) : undefined;
    const wantedCountryCode = normalizeText(input.countryCode);
    const wantedCountryName = normalizeText(input.countryName).toLowerCase();
    const wantedOperator = input.operator?.trim();

    return Array.from(this.syntheticActivationLeasesByKey.values())
      .filter((lease) => lease.businessKey === businessKey)
      .filter((lease) => lease.service === service)
      .filter((lease) => {
        const provider = this.providers.get(lease.providerKey);
        return Boolean(provider && this.supportsSyntheticActivation(provider.descriptor));
      })
      .filter((lease) => !wantedProviderKey || lease.providerKey === wantedProviderKey)
      .filter((lease) => !wantedNumberId || lease.numberId === wantedNumberId)
      .filter((lease) => !wantedCountryId || lease.countryId === wantedCountryId)
      .filter((lease) => !wantedCountryCode || normalizeText(lease.countryCode) === wantedCountryCode)
      .filter((lease) => !wantedCountryName || normalizeText(lease.countryName).toLowerCase().includes(wantedCountryName))
      .filter((lease) => !wantedOperator || lease.operator === wantedOperator)
      .filter((lease) => lease.logicalActivationIds.length < Math.max(1, lease.maxBindingsPerPhone))
      .sort((left, right) => Date.parse(left.openedAtIso) - Date.parse(right.openedAtIso))[0];
  }

  private async readSyntheticLeaseBaseline(
    lease: SyntheticActivationLeaseRecord,
  ): Promise<{ baselineCode?: string; baselineText?: string; baselineReceivedAtIso?: string }> {
    const inbox = await this.getInbox({
      providerKey: lease.providerKey,
      numberId: lease.numberId,
    });
    const latestOtpMessage = findLatestOtpMessage(inbox.messages);
    return {
      baselineCode: extractOtpCode(latestOtpMessage),
      baselineText: latestOtpMessage?.content,
      baselineReceivedAtIso: latestOtpMessage?.receivedAtIso,
    };
  }

  private async createSyntheticLogicalAssignment(
    lease: SyntheticActivationLeaseRecord,
    input: HeroSmsActivationCreateInput,
    baseline?: { baselineCode?: string; baselineText?: string; baselineReceivedAtIso?: string },
  ): Promise<HeroSmsActivationSession> {
    const activationId = this.allocateSyntheticActivationId();
    const assignmentIndex = lease.logicalActivationIds.length + 1;
    lease.maxBindingsPerPhone = Math.max(
      lease.maxBindingsPerPhone,
      Math.max(
        1,
        Number.isFinite(input.maxBindingsPerPhone)
          ? Number(input.maxBindingsPerPhone)
          : lease.maxBindingsPerPhone,
      ),
    );
    lease.logicalActivationIds.push(activationId);
    this.syntheticActivationLeasesByKey.set(
      this.buildSyntheticLeaseKey(lease.providerKey, lease.numberId, lease.businessKey, lease.service),
      lease,
    );

    const openedAtIso = new Date().toISOString();
    const activation: HeroSmsActivationSession = {
      providerKey: lease.providerKey as HeroSmsActivationSession["providerKey"],
      activationId,
      phoneNumber: lease.phoneNumber,
      service: lease.service,
      countryId: lease.countryId,
      countryCode: lease.countryCode,
      countryName: lease.countryName,
      numberId: lease.numberId,
      sourceUrl: lease.sourceUrl,
      operator: lease.operator,
      activationCost: 0,
      costTier: "free",
      sessionMode: "synthetic-public-inbox",
      selectionMode: lease.selectionMode ?? input.selectionMode,
      businessKey: lease.businessKey,
      assignmentIndex,
      maxBindingsPerPhone: lease.maxBindingsPerPhone,
      refundEligible: false,
      createdAtIso: openedAtIso,
    };

    return this.registerManagedSessionFromActivation(activation, baseline);
  }

  private async resolveExplicitHeroSmsCountry(service: string, countryId: number): Promise<HeroSmsCountryPrice | undefined> {
    const provider = this.requireHeroSmsProvider();
    const countries = await provider.getCountries();
    const priced = await provider.listCountryPrices(service, countries);
    return priced.find((item) => item.countryId === countryId)
      ?? countries.find((item) => item.countryId === countryId)
        ? {
            providerKey: "hero_sms",
            service,
            countryId,
            apiName: countries.find((item) => item.countryId === countryId)?.apiName ?? "",
            dialCode: countries.find((item) => item.countryId === countryId)?.dialCode,
            isoCode: countries.find((item) => item.countryId === countryId)?.isoCode,
            price: 0,
            count: 0,
          }
        : undefined;
  }

  private async resolveFilteredHeroSmsCountry(
    service: string,
    countryCode?: string,
    countryName?: string,
  ): Promise<HeroSmsCountryPrice | undefined> {
    const provider = this.requireHeroSmsProvider();
    const countries = await provider.getCountries();
    const priced = await provider.listCountryPrices(service, countries);
    const wantedCode = normalizeText(countryCode);
    const wantedName = normalizeText(countryName).toLowerCase();
    const filtered = priced.filter((item) => {
      const itemCode = normalizeText(item.dialCode);
      const itemName = normalizeText(item.apiName).toLowerCase();
      if (wantedCode && itemCode !== wantedCode) {
        return false;
      }
      if (wantedName && !itemName.includes(wantedName) && !wantedName.includes(itemName)) {
        return false;
      }
      return true;
    });
    return this.rankHeroSmsCountryCandidates(filtered, this.resolveHeroSmsSelectionMode(undefined))[0];
  }

  private async selectHeroSmsCountryByStrategy(
    service: string,
    selectionMode: HeroSmsSelectionMode,
  ): Promise<HeroSmsCountryPrice | undefined> {
    const provider = this.requireHeroSmsProvider();
    const countries = await provider.getCountries();
    const priced = await provider.listCountryPrices(service, countries);
    return this.rankHeroSmsCountryCandidates(priced, selectionMode)[0];
  }

  private rankHeroSmsCountryCandidates(
    candidates: HeroSmsCountryPrice[],
    selectionMode: HeroSmsSelectionMode,
  ): HeroSmsCountryPrice[] {
    if (candidates.length === 0) {
      return [];
    }

    const minPrice = Math.min(...candidates.map((item) => item.price));
    const maxCount = Math.max(...candidates.map((item) => item.count ?? 0), 1);

    const scored = candidates.map((item) => {
      const successScore = this.getHeroSmsSuccessScore(item.service, item.countryId);
      const normalizedPrice = item.price > 0 ? minPrice / item.price : 1;
      const normalizedCount = (item.count ?? 0) / maxCount;
      let score = 0;

      switch (selectionMode) {
        case "price-first":
          score = normalizedPrice * 1000 + normalizedCount * 10 + successScore;
          break;
        case "stock-first":
          score = normalizedCount * 1000 + normalizedPrice * 10 + successScore;
          break;
        case "success-first":
          score = successScore * 1000 + normalizedPrice * 10 + normalizedCount;
          break;
        case "balanced":
        default:
          score = successScore * 0.55 + normalizedPrice * 0.3 + normalizedCount * 0.15;
          break;
      }

      return { item, score, successScore };
    });

    return scored
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if ((right.item.count ?? 0) !== (left.item.count ?? 0) && selectionMode !== "price-first") {
          return (right.item.count ?? 0) - (left.item.count ?? 0);
        }
        return left.item.price - right.item.price;
      })
      .map((entry) => entry.item);
  }

  private async selectHeroSmsOperatorByStrategy(
    service: string,
    country: HeroSmsCountryPrice,
    selectionMode: HeroSmsSelectionMode,
  ): Promise<string | undefined> {
    const quotes = await this.requireHeroSmsProvider().getOperatorQuoteOptions(service, country.countryId);
    if (quotes.length === 0) {
      return undefined;
    }

    const aggregate: HeroSmsOperatorQuote = {
      providerKey: "hero_sms",
      service,
      countryId: country.countryId,
      operator: "",
      price: country.price,
      count: country.count,
    };
    const candidates = [aggregate, ...quotes].filter((item) => item.error !== undefined ? false : true);
    const minPrice = Math.min(...candidates.map((item) => item.price ?? Number.MAX_SAFE_INTEGER));
    const maxCount = Math.max(...candidates.map((item) => item.count ?? 0), 1);
    const ranked = candidates
      .map((item) => {
        const successScore = this.getHeroSmsSuccessScore(service, country.countryId, item.operator || undefined);
        const normalizedPrice = item.price && item.price > 0 ? minPrice / item.price : 1;
        const normalizedCount = (item.count ?? 0) / maxCount;
        let score = 0;
        switch (selectionMode) {
          case "price-first":
            score = normalizedPrice * 1000 + normalizedCount * 10 + successScore;
            break;
          case "stock-first":
            score = normalizedCount * 1000 + normalizedPrice * 10 + successScore;
            break;
          case "success-first":
            score = successScore * 1000 + normalizedPrice * 10 + normalizedCount;
            break;
          case "balanced":
          default:
            score = successScore * 0.55 + normalizedPrice * 0.3 + normalizedCount * 0.15;
            break;
        }
        return { item, score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return (left.item.price ?? Number.MAX_SAFE_INTEGER) - (right.item.price ?? Number.MAX_SAFE_INTEGER);
      });

    const best = ranked[0]?.item;
    return best?.operator || undefined;
  }

  private async tryAcquireReusableHeroSmsLease(
    plan: HeroSmsActivationRequestPlan,
  ): Promise<{ lease: HeroSmsPaidLeaseRecord; baselineStatus?: HeroSmsActivationStatusSnapshot } | undefined> {
    const eligible = Array.from(this.heroSmsPaidLeasesByUpstreamActivationId.values())
      .filter((lease) => lease.businessKey === plan.businessKey)
      .filter((lease) => lease.service === plan.service)
      .filter((lease) => !lease.cancelledAtIso && !lease.completedAtIso)
      .filter((lease) => Date.parse(lease.leaseExpiresAtIso) > Date.now())
      .filter((lease) => lease.logicalActivationIds.length < Math.max(1, plan.maxBindingsPerPhone))
      .filter((lease) => !plan.countryId || lease.countryId === plan.countryId)
      .filter((lease) => !plan.operator || lease.operator === plan.operator)
      .sort((left, right) => Date.parse(left.openedAtIso) - Date.parse(right.openedAtIso));

    const lease = eligible[0];
    if (!lease) {
      return undefined;
    }

    const baselineStatus = await this.requireHeroSmsProvider().getActivationStatus(lease.upstreamActivationId);
    return { lease, baselineStatus };
  }

  private createHeroSmsLogicalAssignment(
    lease: HeroSmsPaidLeaseRecord,
    plan: HeroSmsActivationRequestPlan,
    baselineStatus?: HeroSmsActivationStatusSnapshot,
  ): HeroSmsActivationSession {
    const logicalActivationId = this.allocateSyntheticActivationId();
    const assignmentIndex = lease.logicalActivationIds.length + 1;
    lease.maxBindingsPerPhone = Math.max(lease.maxBindingsPerPhone, plan.maxBindingsPerPhone);
    lease.logicalActivationIds.push(logicalActivationId);
    this.heroSmsPaidLeasesByUpstreamActivationId.set(lease.upstreamActivationId, lease);

    const activation: HeroSmsActivationSession = {
      providerKey: "hero_sms",
      activationId: logicalActivationId,
      upstreamActivationId: lease.upstreamActivationId,
      phoneNumber: lease.phoneNumber,
      service: lease.service,
      countryId: lease.countryId,
      countryCode: lease.countryCode,
      countryName: lease.countryName,
      operator: lease.operator,
      activationCost: lease.activationCost,
      costTier: "paid",
      sessionMode: "paid-api",
      selectionMode: lease.selectionMode,
      businessKey: lease.businessKey,
      assignmentIndex,
      maxBindingsPerPhone: lease.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: lease.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: lease.leaseExpiresAtIso,
      refundEligible: this.isHeroSmsRefundEligible(lease, undefined, false),
      createdAtIso: new Date().toISOString(),
    };

    const registered = this.registerManagedSessionFromActivation(activation, {
      baselineCode: baselineStatus?.code,
      baselineText: baselineStatus?.text,
      baselineReceivedAtIso: baselineStatus?.receivedAtIso,
    });
    return registered;
  }

  private getHeroSmsSuccessScore(service: string, countryId: number, operator?: string): number {
    const stats = this.heroSmsSelectionStats.get(this.buildHeroSmsSelectionStatsKey(service, countryId, operator));
    if (!stats) {
      return 0.5;
    }
    return (stats.successCount + 1) / (stats.successCount + stats.failureCount + 2);
  }

  private buildHeroSmsSelectionStatsKey(service: string, countryId: number, operator?: string): string {
    return `${service}::${countryId}::${operator || "*"}`;
  }

  private rewriteHeroSmsStatusForLogicalAssignment(
    status: HeroSmsActivationStatusSnapshot,
    session: EasySmsManagedSessionSnapshot,
    lease?: HeroSmsPaidLeaseRecord,
  ): HeroSmsActivationStatusSnapshot {
    const baselineFingerprint = [
      session.baselineReceivedAtIso ?? "",
      session.baselineCode ?? "",
      session.baselineText ?? "",
    ].join("|");
    const statusFingerprint = [
      status.receivedAtIso ?? "",
      status.code ?? "",
      status.text ?? "",
    ].join("|");

    let received = status.received;
    let code = status.code;
    let text = status.text;
    let receivedAtIso = status.receivedAtIso;
    if (received && baselineFingerprint === statusFingerprint) {
      received = false;
      code = undefined;
      text = undefined;
      receivedAtIso = undefined;
    }

    const refundEligible = this.isHeroSmsRefundEligible(lease, session, received);
    return {
      ...status,
      activationId: session.activationId,
      upstreamActivationId: session.upstreamActivationId,
      sessionId: session.id,
      costTier: "paid",
      sessionMode: "paid-api",
      selectionMode: session.selectionMode,
      businessKey: session.businessKey,
      assignmentIndex: session.assignmentIndex,
      maxBindingsPerPhone: session.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: session.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: session.leaseExpiresAtIso,
      refundEligible,
      received,
      code,
      text,
      receivedAtIso,
      cancelled: Boolean(session.cancelledAtIso || lease?.cancelledAtIso || status.cancelled),
    };
  }

  private decorateHeroSmsStatusUpdateResultForLogicalAssignment(
    result: HeroSmsActivationStatusUpdateResult,
    session: EasySmsManagedSessionSnapshot,
    lease?: HeroSmsPaidLeaseRecord,
  ): HeroSmsActivationStatusUpdateResult {
    return {
      ...result,
      activationId: session.activationId,
      upstreamActivationId: session.upstreamActivationId,
      sessionId: session.id,
      costTier: "paid",
      sessionMode: "paid-api",
      selectionMode: session.selectionMode,
      businessKey: session.businessKey,
      assignmentIndex: session.assignmentIndex,
      maxBindingsPerPhone: session.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: session.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: session.leaseExpiresAtIso,
      refundEligible: this.isHeroSmsRefundEligible(lease, session, false),
    };
  }

  private applyHeroSmsLeaseAction(
    session: EasySmsManagedSessionSnapshot,
    lease: HeroSmsPaidLeaseRecord | undefined,
    action: HeroSmsActivationAction,
    updatedAtIso: string,
  ): void {
    if (!lease) {
      return;
    }

    if (action === "cancel") {
      lease.cancelledAtIso = updatedAtIso;
      for (const activationId of lease.logicalActivationIds) {
        const managedSessionId = this.managedSessionIdByActivationId.get(activationId);
        if (!managedSessionId) continue;
        const managedSession = this.managedSessions.get(managedSessionId);
        if (!managedSession) continue;
        managedSession.cancelledAtIso = updatedAtIso;
        this.managedSessions.set(managedSessionId, managedSession);
        this.maybeRecordHeroSmsSessionFailure(
          managedSession,
          "cancelled_without_code",
          this.isHeroSmsRefundEligible(lease, managedSession, false),
          updatedAtIso,
        );
      }
    } else if (action === "complete") {
      lease.completedAtIso = updatedAtIso;
      for (const activationId of lease.logicalActivationIds) {
        const managedSessionId = this.managedSessionIdByActivationId.get(activationId);
        if (!managedSessionId) continue;
        const managedSession = this.managedSessions.get(managedSessionId);
        if (!managedSession) continue;
        managedSession.completedAtIso = updatedAtIso;
        this.managedSessions.set(managedSessionId, managedSession);
      }
    }
    this.heroSmsPaidLeasesByUpstreamActivationId.set(lease.upstreamActivationId, lease);
  }

  private isHeroSmsRefundEligible(
    lease: HeroSmsPaidLeaseRecord | undefined,
    session: EasySmsManagedSessionSnapshot | undefined,
    received: boolean,
  ): boolean {
    if (!lease || received) {
      return false;
    }
    if (session?.lastCode || session?.lastCodeAtIso) {
      return false;
    }
    return Date.now() >= Date.parse(lease.refundableCancelAvailableAtIso);
  }

  private maybeRecordHeroSmsSessionSuccess(
    session: EasySmsManagedSessionSnapshot,
    status: HeroSmsActivationStatusSnapshot,
  ): void {
    if (session.providerKey !== "hero_sms" || !status.received || session.lastReportedOutcome?.success) {
      return;
    }

    const recordedAtIso = status.receivedAtIso ?? status.fetchedAtIso;
    session.lastReportedOutcome = {
      sessionId: session.id,
      success: true,
      source: "hero_sms_status",
      detail: status.text,
      recordedAtIso,
      providerKey: session.providerKey,
    };
    this.managedSessions.set(session.id, session);
    this.recordHeroSmsSelectionOutcome(session, true, false, recordedAtIso);
  }

  private maybeRecordHeroSmsSessionFailure(
    session: EasySmsManagedSessionSnapshot,
    failureReason: string,
    refunded: boolean,
    recordedAtIso: string,
  ): void {
    if (session.providerKey !== "hero_sms" || session.lastReportedOutcome) {
      return;
    }

    session.lastReportedOutcome = {
      sessionId: session.id,
      success: false,
      failureReason,
      source: "hero_sms_cancel",
      recordedAtIso,
      providerKey: session.providerKey,
      detail: refunded ? "refund_eligible" : "not_refund_eligible",
    };
    this.managedSessions.set(session.id, session);
    this.recordHeroSmsSelectionOutcome(session, false, refunded, recordedAtIso);
  }

  private recordHeroSmsSelectionOutcome(
    session: EasySmsManagedSessionSnapshot,
    success: boolean,
    refunded: boolean,
    recordedAtIso: string,
  ): void {
    if (session.providerKey !== "hero_sms") {
      return;
    }

    const key = this.buildHeroSmsSelectionStatsKey(
      session.service,
      session.countryId,
      session.operator,
    );
    const existing = this.heroSmsSelectionStats.get(key) ?? {
      service: session.service,
      countryId: session.countryId,
      operator: session.operator,
      assignmentCount: 0,
      successCount: 0,
      failureCount: 0,
      refundedCancelCount: 0,
      paidCancelCount: 0,
    };
    existing.assignmentCount += 1;
    if (success) {
      existing.successCount += 1;
      existing.lastSuccessAtIso = recordedAtIso;
    } else {
      existing.failureCount += 1;
      existing.lastFailureAtIso = recordedAtIso;
      if (refunded) {
        existing.refundedCancelCount += 1;
      } else {
        existing.paidCancelCount += 1;
      }
    }
    this.heroSmsSelectionStats.set(key, existing);
  }

  async planSession(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<SmsSessionPlanResult> {
    const notes: string[] = [];

    if (options.providerKey === "hero_sms" || options.costTier === "paid") {
      const provider = this.listProviders({ costTier: "paid", capability: "create-activation" }).find((item) => item.key === "hero_sms");
      return {
        planned: Boolean(provider),
        routeKind: "open-sms-session",
        providerKey: provider?.key,
        providerDisplayName: provider?.displayName,
        costTier: "paid",
        sessionMode: "paid-api",
        countryId: input.country,
        countryCode: input.countryCode,
        countryName: input.countryName,
        numberId: input.numberId,
        compatibilityAction: "getNumberV2",
        notes: provider
          ? ["Planned against the paid activation provider layer."]
          : ["No paid activation provider is currently enabled."],
      };
    }

    if (input.numberId) {
      const reference = this.requireIssuedNumberReference(input.numberId);
      const provider = this.providers.get(reference.providerKey);
      return {
        planned: Boolean(provider),
        routeKind: "open-sms-session",
        providerKey: reference.providerKey,
        providerDisplayName: provider?.descriptor.displayName,
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
        countryId: input.country,
        countryCode: input.countryCode ?? reference.countryCode,
        countryName: input.countryName ?? reference.countryName,
        numberId: input.numberId,
        phoneNumber: reference.phoneNumber,
        compatibilityAction: "getNumberV2",
        notes: ["The request pins a specific public number via numberId."],
      };
    }

    if (!options.providerKey && !options.costTier) {
      const reusableFreeLease = await this.findReusableSyntheticLeaseForInput(input);
      if (reusableFreeLease) {
        return {
          planned: true,
          routeKind: "open-sms-session",
          providerKey: reusableFreeLease.providerKey as SmsProviderKey,
          providerDisplayName: this.providers.get(reusableFreeLease.providerKey)?.descriptor.displayName,
          costTier: "free",
          sessionMode: "synthetic-public-inbox",
          countryId: reusableFreeLease.countryId,
          countryCode: reusableFreeLease.countryCode,
          countryName: reusableFreeLease.countryName,
          phoneNumber: reusableFreeLease.phoneNumber,
          compatibilityAction: "getNumberV2",
          notes: [
            `Reuse active free lease for businessKey=${reusableFreeLease.businessKey}.`,
            `Current assignments: ${reusableFreeLease.logicalActivationIds.length}/${reusableFreeLease.maxBindingsPerPhone}.`,
          ],
        };
      }
    }

    const freeCandidates = this.getListSelectionPlan({
      providerKey: options.providerKey,
      countryCode: input.countryCode,
      countryName: input.countryName,
      costTier: "free",
    }).filter((candidate) => {
      const provider = this.providers.get(candidate.providerKey);
      return provider ? this.supportsSyntheticActivation(provider.descriptor) : false;
    });

    if (freeCandidates.length > 0) {
      const selected = freeCandidates[0];
      return {
        planned: true,
        routeKind: "open-sms-session",
        providerKey: selected.providerKey as ProviderDescriptor["key"],
        providerDisplayName: selected.providerDisplayName,
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
        countryId: input.country,
        countryCode: input.countryCode,
        countryName: input.countryName,
        compatibilityAction: "getNumberV2",
        notes: [
          "Free synthetic session selected from the provider health ordering.",
          ...selected.notes,
        ],
      };
    }

    if (!options.providerKey && !options.costTier) {
      const reusableLease = this.findReusableHeroSmsLeaseForInput(input);
      if (reusableLease) {
        return {
          planned: true,
          routeKind: "open-sms-session",
          providerKey: "hero_sms",
          providerDisplayName: heroSmsActivationProviderDescriptor.displayName,
          costTier: "paid",
          sessionMode: "paid-api",
          countryId: reusableLease.countryId,
          countryCode: reusableLease.countryCode,
          countryName: reusableLease.countryName,
          phoneNumber: reusableLease.phoneNumber,
          compatibilityAction: "getNumberV2",
          notes: [
            `Reuse active paid HeroSMS lease for businessKey=${reusableLease.businessKey}.`,
            `Current assignments: ${reusableLease.logicalActivationIds.length}/${reusableLease.maxBindingsPerPhone}.`,
          ],
        };
      }
    }

    const paidProvider = this.listProviders({ costTier: "paid", capability: "create-activation" }).find((item) => item.key === "hero_sms");
    if (paidProvider) {
      notes.push("No free synthetic provider was available; the next fallback is the paid activation provider.");
      return {
        planned: true,
        routeKind: "open-sms-session",
        providerKey: paidProvider.key,
        providerDisplayName: paidProvider.displayName,
        costTier: "paid",
        sessionMode: "paid-api",
        countryId: input.country,
        countryCode: input.countryCode,
        countryName: input.countryName,
        compatibilityAction: "getNumberV2",
        notes,
      };
    }

    return {
      planned: false,
      routeKind: "open-sms-session",
      notes: ["No eligible SMS session route is currently available."],
    };
  }

  async openSession(
    input: HeroSmsActivationCreateInput,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<EasySmsManagedSessionSnapshot> {
    const activation = await this.createActivation(input, options);
    const sessionId = activation.sessionId;
    if (!sessionId) {
      throw new ActivationSessionNotFoundError(activation.activationId);
    }
    return this.getManagedSession(sessionId);
  }

  async readSessionCode(sessionId: string): Promise<SmsSessionCodeResult> {
    const session = this.getManagedSession(sessionId);
    const messages = await this.listSessionMessages(sessionId);
    const matched = messages.find((message) => message.code);

    return {
      sessionId,
      providerKey: session.providerKey,
      code: matched?.code,
      source: matched?.sourceType ?? "none",
      observedMessageId: matched?.id,
      receivedAtIso: matched?.receivedAtIso,
      text: matched?.content,
      candidates: messages.flatMap((message) => extractOtpCandidates(message.content)),
    };
  }

  async readSessionStatus(sessionId: string): Promise<HeroSmsActivationStatusSnapshot> {
    const session = this.getManagedSession(sessionId);
    return this.getActivationStatus(session.activationId, {
      providerKey: session.providerKey,
      costTier: session.costTier,
    });
  }

  async listSessionMessages(sessionId: string): Promise<SmsSessionMessage[]> {
    const session = this.getManagedSession(sessionId);
    const providerMessages = await this.collectProviderMessagesForSession(session);
    this.storeProjectedMessages(sessionId, providerMessages);
    const manualMessages = this.observedMessages.get(sessionId) ?? [];
    return this.sortSessionMessages(this.dedupeMessages([...providerMessages, ...manualMessages]), true);
  }

  async updateSessionAction(
    sessionId: string,
    action: HeroSmsActivationAction,
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    const session = this.getManagedSession(sessionId);
    return this.setActivationStatus(session.activationId, action, {
      providerKey: session.providerKey,
      costTier: session.costTier,
    });
  }

  observeSessionMessage(input: ObserveSmsMessageInput): SmsSessionMessage {
    const session = this.getManagedSession(input.sessionId);
    const observedAtIso = input.receivedAtIso?.trim() || new Date().toISOString();
    const message: SmsSessionMessage = {
      id: `${session.id}:manual:${(this.observedMessages.get(session.id)?.length ?? 0) + 1}`,
      sessionId: session.id,
      providerKey: session.providerKey,
      sourceType: "manual-observe",
      sender: input.sender,
      receivedAtText: input.receivedAtText,
      receivedAtIso: input.receivedAtIso,
      content: input.content,
      code: input.code?.trim() || extractOtpCode({
        id: "manual",
        content: input.content,
        sourceUrl: input.sourceUrl ?? session.sourceUrl ?? "",
      }),
      sourceUrl: input.sourceUrl ?? session.sourceUrl,
      observedAtIso,
    };
    const existing = this.observedMessages.get(session.id) ?? [];
    this.observedMessages.set(session.id, [message, ...existing]);
    this.refreshSessionCodeSummaryFromCachedMessages(session.id);
    return message;
  }

  reportSessionOutcome(report: SmsSessionOutcomeReport): SmsSessionOutcomeReportResult {
    const session = this.getManagedSession(report.sessionId);
    const recordedAtIso = report.observedAt?.trim() || new Date().toISOString();
    const hadOutcome = Boolean(session.lastReportedOutcome);
    session.lastReportedOutcome = {
      ...report,
      providerKey: session.providerKey,
      recordedAtIso,
    };
    this.managedSessions.set(session.id, session);
    this.applySessionOutcomeToOperationalState(session, report, new Date(recordedAtIso));
    if (session.providerKey === "hero_sms" && !hadOutcome) {
      this.recordHeroSmsSelectionOutcome(session, report.success, false, recordedAtIso);
    }
    return {
      accepted: true,
      sessionId: session.id,
      providerKey: session.providerKey,
      recordedAtIso,
      detail: report.success ? "success" : report.failureReason ?? "reported_failure",
    };
  }

  recoverSessionByPhone(request: RecoverSmsSessionByPhoneRequest): RecoverSmsSessionByPhoneResult {
    const normalizedPhone = normalizePhoneNumberForLookup(request.phoneNumber);
    const matched = this.querySessions({ newestFirst: true }).find((session) => {
      if (request.providerKey && session.providerKey !== request.providerKey) {
        return false;
      }
      return normalizePhoneNumberForLookup(session.phoneNumber) === normalizedPhone;
    });

    if (!matched) {
      return {
        recovered: false,
        strategy: "not_supported",
        detail: "No matching SMS session was found in the local runtime state.",
      };
    }

    return {
      recovered: true,
      strategy: "session_restore",
      session: matched,
    };
  }

  getSessionById(sessionId: string): EasySmsManagedSessionSnapshot | undefined {
    return this.managedSessions.get(sessionId);
  }

  querySessions(filters: SmsSessionQueryFilters = {}): EasySmsManagedSessionSnapshot[] {
    let items = Array.from(this.managedSessions.values());
    if (filters.providerKey) {
      items = items.filter((item) => item.providerKey === filters.providerKey);
    }
    if (filters.costTier) {
      items = items.filter((item) => item.costTier === filters.costTier);
    }
    if (filters.sessionMode) {
      items = items.filter((item) => item.sessionMode === filters.sessionMode);
    }
    if (filters.phoneNumber) {
      const normalizedPhone = normalizePhoneNumberForLookup(filters.phoneNumber);
      items = items.filter((item) => normalizePhoneNumberForLookup(item.phoneNumber) === normalizedPhone);
    }
    if (filters.service) {
      items = items.filter((item) => item.service === filters.service);
    }
    if (filters.countryCode) {
      items = items.filter((item) => item.countryCode === filters.countryCode);
    }
    if (filters.countryName) {
      items = items.filter((item) => item.countryName === filters.countryName);
    }
    if (filters.hasCode !== undefined) {
      items = items.filter((item) => {
        const hasCode = this.sessionHasCachedCode(item.id, item.lastCode);
        return filters.hasCode ? hasCode : !hasCode;
      });
    }
    if (filters.hasOutcome !== undefined) {
      items = items.filter((item) => filters.hasOutcome ? Boolean(item.lastReportedOutcome) : !item.lastReportedOutcome);
    }
    if (filters.since) {
      items = items.filter((item) => Date.parse(item.openedAtIso) >= filters.since!.getTime());
    }
    if (filters.until) {
      items = items.filter((item) => Date.parse(item.openedAtIso) <= filters.until!.getTime());
    }

    const newestFirst = filters.newestFirst !== false;
    items.sort((left, right) => {
      const leftTime = Date.parse(left.openedAtIso);
      const rightTime = Date.parse(right.openedAtIso);
      const timeDelta = newestFirst ? rightTime - leftTime : leftTime - rightTime;
      if (timeDelta !== 0) {
        return timeDelta;
      }

      const leftSequence = extractManagedSessionSequence(left.id);
      const rightSequence = extractManagedSessionSequence(right.id);
      if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
        return newestFirst ? rightSequence - leftSequence : leftSequence - rightSequence;
      }

      return newestFirst
        ? right.id.localeCompare(left.id)
        : left.id.localeCompare(right.id);
    });

    if (filters.limit !== undefined) {
      items = items.slice(0, filters.limit);
    }
    return items;
  }

  async getObservedMessageById(
    messageId: string,
    options: Pick<SmsSessionMessageQueryFilters, "refreshProjected"> = {},
  ): Promise<SmsSessionMessage | undefined> {
    const manual = Array.from(this.observedMessages.values()).flat().find((item) => item.id === messageId);
    if (manual) {
      return manual;
    }

    const cached = Array.from(this.projectedMessages.values()).flat().find((item) => item.id === messageId);
    if (cached) {
      return cached;
    }

    if (options.refreshProjected) {
      for (const session of this.querySessions({ newestFirst: true })) {
        const projected = await this.collectProviderMessagesForSession(session);
        this.storeProjectedMessages(session.id, projected);
        const matched = projected.find((item) => item.id === messageId);
        if (matched) {
          return matched;
        }
      }
    }

    return undefined;
  }

  private queryStoredProjectedMessages(filters: SmsSessionMessageQueryFilters = {}): SmsSessionMessage[] {
    let items = Array.from(this.projectedMessages.values()).flat();
    if (filters.sessionId) {
      items = items.filter((item) => item.sessionId === filters.sessionId);
    }
    if (filters.providerKey) {
      items = items.filter((item) => item.providerKey === filters.providerKey);
    }
    if (filters.sourceType) {
      items = items.filter((item) => item.sourceType === filters.sourceType);
    }
    if (filters.extractedCodeOnly) {
      items = items.filter((item) => Boolean(item.code));
    }
    if (filters.since) {
      items = items.filter((item) => Date.parse(item.receivedAtIso ?? item.observedAtIso) >= filters.since!.getTime());
    }
    if (filters.until) {
      items = items.filter((item) => Date.parse(item.receivedAtIso ?? item.observedAtIso) <= filters.until!.getTime());
    }

    return this.limitSessionMessages(items, filters.newestFirst !== false, filters.limit);
  }

  private queryStoredObservedMessages(filters: SmsSessionMessageQueryFilters = {}): SmsSessionMessage[] {
    let items = Array.from(this.observedMessages.values()).flat();
    if (filters.sessionId) {
      items = items.filter((item) => item.sessionId === filters.sessionId);
    }
    if (filters.providerKey) {
      items = items.filter((item) => item.providerKey === filters.providerKey);
    }
    if (filters.sourceType) {
      items = items.filter((item) => item.sourceType === filters.sourceType);
    }
    if (filters.extractedCodeOnly) {
      items = items.filter((item) => Boolean(item.code));
    }
    if (filters.since) {
      items = items.filter((item) => Date.parse(item.receivedAtIso ?? item.observedAtIso) >= filters.since!.getTime());
    }
    if (filters.until) {
      items = items.filter((item) => Date.parse(item.receivedAtIso ?? item.observedAtIso) <= filters.until!.getTime());
    }

    const newestFirst = filters.newestFirst !== false;
    items.sort((left, right) => {
      const leftTime = Date.parse(left.receivedAtIso ?? left.observedAtIso);
      const rightTime = Date.parse(right.receivedAtIso ?? right.observedAtIso);
      return newestFirst ? rightTime - leftTime : leftTime - rightTime;
    });

    if (filters.limit !== undefined) {
      items = items.slice(0, filters.limit);
    }
    return items;
  }

  async queryObservedMessages(filters: SmsSessionMessageQueryFilters = {}): Promise<SmsSessionMessage[]> {
    const includeProjected = filters.includeProjected !== false;
    const includeManual = filters.includeManual !== false;
    const items: SmsSessionMessage[] = [];

    if (includeManual) {
      items.push(...this.queryStoredObservedMessages({
        ...filters,
        includeProjected: undefined,
        includeManual: undefined,
        limit: undefined,
      }));
    }

    if (includeProjected) {
      if (filters.refreshProjected) {
        const sessions = this.querySessions({
          providerKey: filters.providerKey,
          newestFirst: filters.newestFirst,
        }).filter((session) => !filters.sessionId || session.id === filters.sessionId);

        for (const session of sessions) {
          const projected = await this.collectProviderMessagesForSession(session);
          this.storeProjectedMessages(session.id, projected);
        }
      }

      items.push(...this.queryStoredProjectedMessages({
        ...filters,
        includeProjected: undefined,
        includeManual: undefined,
        refreshProjected: undefined,
        limit: undefined,
      }));
    }

    let deduped = this.dedupeMessages(items);

    if (filters.extractedCodeOnly) {
      deduped = deduped.filter((item) => Boolean(item.code));
    }

    return this.limitSessionMessages(deduped, filters.newestFirst !== false, filters.limit);
  }

  private storeProjectedMessages(sessionId: string, messages: SmsSessionMessage[]): void {
    this.projectedMessages.set(
      sessionId,
      this.sortSessionMessages(this.dedupeMessages(messages), true),
    );
    this.refreshSessionCodeSummaryFromCachedMessages(sessionId);
  }

  private rememberIssuedPublicNumbers(numbers: SmsPublicNumber[]): void {
    for (const number of numbers) {
      this.issuedNumbers.set(number.numberId, {
        providerKey: number.providerKey,
        sourceUrl: number.sourceUrl,
        phoneNumber: number.phoneNumber,
        countryName: number.countryName,
        countryCode: number.countryCode,
        label: number.label,
      });
    }
  }

  private requireIssuedNumberReference(numberId: string): SmsNumberReference {
    const reference = this.issuedNumbers.get(numberId);
    if (!reference) {
      throw new ValidationError("numberId was not issued by this EasySms runtime.");
    }
    return reference;
  }

  private sessionHasCachedCode(sessionId: string, lastCode?: string): boolean {
    if (lastCode) {
      return true;
    }

    const manualMessages = this.observedMessages.get(sessionId) ?? [];
    const projectedMessages = this.projectedMessages.get(sessionId) ?? [];
    return [...manualMessages, ...projectedMessages].some((message) => Boolean(message.code));
  }

  private refreshSessionCodeSummaryFromCachedMessages(sessionId: string): void {
    const session = this.managedSessions.get(sessionId);
    if (!session) {
      return;
    }

    const messages = this.sortSessionMessages(
      this.dedupeMessages([
        ...(this.projectedMessages.get(sessionId) ?? []),
        ...(this.observedMessages.get(sessionId) ?? []),
      ]),
      true,
    );
    const matched = messages.find((message) => message.code);
    if (!matched?.code) {
      return;
    }

    session.lastCode = matched.code;
    session.lastCodeAtIso = matched.receivedAtIso ?? matched.observedAtIso;
    session.lastText = matched.content;
    this.managedSessions.set(session.id, session);
  }

  private dedupeMessages(messages: SmsSessionMessage[]): SmsSessionMessage[] {
    return messages.filter((item, index, array) =>
      array.findIndex((candidate) => candidate.id === item.id) === index
    );
  }

  private sortSessionMessages(messages: SmsSessionMessage[], newestFirst: boolean): SmsSessionMessage[] {
    return [...messages].sort((left, right) => {
      const leftTime = Date.parse(left.receivedAtIso ?? left.observedAtIso);
      const rightTime = Date.parse(right.receivedAtIso ?? right.observedAtIso);
      return newestFirst ? rightTime - leftTime : leftTime - rightTime;
    });
  }

  private limitSessionMessages(messages: SmsSessionMessage[], newestFirst: boolean, limit?: number): SmsSessionMessage[] {
    const sorted = this.sortSessionMessages(messages, newestFirst);
    if (limit !== undefined) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }

  getPersistenceStats(): SmsPersistenceStats {
    const sessions = this.querySessions();
    const manualObservedMessageCount = Array.from(this.observedMessages.values()).reduce((sum, rows) => sum + rows.length, 0);
    const cachedProjectedMessageCount = Array.from(this.projectedMessages.values()).reduce((sum, rows) => sum + rows.length, 0);
    return {
      sessionCount: sessions.length,
      observedMessageCount: manualObservedMessageCount + cachedProjectedMessageCount,
      providerCount: this.listProviders().length,
      syntheticSessionCount: sessions.filter((item) => item.sessionMode === "synthetic-public-inbox").length,
      paidSessionCount: sessions.filter((item) => item.sessionMode === "paid-api").length,
      storedObservedMessageCount: manualObservedMessageCount,
      cachedProjectedMessageCount,
      heroSmsPaidLeaseCount: this.heroSmsPaidLeasesByUpstreamActivationId.size,
      heroSmsActiveReusableLeaseCount: Array.from(this.heroSmsPaidLeasesByUpstreamActivationId.values()).filter((lease) =>
        !lease.cancelledAtIso
        && !lease.completedAtIso
        && Date.parse(lease.leaseExpiresAtIso) > Date.now()
        && lease.logicalActivationIds.length < Math.max(1, lease.maxBindingsPerPhone)
      ).length,
      heroSmsSelectionStats: this.listHeroSmsSelectionStats(),
    };
  }

  listHeroSmsSelectionStats(): HeroSmsSelectionStatsSnapshot[] {
    return Array.from(this.heroSmsSelectionStats.values())
      .map((item) => ({
        providerKey: "hero_sms" as const,
        service: item.service,
        countryId: item.countryId,
        operator: item.operator,
        assignmentCount: item.assignmentCount,
        successCount: item.successCount,
        failureCount: item.failureCount,
        refundedCancelCount: item.refundedCancelCount,
        paidCancelCount: item.paidCancelCount,
        successRate: item.successCount + item.failureCount > 0
          ? item.successCount / (item.successCount + item.failureCount)
          : 0,
        lastSuccessAtIso: item.lastSuccessAtIso,
        lastFailureAtIso: item.lastFailureAtIso,
      }))
      .sort((left, right) => {
        if (right.successRate !== left.successRate) {
          return right.successRate - left.successRate;
        }
        if (right.assignmentCount !== left.assignmentCount) {
          return right.assignmentCount - left.assignmentCount;
        }
        return left.countryId - right.countryId;
      });
  }

  getHeroSmsStats(): {
    paidLeaseCount: number;
    activeReusableLeaseCount: number;
    selectionStats: HeroSmsSelectionStatsSnapshot[];
  } {
    return {
      paidLeaseCount: this.heroSmsPaidLeasesByUpstreamActivationId.size,
      activeReusableLeaseCount: Array.from(this.heroSmsPaidLeasesByUpstreamActivationId.values()).filter((lease) =>
        !lease.cancelledAtIso
        && !lease.completedAtIso
        && Date.parse(lease.leaseExpiresAtIso) > Date.now()
        && lease.logicalActivationIds.length < Math.max(1, lease.maxBindingsPerPhone)
      ).length,
      selectionStats: this.listHeroSmsSelectionStats(),
    };
  }

  recordRuntimeStateLoad(result: {
    status: "skipped" | "loaded" | "empty" | "failed";
    detail?: string;
    error?: unknown;
    checkedAt?: Date;
  }): void {
    const checkedAt = (result.checkedAt ?? new Date()).toISOString();
    this.runtimeDiagnostics.stateLoad = {
      attempted: result.status !== "skipped",
      status: result.status,
      checkedAt,
      detail: result.detail,
      lastError: result.error instanceof Error
        ? result.error.message
        : typeof result.error === "string"
          ? result.error
          : undefined,
    };
  }

  recordMaintenanceLoopSuccess(startedAt: Date, detail?: string): void {
    this.recordRuntimeLoopSuccess("maintenanceLoop", startedAt, detail);
  }

  recordMaintenanceLoopFailure(startedAt: Date, error: unknown, detail?: string): void {
    this.recordRuntimeLoopFailure("maintenanceLoop", startedAt, error, detail);
  }

  recordActiveProbeLoopSuccess(startedAt: Date, detail?: string): void {
    this.recordRuntimeLoopSuccess("activeProbeLoop", startedAt, detail);
  }

  recordActiveProbeLoopFailure(startedAt: Date, error: unknown, detail?: string): void {
    this.recordRuntimeLoopFailure("activeProbeLoop", startedAt, error, detail);
  }

  recordPersistenceLoopSuccess(startedAt: Date, detail?: string): void {
    this.recordRuntimeLoopSuccess("persistenceLoop", startedAt, detail);
  }

  recordPersistenceLoopFailure(startedAt: Date, error: unknown, detail?: string): void {
    this.recordRuntimeLoopFailure("persistenceLoop", startedAt, error, detail);
  }

  private recordRuntimeLoopSuccess(
    loopKey: "maintenanceLoop" | "activeProbeLoop" | "persistenceLoop",
    startedAt: Date,
    detail?: string,
  ): void {
    const loop = this.runtimeDiagnostics[loopKey];
    const completedAt = new Date();
    loop.runCount += 1;
    loop.successCount += 1;
    loop.lastStartedAt = startedAt.toISOString();
    loop.lastCompletedAt = completedAt.toISOString();
    loop.lastSucceededAt = completedAt.toISOString();
    loop.lastDurationMs = completedAt.getTime() - startedAt.getTime();
    loop.detail = detail;
    loop.lastError = undefined;
  }

  private recordRuntimeLoopFailure(
    loopKey: "maintenanceLoop" | "activeProbeLoop" | "persistenceLoop",
    startedAt: Date,
    error: unknown,
    detail?: string,
  ): void {
    const loop = this.runtimeDiagnostics[loopKey];
    const completedAt = new Date();
    loop.runCount += 1;
    loop.failureCount += 1;
    loop.lastStartedAt = startedAt.toISOString();
    loop.lastCompletedAt = completedAt.toISOString();
    loop.lastFailedAt = completedAt.toISOString();
    loop.lastDurationMs = completedAt.getTime() - startedAt.getTime();
    loop.detail = detail;
    loop.lastError = error instanceof Error ? error.message : String(error);
  }

  private listProviderCatalog(): ProviderDescriptor[] {
    const descriptors = this.listScrapeProviderDescriptors().map((descriptor) =>
      this.toCatalogDescriptor(descriptor)
    );
    if (this.heroSmsActivationProvider) {
      descriptors.push(heroSmsActivationProviderDescriptor);
    }
    return descriptors;
  }

  private listScrapeProviderDescriptors(): ProviderDescriptor[] {
    return Array.from(this.providers.values(), (provider) => provider.descriptor);
  }

  private createSyntheticProviderHealthSnapshot(descriptor: ProviderDescriptor): SmsProviderHealthSnapshot {
    return {
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      status: "active",
      healthState: "unknown",
      healthScore: 1,
      consecutiveFailures: 0,
      activeRouteCoolingCount: 0,
      lastDetail: descriptor.costTier === "paid"
        ? "This provider is enabled but does not participate in scrape-route health probes."
        : "This provider is enabled but has not reported scrape-route health yet.",
    };
  }

  private matchesListCostTier(descriptor: ProviderDescriptor, costTier?: CostTier): boolean {
    if (!costTier) {
      return true;
    }
    return descriptor.costTier === costTier;
  }

  getHealthSummary(now: Date = new Date()): SmsProviderHealthSummary {
    const providers = this.listProviderHealth(now);
    return {
      totalProviders: providers.length,
      activeCount: providers.filter((provider) => provider.status === "active").length,
      coolingCount: providers.filter((provider) => provider.status === "cooling").length,
      temporarilyDisabledCount: providers.filter((provider) => provider.status === "temporarily_disabled").length,
      degradedCount: providers.filter((provider) => provider.status === "degraded").length,
      challengeCount: providers.filter((provider) => provider.healthState === "challenge").length,
      blockedCount: providers.filter((provider) => provider.healthState === "blocked").length,
      emptyCount: providers.filter((provider) => provider.healthState === "empty").length,
    };
  }

  getRuntimeStateSnapshot(now: Date = new Date()): EasySmsRuntimeStateSnapshot {
    const baseSnapshot = this.operationalState.snapshot(now);
    return {
      ...baseSnapshot,
      providers: this.listProviderHealth(now),
      managedSessions: this.querySessions({ newestFirst: true }),
      observedMessages: this.queryStoredObservedMessages({ newestFirst: true }),
      projectedMessages: this.queryStoredProjectedMessages({ newestFirst: true }),
      issuedNumbers: Array.from(this.issuedNumbers.entries(), ([numberId, reference]) => ({ numberId, reference })),
      nextSyntheticActivationId: this.nextSyntheticActivationId,
      nextSessionSequence: this.nextSessionSequence,
    };
  }

  hydrateRuntimeState(snapshot: EasySmsRuntimeStateSnapshot | undefined, now: Date = new Date()): void {
    this.operationalState.hydrate(snapshot, now);
    this.syntheticActivationSessions.clear();
    this.managedSessions.clear();
    this.managedSessionIdByActivationId.clear();
    this.observedMessages.clear();
    this.projectedMessages.clear();
    this.issuedNumbers.clear();
    for (const session of snapshot?.managedSessions ?? []) {
      this.managedSessions.set(session.id, session);
      this.managedSessionIdByActivationId.set(session.activationId, session.id);
      if (session.sessionMode === "synthetic-public-inbox") {
        this.syntheticActivationSessions.set(session.activationId, session);
      }
      if (session.numberId) {
        this.issuedNumbers.set(session.numberId, {
          providerKey: session.providerKey,
          sourceUrl: session.sourceUrl ?? "",
          phoneNumber: session.phoneNumber,
          countryName: session.countryName,
          countryCode: session.countryCode,
        });
      }
    }
    for (const message of snapshot?.observedMessages ?? []) {
      const existing = this.observedMessages.get(message.sessionId) ?? [];
      existing.push(message);
      this.observedMessages.set(message.sessionId, existing);
    }
    for (const message of snapshot?.projectedMessages ?? []) {
      const existing = this.projectedMessages.get(message.sessionId) ?? [];
      existing.push(message);
      this.projectedMessages.set(message.sessionId, existing);
    }
    for (const issued of snapshot?.issuedNumbers ?? []) {
      this.issuedNumbers.set(issued.numberId, issued.reference);
    }
    this.nextSyntheticActivationId = Math.max(
      snapshot?.nextSyntheticActivationId ?? INITIAL_SYNTHETIC_ACTIVATION_ID,
      this.computeNextSyntheticActivationId(),
    );
    this.nextSessionSequence = Math.max(
      snapshot?.nextSessionSequence ?? INITIAL_SESSION_SEQUENCE,
      this.computeNextSessionSequence(),
    );
  }

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<ListPublicNumbersResult> {
    const limit = options.limit ?? this.config.scraping.maxNumbersPerProvider;
    const orderedProviders = this.resolveProvidersForList(options);
    const strategyModeId = this.config.strategy.providerStrategyModeId.trim().toLowerCase();
    const batchSize = strategyModeId === "weighted-fallback" ? 1 : 3;
    const items = [];
    const errors = [];

    for (let index = 0; index < orderedProviders.length; index += batchSize) {
      const batch = orderedProviders.slice(index, index + batchSize);
      const settled = await Promise.all(
        batch.map(async ({ provider, candidate }) => {
          const context = this.buildListRouteContext(provider, options);
          const availabilityIssue = this.operationalState.getAvailabilityIssue(context);
          if (availabilityIssue) {
            return {
              providerKey: provider.descriptor.key,
              error: new ProviderRouteUnavailableError(provider.descriptor.key, availabilityIssue.reason),
            };
          }

          try {
            const providerLimit = strategyModeId === "weighted-fallback"
              ? limit
              : Math.max(1, limit - items.length);
            const providerItems = await provider.listPublicNumbers({
              ...options,
              limit: providerLimit,
            });
            this.operationalState.recordRouteSuccess(context, {
              detail: providerItems.length > 0
                ? `Retrieved ${providerItems.length} public numbers.`
                : "Provider responded but returned no public numbers.",
              itemCount: providerItems.length,
              isEmpty: providerItems.length === 0,
            });
            return {
              providerKey: provider.descriptor.key,
              items: providerItems,
              candidate,
            };
          } catch (error) {
            this.operationalState.recordRouteFailure(context, error);
            return {
              providerKey: provider.descriptor.key,
              error,
              candidate,
            };
          }
        }),
      );

      for (const result of settled) {
        if ("items" in result) {
          items.push(...result.items);
          if (strategyModeId === "weighted-fallback" && result.items.length > 0) {
            const earlyResult = {
              items: items.slice(0, limit),
              errors,
            };
            this.rememberIssuedPublicNumbers(earlyResult.items);
            return earlyResult;
          }
          continue;
        }

        errors.push({
          providerKey: result.providerKey,
          message: result.error instanceof Error ? result.error.message : "Unknown error",
        });
      }

      if (items.length >= limit) {
        break;
      }
    }

    const finalResult = {
      items: items.slice(0, limit),
      errors,
    };
    this.rememberIssuedPublicNumbers(finalResult.items);
    return finalResult;
  }

  async getInbox(options: GetInboxOptions, runtimeOptions: GetInboxRuntimeOptions = {}): Promise<SmsInboxSnapshot> {
    const provider = this.providers.get(options.providerKey);
    if (!provider) {
      throw new ProviderNotFoundError(options.providerKey);
    }

    if (!provider.descriptor.capabilities.includes("read-public-inbox")) {
      throw new ProviderRouteUnavailableError(
        options.providerKey,
        "This provider does not support reading public inboxes.",
      );
    }

    const reference = this.requireIssuedNumberReference(options.numberId);
    const context = this.buildInboxRouteContext(provider, reference);
    if (!runtimeOptions.ignoreAvailabilityIssue) {
      const availabilityIssue = this.operationalState.getAvailabilityIssue(context);
      if (availabilityIssue) {
        throw new ProviderRouteUnavailableError(options.providerKey, availabilityIssue.reason);
      }
    }

    try {
      const inbox = await provider.getInbox(options.numberId);
      this.operationalState.recordRouteSuccess(context, {
        detail: `Retrieved ${inbox.messages.length} inbox messages.`,
        itemCount: inbox.messages.length,
      });
      return inbox;
    } catch (error) {
      this.operationalState.recordRouteFailure(context, error);
      throw new ProviderFetchError(
        options.providerKey,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  async probeProvider(providerKey: string, now: Date = new Date()): Promise<SmsProviderHealthProbeResult> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new ProviderNotFoundError(providerKey);
    }

    const listContext = this.buildListRouteContext(provider, {});

    try {
      const items = await provider.listPublicNumbers({ limit: 1 });
      this.operationalState.recordRouteSuccess(listContext, {
        detail: items.length > 0
          ? `Probe retrieved ${items.length} public number${items.length === 1 ? "" : "s"}.`
          : "Probe reached the provider, but no public numbers were available.",
        itemCount: items.length,
        isEmpty: items.length === 0,
        now,
      });

      if (items.length === 0) {
        const result = this.buildProbeResult(provider.descriptor.key, provider.descriptor.displayName, {
          ok: false,
          routeKind: "list-public-numbers",
          detail: "Provider returned an empty public number directory.",
          checkedAt: now.toISOString(),
          publicNumberCount: 0,
        });
        this.operationalState.recordProbeResult(result);
        return result;
      }

      if (provider.descriptor.capabilities.includes("read-public-inbox")) {
        const reference = decodeNumberId(items[0].numberId);
        const inboxContext = this.buildInboxRouteContext(provider, reference);

        try {
          const inbox = await provider.getInbox(items[0].numberId);
          this.operationalState.recordRouteSuccess(inboxContext, {
            detail: `Probe retrieved ${inbox.messages.length} inbox message${inbox.messages.length === 1 ? "" : "s"}.`,
            itemCount: inbox.messages.length,
            now,
          });
          const result = this.buildProbeResult(provider.descriptor.key, provider.descriptor.displayName, {
            ok: true,
            routeKind: "read-public-inbox",
            detail: `Probe succeeded with ${inbox.messages.length} inbox message${inbox.messages.length === 1 ? "" : "s"}.`,
            checkedAt: now.toISOString(),
            publicNumberCount: items.length,
            inboxMessageCount: inbox.messages.length,
          });
          this.operationalState.recordProbeResult(result);
          return result;
        } catch (error) {
          const failure = this.operationalState.recordRouteFailure(inboxContext, error, now);
          const result = this.buildProbeResult(provider.descriptor.key, provider.descriptor.displayName, {
            ok: false,
            routeKind: "read-public-inbox",
            detail: error instanceof Error ? error.message : String(error),
            checkedAt: now.toISOString(),
            publicNumberCount: items.length,
            routeKey: failure.route.routeKey,
            cooldownApplied: failure.cooldownApplied,
          });
          this.operationalState.recordProbeResult(result);
          return result;
        }
      }

      const result = this.buildProbeResult(provider.descriptor.key, provider.descriptor.displayName, {
        ok: true,
        routeKind: "list-public-numbers",
        detail: `Probe succeeded with ${items.length} public number${items.length === 1 ? "" : "s"}.`,
        checkedAt: now.toISOString(),
        publicNumberCount: items.length,
      });
      this.operationalState.recordProbeResult(result);
      return result;
    } catch (error) {
      const failure = this.operationalState.recordRouteFailure(listContext, error, now);
      const result = this.buildProbeResult(provider.descriptor.key, provider.descriptor.displayName, {
        ok: false,
        routeKind: "list-public-numbers",
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: now.toISOString(),
        routeKey: failure.route.routeKey,
        cooldownApplied: failure.cooldownApplied,
      });
      this.operationalState.recordProbeResult(result);
      return result;
    }
  }

  async probeAllProviders(now: Date = new Date()): Promise<SmsProviderHealthProbeResult[]> {
    const providerKeys = Array.from(this.providers.values(), (p) => p.descriptor.key);
    const batchSize = 3;
    const results: SmsProviderHealthProbeResult[] = [];

    for (let i = 0; i < providerKeys.length; i += batchSize) {
      const batch = providerKeys.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        batch.map((key) => this.probeProvider(key, now)),
      );
      for (const result of settled) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  refreshOperationalState(now: Date = new Date()) {
    return this.operationalState.refresh(now);
  }

  resetOperationalState(providerKey?: string, now: Date = new Date()) {
    return this.operationalState.resetProvider(providerKey, now);
  }

  disableProviderTemporarily(
    providerKey: string,
    input: { until: Date; reason: string; now?: Date },
  ): SmsProviderHealthSnapshot {
    this.ensureProviderKeyExists(providerKey);
    return this.operationalState.markTemporaryDisabled(providerKey, input);
  }

  enableProvider(providerKey: string, now: Date = new Date()): SmsProviderHealthSnapshot {
    this.ensureProviderKeyExists(providerKey);
    return this.operationalState.clearTemporaryDisabled(providerKey, now);
  }

  runMaintenance(now: Date = new Date()) {
    return {
      refreshed: this.refreshOperationalState(now),
    };
  }

  private resolveProviders(providerKey?: string): SmsProvider[] {
    if (providerKey) {
      const provider = this.providers.get(providerKey);
      if (!provider) {
        throw new ProviderNotFoundError(providerKey);
      }

      return [provider];
    }

    return Array.from(this.providers.values());
  }

  private resolveProvidersForList(
    options: Pick<ListPublicNumbersOptions, "providerKey" | "countryCode" | "countryName" | "costTier">,
    now: Date = new Date(),
  ): Array<{ provider: SmsProvider; candidate: SmsProviderSelectionCandidate }> {
    if (options.providerKey) {
      const provider = this.providers.get(options.providerKey);
      if (!provider) {
        throw new ProviderNotFoundError(options.providerKey);
      }
      if (!this.matchesListCostTier(provider.descriptor, options.costTier)) {
        return [];
      }

      const candidate = this.operationalState.getSelectionCandidate(
        this.buildListRouteContext(provider, options),
        now,
      );
      return [{ provider, candidate }];
    }

    const ranked = this.getListSelectionPlan(options, now);
    return ranked
      .map((candidate) => ({
        candidate,
        provider: this.providers.get(candidate.providerKey),
      }))
      .filter((item): item is { provider: SmsProvider; candidate: SmsProviderSelectionCandidate } => item.provider !== undefined);
  }

  private ensureProviderKeyExists(providerKey: string): void {
    if (!this.providers.has(providerKey)) {
      throw new ProviderNotFoundError(providerKey);
    }
  }

  private supportsSyntheticActivation(descriptor: ProviderDescriptor): boolean {
    return descriptor.capabilities.includes("list-public-numbers")
      && descriptor.capabilities.includes("read-public-inbox");
  }

  private shouldUsePaidFacade(options: { providerKey?: string; costTier?: CostTier }): boolean {
    if (options.providerKey === "hero_sms") {
      return true;
    }

    if (options.costTier === "paid") {
      return true;
    }

    return false;
  }

  private hasSyntheticActivationProviders(): boolean {
    return Array.from(this.providers.values()).some((provider) =>
      this.supportsSyntheticActivation(provider.descriptor)
    );
  }

  private toCatalogDescriptor(descriptor: ProviderDescriptor): ProviderDescriptor {
    if (!this.supportsSyntheticActivation(descriptor)) {
      return descriptor;
    }

    const capabilities = new Set(descriptor.capabilities);
    capabilities.add("create-activation");
    capabilities.add("get-activation-status");
    capabilities.add("set-activation-status");

    const notes = [...descriptor.notes];
    const syntheticNote = "Supports a synthetic activation facade backed by public inbox polling.";
    if (!notes.includes(syntheticNote)) {
      notes.push(syntheticNote);
    }

    return {
      ...descriptor,
      capabilities: Array.from(capabilities),
      notes,
    };
  }

  private requireHeroSmsProvider(): HeroSmsActivationProvider {
    if (!this.heroSmsActivationProvider) {
      throw new ProviderNotFoundError("hero_sms");
    }

    return this.heroSmsActivationProvider;
  }

  private requireSyntheticActivationProvider(providerKey: string): SmsProvider {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw new ProviderNotFoundError(providerKey);
    }
    if (!this.supportsSyntheticActivation(provider.descriptor)) {
      throw new ProviderRouteUnavailableError(
        providerKey,
        "This provider does not support synthetic activation sessions.",
      );
    }
    return provider;
  }

  private allocateSyntheticActivationId(): number {
    const activationId = this.nextSyntheticActivationId;
    this.nextSyntheticActivationId += 1;
    return activationId;
  }

  private allocateSessionId(): string {
    const sessionId = `sms_session_${String(this.nextSessionSequence).padStart(6, "0")}`;
    this.nextSessionSequence += 1;
    return sessionId;
  }

  private computeNextSyntheticActivationId(): number {
    const existingMax = Array.from(this.syntheticActivationSessions.keys()).reduce(
      (maxValue, current) => Math.max(maxValue, current),
      INITIAL_SYNTHETIC_ACTIVATION_ID - 1,
    );
    return Math.max(this.nextSyntheticActivationId, existingMax + 1);
  }

  private computeNextSessionSequence(): number {
    const existingMax = Array.from(this.managedSessions.keys()).reduce((maxValue, sessionId) => {
      const match = sessionId.match(/(\d+)$/);
      return Math.max(maxValue, Number.parseInt(match?.[1] ?? "0", 10));
    }, 0);
    return Math.max(this.nextSessionSequence, existingMax + 1);
  }

  private registerManagedSessionFromActivation(
    activation: HeroSmsActivationSession,
    options: {
      baselineCode?: string;
      baselineText?: string;
      baselineReceivedAtIso?: string;
    } = {},
  ): HeroSmsActivationSession {
    const existingSessionId = this.managedSessionIdByActivationId.get(activation.activationId);
    const sessionId = existingSessionId ?? this.allocateSessionId();
    const providerDescriptor = this.listProviders().find((item) => item.key === activation.providerKey);
    const openedAtIso = activation.createdAtIso;
    const session: EasySmsManagedSessionSnapshot = {
      id: sessionId,
      providerKey: activation.providerKey,
      providerDisplayName: providerDescriptor?.displayName ?? activation.providerKey,
      activationId: activation.activationId,
      upstreamActivationId: activation.upstreamActivationId,
      sessionMode: activation.sessionMode ?? (activation.costTier === "free" ? "synthetic-public-inbox" : "paid-api"),
      costTier: activation.costTier ?? (activation.providerKey === "hero_sms" ? "paid" : "free"),
      numberId: activation.numberId,
      phoneNumber: activation.phoneNumber,
      sourceUrl: activation.sourceUrl,
      service: activation.service,
      countryId: activation.countryId,
      countryCode: activation.countryCode,
      countryName: activation.countryName,
      operator: activation.operator,
      activationCost: activation.activationCost,
      selectionMode: activation.selectionMode,
      businessKey: activation.businessKey,
      assignmentIndex: activation.assignmentIndex,
      maxBindingsPerPhone: activation.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: activation.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: activation.leaseExpiresAtIso,
      baselineCode: options.baselineCode ?? this.managedSessions.get(sessionId)?.baselineCode,
      baselineText: options.baselineText ?? this.managedSessions.get(sessionId)?.baselineText,
      baselineReceivedAtIso: options.baselineReceivedAtIso ?? this.managedSessions.get(sessionId)?.baselineReceivedAtIso,
      openedAtIso,
      cancelledAtIso: this.managedSessions.get(sessionId)?.cancelledAtIso,
      completedAtIso: this.managedSessions.get(sessionId)?.completedAtIso,
      lastRequestedCodeAtIso: this.managedSessions.get(sessionId)?.lastRequestedCodeAtIso,
      lastStatusAtIso: this.managedSessions.get(sessionId)?.lastStatusAtIso,
      lastCode: this.managedSessions.get(sessionId)?.lastCode,
      lastCodeAtIso: this.managedSessions.get(sessionId)?.lastCodeAtIso,
      lastText: this.managedSessions.get(sessionId)?.lastText,
      lastReportedOutcome: this.managedSessions.get(sessionId)?.lastReportedOutcome,
    };
    this.managedSessions.set(sessionId, session);
    this.managedSessionIdByActivationId.set(activation.activationId, sessionId);
    if (session.sessionMode === "synthetic-public-inbox") {
      this.syntheticActivationSessions.set(session.activationId, session);
    }

    return {
      ...activation,
      sessionId,
    };
  }

  private getManagedSession(sessionId: string): EasySmsManagedSessionSnapshot {
    const session = this.managedSessions.get(sessionId);
    if (!session) {
      throw new SmsSessionNotFoundError(sessionId);
    }
    return session;
  }

  private updateManagedSessionFromStatus(status: HeroSmsActivationStatusSnapshot): void {
    const sessionId = status.sessionId ?? this.managedSessionIdByActivationId.get(status.activationId);
    if (!sessionId) {
      return;
    }
    const session = this.managedSessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastStatusAtIso = status.fetchedAtIso;
    if (status.code) {
      session.lastCode = status.code;
      session.lastCodeAtIso = status.receivedAtIso ?? status.fetchedAtIso;
    }
    if (status.text) {
      session.lastText = status.text;
    }
    if (status.cancelled) {
      session.cancelledAtIso = status.fetchedAtIso;
    }
    this.managedSessions.set(session.id, session);
    if (session.sessionMode === "synthetic-public-inbox") {
      this.syntheticActivationSessions.set(session.activationId, session);
    }
  }

  private decorateActivationStatus(status: HeroSmsActivationStatusSnapshot): HeroSmsActivationStatusSnapshot {
    const sessionId = this.managedSessionIdByActivationId.get(status.activationId);
    const session = sessionId ? this.managedSessions.get(sessionId) : undefined;
    const decorated = {
      ...status,
      sessionId,
      upstreamActivationId: status.upstreamActivationId ?? session?.upstreamActivationId,
      costTier: status.costTier ?? session?.costTier,
      sessionMode: status.sessionMode ?? session?.sessionMode,
      selectionMode: status.selectionMode ?? session?.selectionMode,
      businessKey: status.businessKey ?? session?.businessKey,
      assignmentIndex: status.assignmentIndex ?? session?.assignmentIndex,
      maxBindingsPerPhone: status.maxBindingsPerPhone ?? session?.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: status.refundableCancelAvailableAtIso ?? session?.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: status.leaseExpiresAtIso ?? session?.leaseExpiresAtIso,
      refundEligible: status.refundEligible ?? false,
    };
    this.updateManagedSessionFromStatus(decorated);
    return decorated;
  }

  private decorateActivationStatusUpdate(result: HeroSmsActivationStatusUpdateResult): HeroSmsActivationStatusUpdateResult {
    const sessionId = this.managedSessionIdByActivationId.get(result.activationId);
    const session = sessionId ? this.managedSessions.get(sessionId) : undefined;
    if (session) {
      if (result.requestedAction === "cancel") {
        session.cancelledAtIso = result.updatedAtIso;
      } else if (result.requestedAction === "complete") {
        session.completedAtIso = result.updatedAtIso;
      } else {
        session.lastRequestedCodeAtIso = result.updatedAtIso;
      }
      this.managedSessions.set(session.id, session);
      if (session.sessionMode === "synthetic-public-inbox") {
        this.syntheticActivationSessions.set(session.activationId, session);
      }
    }

    return {
      ...result,
      sessionId,
      upstreamActivationId: result.upstreamActivationId ?? session?.upstreamActivationId,
      costTier: result.costTier ?? session?.costTier,
      sessionMode: result.sessionMode ?? session?.sessionMode,
      selectionMode: result.selectionMode ?? session?.selectionMode,
      businessKey: result.businessKey ?? session?.businessKey,
      assignmentIndex: result.assignmentIndex ?? session?.assignmentIndex,
      maxBindingsPerPhone: result.maxBindingsPerPhone ?? session?.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: result.refundableCancelAvailableAtIso ?? session?.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: result.leaseExpiresAtIso ?? session?.leaseExpiresAtIso,
      refundEligible: result.refundEligible ?? false,
    };
  }

  private async createSyntheticActivation(
    input: HeroSmsActivationCreateInput,
    providerKey?: string,
  ): Promise<HeroSmsActivationSession> {
    const reusableLease = await this.findReusableSyntheticLeaseForInput(input, providerKey);
    if (reusableLease) {
      try {
        const baseline = await this.readSyntheticLeaseBaseline(reusableLease);
        return this.createSyntheticLogicalAssignment(reusableLease, input, baseline);
      } catch (error) {
        if (!(error instanceof ProviderFetchError || error instanceof ProviderRouteUnavailableError)) {
          throw error;
        }
      }
    }

    const { provider, number } = await this.acquireSyntheticActivationNumber(input, providerKey);
    const activationId = this.allocateSyntheticActivationId();
    const openedAtIso = new Date().toISOString();
    const lease: SyntheticActivationLeaseRecord = {
      providerKey: provider.descriptor.key,
      numberId: number.numberId,
      sourceUrl: number.sourceUrl,
      phoneNumber: number.phoneNumber,
      service: input.service?.trim() || DEFAULT_SYNTHETIC_ACTIVATION_SERVICE,
      countryId: input.country ?? DEFAULT_SYNTHETIC_COUNTRY_ID,
      countryCode: number.countryCode,
      countryName: number.countryName,
      operator: input.operator,
      selectionMode: input.selectionMode,
      businessKey: normalizeText(input.businessKey) || HEROSMS_DEFAULT_BUSINESS_KEY,
      maxBindingsPerPhone: Math.max(
        1,
        Number.isFinite(input.maxBindingsPerPhone)
          ? Number(input.maxBindingsPerPhone)
          : 1,
      ),
      openedAtIso,
      logicalActivationIds: [],
    };

    this.syntheticActivationLeasesByKey.set(
      this.buildSyntheticLeaseKey(lease.providerKey, lease.numberId, lease.businessKey, lease.service),
      lease,
    );

    return this.createSyntheticLogicalAssignment(lease, input);
  }

  private async buildSyntheticCountryProjections(
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<SyntheticCountryProjection[]> {
    if (options.costTier === "paid") {
      return [];
    }

    const eligibleProviders = this.resolveProvidersForSyntheticMetadata(options.providerKey);
    const countries = new Map<string, SyntheticCountryProjection>();

    for (const provider of eligibleProviders) {
      const context = this.buildListRouteContext(provider, {});
      const availabilityIssue = this.operationalState.getAvailabilityIssue(context);
      if (availabilityIssue) {
        continue;
      }

      try {
        const items = await provider.listPublicNumbers({
          providerKey: provider.descriptor.key,
          limit: this.config.scraping.maxNumbersPerProvider,
          costTier: "free",
        });

        this.operationalState.recordRouteSuccess(context, {
          detail: items.length > 0
            ? `Facade metadata sampled ${items.length} public numbers.`
            : "Facade metadata found no public numbers for this provider.",
          itemCount: items.length,
          isEmpty: items.length === 0,
        });

        for (const item of items) {
          const countryName = normalizeText(item.countryName) || provider.descriptor.displayName;
          const countryCode = item.countryCode ?? inferCountryCode(item.countryName, item.phoneNumber);
          const countryId = buildSyntheticCountryId(countryName, countryCode);
          const key = `${countryId}`;
          const existing = countries.get(key);
          if (!existing) {
            countries.set(key, {
              providerKey: provider.descriptor.key,
              countryId,
              apiName: countryName,
              dialCode: countryCode,
              publicNumberCount: 1,
              providerCounts: new Map([[provider.descriptor.key, 1]]),
            });
            continue;
          }

          existing.publicNumberCount += 1;
          existing.providerCounts.set(
            provider.descriptor.key,
            (existing.providerCounts.get(provider.descriptor.key) ?? 0) + 1,
          );
          if (
            (existing.providerCounts.get(provider.descriptor.key) ?? 0)
            > (existing.providerCounts.get(existing.providerKey) ?? 0)
          ) {
            existing.providerKey = provider.descriptor.key;
          }
        }
      } catch (error) {
        this.operationalState.recordRouteFailure(context, error);
      }
    }

    return Array.from(countries.values()).sort((left, right) => left.apiName.localeCompare(right.apiName));
  }

  private resolveProvidersForSyntheticMetadata(providerKey?: string): SmsProvider[] {
    if (providerKey) {
      return [this.requireSyntheticActivationProvider(providerKey)];
    }

    return Array.from(this.providers.values()).filter((provider) =>
      this.supportsSyntheticActivation(provider.descriptor)
    );
  }

  private async resolveSyntheticCountry(
    countryId: number,
    options: { providerKey?: string; costTier?: CostTier } = {},
  ): Promise<SyntheticCountryProjection> {
    const countries = await this.buildSyntheticCountryProjections(options);
    const country = countries.find((item) => item.countryId === countryId);
    if (!country) {
      throw new ProviderRouteUnavailableError(
        options.providerKey ?? "free",
        `Unknown free facade country id: ${countryId}.`,
      );
    }

    return country;
  }

  private async collectProviderMessagesForSession(session: EasySmsManagedSessionSnapshot): Promise<SmsSessionMessage[]> {
    if (session.sessionMode === "synthetic-public-inbox" && session.numberId) {
      const inbox = await this.getInbox(
        {
          providerKey: session.providerKey,
          numberId: session.numberId,
        },
        { ignoreAvailabilityIssue: true },
      );
      return inbox.messages.map((message) => ({
        id: `${session.id}:provider:${message.id}`,
        sessionId: session.id,
        providerKey: session.providerKey,
        sourceType: "provider-inbox",
        sender: message.sender,
        receivedAtText: message.receivedAtText,
        receivedAtIso: message.receivedAtIso,
        content: message.content,
        code: extractOtpCode(message),
        sourceUrl: message.sourceUrl,
        observedAtIso: message.receivedAtIso ?? inbox.fetchedAtIso,
      }));
    }

    const status = await this.getActivationStatus(session.activationId, {
      providerKey: session.providerKey,
      costTier: session.costTier,
    });
    const content = status.text
      ?? status.code
      ?? status.callText
      ?? status.rawStatusText
      ?? "";
    if (!content.trim()) {
      return [];
    }

    return [
      {
        id: `${session.id}:status:${status.fetchedAtIso}`,
        sessionId: session.id,
        providerKey: session.providerKey,
        sourceType: "activation-status",
        sender: status.callFrom,
        receivedAtIso: status.receivedAtIso ?? status.callReceivedAtIso ?? status.fetchedAtIso,
        content,
        code: status.code ?? status.callCode,
        sourceUrl: session.sourceUrl,
        observedAtIso: status.fetchedAtIso,
      },
    ];
  }

  private applySessionOutcomeToOperationalState(
    session: EasySmsManagedSessionSnapshot,
    report: SmsSessionOutcomeReport,
    now: Date,
  ): void {
    if (session.sessionMode !== "synthetic-public-inbox" || !session.numberId) {
      return;
    }

    const provider = this.providers.get(session.providerKey);
    if (!provider) {
      return;
    }

    const context = this.buildInboxRouteContext(provider, {
      providerKey: session.providerKey,
      sourceUrl: session.sourceUrl ?? "",
      phoneNumber: session.phoneNumber,
      countryName: session.countryName,
      countryCode: session.countryCode,
    });
    if (report.success) {
      this.operationalState.recordRouteSuccess(context, {
        detail: report.detail?.trim() || "Session outcome reported success.",
        now,
      });
      return;
    }

    const failureReason = report.failureReason?.trim() || "session_outcome_failure";
    const detail = report.detail?.trim();
    this.operationalState.recordRouteFailure(
      context,
      new Error(detail ? `${failureReason}: ${detail}` : failureReason),
      now,
    );
  }

  private async acquireSyntheticActivationNumber(
    input: HeroSmsActivationCreateInput,
    providerKey?: string,
  ): Promise<{ provider: SmsProvider; number: SmsPublicNumber }> {
    if (input.numberId) {
      const reference = this.requireIssuedNumberReference(input.numberId);
      const provider = this.requireSyntheticActivationProvider(providerKey ?? reference.providerKey);
      if (provider.descriptor.key !== reference.providerKey) {
        throw new ProviderRouteUnavailableError(
          provider.descriptor.key,
          "The requested numberId belongs to a different provider.",
        );
      }

      return {
        provider,
        number: {
          providerKey: provider.descriptor.key,
          providerDisplayName: provider.descriptor.displayName,
          numberId: input.numberId,
          sourceUrl: reference.sourceUrl,
          phoneNumber: reference.phoneNumber,
          countryName: reference.countryName,
          countryCode: reference.countryCode,
          label: reference.label,
        },
      };
    }

    const orderedProviders = this.resolveProvidersForList({
      providerKey,
      countryCode: input.countryCode,
      countryName: input.countryName,
      costTier: "free",
    }).filter(({ provider }) => this.supportsSyntheticActivation(provider.descriptor));

    if (orderedProviders.length === 0) {
      throw new ProviderRouteUnavailableError(
        providerKey ?? "activation",
        providerKey
          ? "The requested provider cannot create a synthetic activation session."
          : "No free providers with readable public inboxes are currently available.",
      );
    }

    for (const { provider } of orderedProviders) {
      const context = this.buildListRouteContext(provider, {
        countryCode: input.countryCode,
        countryName: input.countryName,
      });
      const availabilityIssue = this.operationalState.getAvailabilityIssue(context);
      if (availabilityIssue) {
        continue;
      }

      try {
        const items = await provider.listPublicNumbers({
          providerKey: provider.descriptor.key,
          limit: 1,
          countryCode: input.countryCode,
          countryName: input.countryName,
          costTier: "free",
        });
        this.operationalState.recordRouteSuccess(context, {
          detail: items.length > 0
            ? "Synthetic activation selected a public number."
            : "Synthetic activation found no public numbers on this provider.",
          itemCount: items.length,
          isEmpty: items.length === 0,
        });
        if (items.length > 0) {
          this.rememberIssuedPublicNumbers(items);
          return {
            provider,
            number: items[0],
          };
        }
      } catch (error) {
        this.operationalState.recordRouteFailure(context, error);
      }
    }

    throw new ProviderRouteUnavailableError(
      providerKey ?? "activation",
      "No eligible public numbers were available for a synthetic activation session.",
    );
  }

  private getSyntheticActivationRecord(
    activationId: number,
    providerKey?: string,
  ): EasySmsManagedSessionSnapshot {
    const session = this.syntheticActivationSessions.get(activationId);
    if (!session) {
      throw new ActivationSessionNotFoundError(activationId);
    }
    if (providerKey && session.providerKey !== providerKey) {
      throw new ProviderRouteUnavailableError(
        providerKey,
        `Activation session ${activationId} belongs to provider ${session.providerKey}.`,
      );
    }
    return session;
  }

  private async getSyntheticActivationStatus(
    activationId: number,
    providerKey?: string,
  ): Promise<HeroSmsActivationStatusSnapshot> {
    const session = this.getSyntheticActivationRecord(activationId, providerKey);

    if (session.cancelledAtIso) {
      return {
        providerKey: session.providerKey,
        activationId: session.activationId,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: true,
        sessionId: session.id || this.managedSessionIdByActivationId.get(session.activationId),
        numberId: session.numberId,
        sourceUrl: session.sourceUrl,
        countryCode: session.countryCode,
        countryName: session.countryName,
        messageCount: 0,
        rawStatusText: "STATUS_CANCEL",
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
      };
    }

    const inbox = await this.getInbox(
      {
        providerKey: session.providerKey,
        numberId: session.numberId,
      },
      { ignoreAvailabilityIssue: true },
    );
    const latestOtpMessage = findLatestOtpMessage(inbox.messages);
    const code = extractOtpCode(latestOtpMessage);
    const baselineFingerprint = [
      session.baselineReceivedAtIso ?? "",
      session.baselineCode ?? "",
      session.baselineText ?? "",
    ].join("|");
    const statusFingerprint = [
      latestOtpMessage?.receivedAtIso ?? "",
      code ?? "",
      latestOtpMessage?.content ?? "",
    ].join("|");

    let received = Boolean(code);
    let resolvedCode = code;
    let resolvedText = latestOtpMessage?.content;
    let resolvedReceivedAtIso = latestOtpMessage?.receivedAtIso;
    if (received && baselineFingerprint === statusFingerprint) {
      received = false;
      resolvedCode = undefined;
      resolvedText = undefined;
      resolvedReceivedAtIso = undefined;
    }

    return {
      providerKey: session.providerKey,
      activationId: session.activationId,
      sessionId: session.id || this.managedSessionIdByActivationId.get(session.activationId),
      fetchedAtIso: new Date().toISOString(),
      received,
      cancelled: false,
      numberId: session.numberId,
      sourceUrl: session.sourceUrl,
      countryCode: session.countryCode,
      countryName: session.countryName,
      messageCount: inbox.messages.length,
      code: resolvedCode,
      text: resolvedText,
      receivedAtIso: resolvedReceivedAtIso,
      rawStatusText: resolvedCode ? `STATUS_OK:${resolvedCode}` : "STATUS_WAIT_CODE",
      costTier: "free",
      sessionMode: "synthetic-public-inbox",
    };
  }

  private async setSyntheticActivationStatus(
    activationId: number,
    action: HeroSmsActivationAction,
    providerKey?: string,
  ): Promise<HeroSmsActivationStatusUpdateResult> {
    const session = this.getSyntheticActivationRecord(activationId, providerKey);
    const updatedAtIso = new Date().toISOString();

    if (action === "cancel") {
      session.cancelledAtIso = updatedAtIso;
    } else if (action === "complete") {
      session.completedAtIso = updatedAtIso;
    } else {
      session.lastRequestedCodeAtIso = updatedAtIso;
    }

    this.syntheticActivationSessions.set(activationId, session);
    return {
      providerKey: session.providerKey,
      activationId: session.activationId,
      sessionId: session.id || this.managedSessionIdByActivationId.get(session.activationId),
      requestedAction: action,
      requestedStatus: mapActivationActionToStatus(action),
      resultText: mapSyntheticActivationResultText(action),
      costTier: "free",
      sessionMode: "synthetic-public-inbox",
      updatedAtIso,
    };
  }

  private buildListRouteContext(
    provider: SmsProvider,
    options: Pick<ListPublicNumbersOptions, "countryCode" | "countryName">,
  ): SmsProviderRouteContext {
    if (options.countryCode) {
      return {
        providerKey: provider.descriptor.key,
        providerDisplayName: provider.descriptor.displayName,
        routeKind: "list-public-numbers",
        scopeKind: "country",
        scopeValue: options.countryCode,
      };
    }

    if (options.countryName) {
      return {
        providerKey: provider.descriptor.key,
        providerDisplayName: provider.descriptor.displayName,
        routeKind: "list-public-numbers",
        scopeKind: "country",
        scopeValue: options.countryName,
      };
    }

    return {
      providerKey: provider.descriptor.key,
      providerDisplayName: provider.descriptor.displayName,
      routeKind: "list-public-numbers",
      scopeKind: "provider",
      scopeValue: "global",
    };
  }

  private buildInboxRouteContext(
    provider: SmsProvider,
    reference: SmsNumberReference,
  ): SmsProviderRouteContext {
    if (reference.countryCode) {
      return {
        providerKey: provider.descriptor.key,
        providerDisplayName: provider.descriptor.displayName,
        routeKind: "read-public-inbox",
        scopeKind: "country",
        scopeValue: reference.countryCode,
      };
    }

    if (reference.countryName) {
      return {
        providerKey: provider.descriptor.key,
        providerDisplayName: provider.descriptor.displayName,
        routeKind: "read-public-inbox",
        scopeKind: "country",
        scopeValue: reference.countryName,
      };
    }

    return {
      providerKey: provider.descriptor.key,
      providerDisplayName: provider.descriptor.displayName,
      routeKind: "read-public-inbox",
      scopeKind: "provider",
      scopeValue: "global",
    };
  }

  private buildProbeResult(
    providerKey: string,
    providerDisplayName: string,
    input: {
      ok: boolean;
      routeKind: SmsProviderRouteKind;
      checkedAt: string;
      detail?: string;
      publicNumberCount?: number;
      inboxMessageCount?: number;
      routeKey?: string;
      cooldownApplied?: boolean;
    },
  ): SmsProviderHealthProbeResult {
    const snapshot = this.listProviderHealth().find((item) => item.providerKey === providerKey);
    if (!snapshot) {
      throw new ProviderNotFoundError(providerKey);
    }

    return {
      providerKey,
      providerDisplayName,
      ok: input.ok,
      status: snapshot.status,
      healthState: snapshot.healthState,
      healthScore: snapshot.healthScore,
      routeKind: input.routeKind,
      checkedAt: input.checkedAt,
      detail: input.detail,
      publicNumberCount: input.publicNumberCount,
      inboxMessageCount: input.inboxMessageCount,
      routeKey: input.routeKey,
      cooldownApplied: input.cooldownApplied,
    };
  }
}

function extractManagedSessionSequence(sessionId: string): number | null {
  const match = /^sms_session_(\d+)$/.exec(sessionId);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createEasySmsService(config: EasySmsRuntimeConfig): EasySmsService {
  const enabledProviders = new Set(config.providers.enabledProviders);
  const providers: SmsProvider[] = [
    new OnlineSimProvider(config),
    new SmsToMeProvider(config),
    createReceiveSmssProvider(config),
    createReceiveSmsFreeCcProvider(config),
    new Sms24Provider(config),
    new YunDuanXinProvider(config),
  ].filter((provider) => enabledProviders.has(provider.descriptor.key));

  return new EasySmsService(config, providers);
}
