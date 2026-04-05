import type {
  EasySmsRuntimeStateSnapshot,
  ProviderDescriptor,
  SmsProviderHealthSnapshot,
  SmsProviderHealthState,
  SmsProviderHealthProbeResult,
  SmsProviderHealthSummary,
  SmsProviderKey,
  SmsProviderOperationalStatus,
  SmsProviderProbeHistoryEntry,
  SmsProviderProbeTrendSnapshot,
  SmsProviderSelectionCandidate,
  SmsProviderRouteHealthSnapshot,
  SmsProviderRouteKind,
  SmsProviderRouteScopeKind,
} from "../domain/models.js";
import { normalizeText } from "../shared/index.js";

export interface SmsProviderRouteContext {
  providerKey: SmsProviderKey;
  providerDisplayName: string;
  routeKind: SmsProviderRouteKind;
  scopeKind: SmsProviderRouteScopeKind;
  scopeValue: string;
}

export interface SmsProviderRouteFailureDecision {
  healthState: Extract<SmsProviderHealthState, "challenge" | "blocked" | "degraded">;
  errorClass: string;
  errorCode: string;
  penalty: number;
  cooldownBaseMs: number;
  cooldownEscalatedMs: number;
  escalateAfterCount: number;
}

export interface SmsProviderRouteReportResult {
  provider: SmsProviderHealthSnapshot;
  route: SmsProviderRouteHealthSnapshot;
  cooldownApplied: boolean;
}

export interface SmsProviderAvailabilityIssue {
  providerKey: SmsProviderKey;
  reason: string;
  status: SmsProviderOperationalStatus;
  routeKey?: string;
  until?: string;
}

export interface EasySmsProviderOperationalStateOptions {
  probeHistoryMaxEntries: number;
  probeHistoryWindowMs: number;
}

const DEFAULT_HEALTH_SCORE = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseTimestampMs(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatUntil(until: string | undefined): string {
  return until ? ` until ${until}` : "";
}

function buildRouteKey(context: SmsProviderRouteContext): string {
  return [
    context.providerKey,
    context.routeKind,
    context.scopeKind,
    normalizeText(context.scopeValue).toLowerCase() || "global",
  ].join("::");
}

function defaultProviderHealthSnapshot(descriptor: ProviderDescriptor): SmsProviderHealthSnapshot {
  return {
    providerKey: descriptor.key,
    providerDisplayName: descriptor.displayName,
    status: descriptor.enabled ? "active" : "offline",
    healthState: "unknown",
    healthScore: DEFAULT_HEALTH_SCORE,
    consecutiveFailures: 0,
    activeRouteCoolingCount: 0,
  };
}

function deriveHealthScoreForSuccess(current: number): number {
  return clamp(Math.max(current, 0.92), 0.1, 1);
}

function deriveHealthScoreForEmpty(current: number): number {
  return clamp(Math.max(current, 0.58), 0.1, 1);
}

function deriveHealthScoreForFailure(
  current: number,
  state: SmsProviderRouteFailureDecision["healthState"],
): number {
  switch (state) {
    case "challenge":
      return clamp(Math.min(current, 0.2), 0.1, 1);
    case "blocked":
      return clamp(Math.min(current, 0.25), 0.1, 1);
    default:
      return clamp(Math.min(current, 0.35), 0.1, 1);
  }
}

function clearProviderRuntimeLocks(snapshot: SmsProviderHealthSnapshot): SmsProviderHealthSnapshot {
  return {
    ...snapshot,
    cooldownUntil: undefined,
    temporarilyDisabledUntil: undefined,
    temporarilyDisabledReason: undefined,
  };
}

function sortProviderSnapshots(left: SmsProviderHealthSnapshot, right: SmsProviderHealthSnapshot): number {
  return left.providerKey.localeCompare(right.providerKey);
}

function sortRouteSnapshots(left: SmsProviderRouteHealthSnapshot, right: SmsProviderRouteHealthSnapshot): number {
  if (left.providerKey !== right.providerKey) {
    return left.providerKey.localeCompare(right.providerKey);
  }

  if (left.routeKind !== right.routeKind) {
    return left.routeKind.localeCompare(right.routeKind);
  }

  if (left.scopeKind !== right.scopeKind) {
    return left.scopeKind.localeCompare(right.scopeKind);
  }

  return left.scopeValue.localeCompare(right.scopeValue);
}

function sortSelectionCandidates(left: SmsProviderSelectionCandidate, right: SmsProviderSelectionCandidate): number {
  if (left.available !== right.available) {
    return left.available ? -1 : 1;
  }

  if (left.effectiveScore !== right.effectiveScore) {
    return right.effectiveScore - left.effectiveScore;
  }

  if (left.healthScore !== right.healthScore) {
    return right.healthScore - left.healthScore;
  }

  return left.providerKey.localeCompare(right.providerKey);
}

function deriveErrorClassPenalty(errorClass: string | undefined): number {
  switch (errorClass) {
    case "application:challenge":
      return 25;
    case "route:network":
      return 12;
    case "route:generic":
      return 8;
    default:
      return 0;
  }
}

function deriveStatusPenalty(
  status: SmsProviderOperationalStatus,
  healthState: SmsProviderHealthState,
): number {
  if (status === "temporarily_disabled" || status === "cooling") {
    return 100;
  }

  if (status === "degraded") {
    return 18;
  }

  if (healthState === "challenge") {
    return 22;
  }

  if (healthState === "blocked") {
    return 16;
  }

  return 0;
}

export function classifySmsProviderRouteFailure(error: unknown): SmsProviderRouteFailureDecision {
  const message = normalizeText(error instanceof Error ? error.message : String(error)).toLowerCase();

  const challengeMarkers = [
    "cloudflare",
    "just a moment",
    "captcha",
    "turnstile",
    "verification",
    "required to register or log in",
    "access denied",
    "managed challenge",
  ];
  if (challengeMarkers.some((marker) => message.includes(marker))) {
    return {
      healthState: "challenge",
      errorClass: "application:challenge",
      errorCode: "challenge",
      penalty: 65,
      cooldownBaseMs: 20 * 60 * 1000,
      cooldownEscalatedMs: 90 * 60 * 1000,
      escalateAfterCount: 2,
    };
  }

  const blockedMarkers = [
    "tls",
    "err_connection_closed",
    "connection closed",
    "fetch failed",
    "econn",
    "socket hang up",
    "network error",
    "timeout",
    "failed to fetch response with curl",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
  ];
  if (blockedMarkers.some((marker) => message.includes(marker))) {
    return {
      healthState: "blocked",
      errorClass: "route:network",
      errorCode: "network",
      penalty: 30,
      cooldownBaseMs: 5 * 60 * 1000,
      cooldownEscalatedMs: 30 * 60 * 1000,
      escalateAfterCount: 3,
    };
  }

  return {
    healthState: "degraded",
    errorClass: "route:generic",
    errorCode: "generic",
    penalty: 18,
    cooldownBaseMs: 10 * 60 * 1000,
    cooldownEscalatedMs: 45 * 60 * 1000,
    escalateAfterCount: 3,
  };
}

export class EasySmsProviderOperationalState {
  private readonly descriptorByKey = new Map<SmsProviderKey, ProviderDescriptor>();
  private readonly providerStates = new Map<SmsProviderKey, SmsProviderHealthSnapshot>();
  private readonly routeStates = new Map<string, SmsProviderRouteHealthSnapshot>();
  private readonly probeHistoryByProvider = new Map<SmsProviderKey, SmsProviderProbeHistoryEntry[]>();
  private readonly options: EasySmsProviderOperationalStateOptions;

  public constructor(
    descriptors: ProviderDescriptor[],
    options: Partial<EasySmsProviderOperationalStateOptions> = {},
  ) {
    this.options = {
      probeHistoryMaxEntries: Math.max(1, options.probeHistoryMaxEntries ?? 24),
      probeHistoryWindowMs: Math.max(60_000, options.probeHistoryWindowMs ?? 86_400_000),
    };

    for (const descriptor of descriptors) {
      this.descriptorByKey.set(descriptor.key, descriptor);
      this.providerStates.set(descriptor.key, defaultProviderHealthSnapshot(descriptor));
    }
  }

  public hydrate(snapshot: EasySmsRuntimeStateSnapshot | undefined, now: Date = new Date()): void {
    if (!snapshot) {
      return;
    }

    for (const providerSnapshot of snapshot.providers) {
      const descriptor = this.descriptorByKey.get(providerSnapshot.providerKey);
      if (!descriptor) {
        continue;
      }

      this.providerStates.set(providerSnapshot.providerKey, {
        ...defaultProviderHealthSnapshot(descriptor),
        ...providerSnapshot,
        providerDisplayName: descriptor.displayName,
      });
    }

    for (const routeSnapshot of snapshot.routes) {
      if (this.descriptorByKey.has(routeSnapshot.providerKey)) {
        this.routeStates.set(routeSnapshot.routeKey, { ...routeSnapshot });
      }
    }

    for (const entry of snapshot.probeHistory ?? []) {
      if (!this.descriptorByKey.has(entry.providerKey)) {
        continue;
      }

      const current = this.probeHistoryByProvider.get(entry.providerKey) ?? [];
      current.push({ ...entry });
      this.probeHistoryByProvider.set(entry.providerKey, current);
    }

    this.refresh(now);
  }

  public snapshot(now: Date = new Date()): EasySmsRuntimeStateSnapshot {
    this.refresh(now);
    return {
      providers: this.listProviderHealth(now),
      routes: this.listRouteHealth(undefined, now),
      probeHistory: this.listProbeHistory(undefined, now),
      updatedAt: now.toISOString(),
    };
  }

  public listProviderHealth(now: Date = new Date()): SmsProviderHealthSnapshot[] {
    this.refresh(now);
    return Array.from(this.providerStates.values())
      .map((snapshot) => ({ ...snapshot }))
      .sort(sortProviderSnapshots);
  }

  public listRouteHealth(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderRouteHealthSnapshot[] {
    this.refresh(now);
    return Array.from(this.routeStates.values())
      .filter((route) => (providerKey ? route.providerKey === providerKey : true))
      .map((route) => ({ ...route }))
      .sort(sortRouteSnapshots);
  }

  public summarize(now: Date = new Date()): SmsProviderHealthSummary {
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

  public listProbeHistory(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderProbeHistoryEntry[] {
    this.refresh(now);
    const output: SmsProviderProbeHistoryEntry[] = [];

    for (const [key, entries] of this.probeHistoryByProvider.entries()) {
      if (providerKey && key !== providerKey) {
        continue;
      }

      output.push(...entries.map((entry) => ({ ...entry })));
    }

    return output.sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
  }

  public listProbeTrends(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderProbeTrendSnapshot[] {
    this.refresh(now);
    const keys = providerKey ? [providerKey] : Array.from(this.providerStates.keys());

    return keys
      .map((key) => this.buildProbeTrendSnapshot(key, now))
      .filter((item): item is SmsProviderProbeTrendSnapshot => item !== undefined)
      .sort((left, right) => left.providerKey.localeCompare(right.providerKey));
  }

  public recordProbeResult(result: SmsProviderHealthProbeResult): SmsProviderProbeHistoryEntry {
    const snapshot = this.ensureProviderState(result.providerKey);
    const nextEntry: SmsProviderProbeHistoryEntry = {
      providerKey: result.providerKey,
      providerDisplayName: result.providerDisplayName,
      checkedAt: result.checkedAt,
      routeKind: result.routeKind,
      ok: result.ok,
      healthState: result.healthState,
      status: result.status,
      errorClass: snapshot.lastErrorClass,
      detail: result.detail,
      publicNumberCount: result.publicNumberCount,
      inboxMessageCount: result.inboxMessageCount,
    };

    const current = this.probeHistoryByProvider.get(result.providerKey) ?? [];
    current.push(nextEntry);
    current.sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
    this.probeHistoryByProvider.set(
      result.providerKey,
      current.slice(0, this.options.probeHistoryMaxEntries),
    );
    this.refresh(new Date(result.checkedAt));
    return { ...nextEntry };
  }

  public getAvailabilityIssue(
    context: SmsProviderRouteContext,
    now: Date = new Date(),
  ): SmsProviderAvailabilityIssue | undefined {
    this.refresh(now);
    const provider = this.ensureProviderState(context.providerKey);

    if (provider.status === "temporarily_disabled") {
      return {
        providerKey: context.providerKey,
        reason: `${provider.providerDisplayName} is temporarily disabled${formatUntil(provider.temporarilyDisabledUntil)}.`,
        status: provider.status,
        until: provider.temporarilyDisabledUntil,
      };
    }

    const exactRoute = this.routeStates.get(buildRouteKey(context));
    if (exactRoute?.cooldownUntil && parseTimestampMs(exactRoute.cooldownUntil)! > now.getTime()) {
      return {
        providerKey: context.providerKey,
        reason: `${provider.providerDisplayName} route ${context.routeKind}:${context.scopeValue} is cooling${formatUntil(exactRoute.cooldownUntil)}.`,
        status: "cooling",
        routeKey: exactRoute.routeKey,
        until: exactRoute.cooldownUntil,
      };
    }

    const providerRoute = this.routeStates.get(buildRouteKey({
      ...context,
      scopeKind: "provider",
      scopeValue: "global",
    }));
    if (providerRoute?.cooldownUntil && parseTimestampMs(providerRoute.cooldownUntil)! > now.getTime()) {
      return {
        providerKey: context.providerKey,
        reason: `${provider.providerDisplayName} route ${context.routeKind} is cooling${formatUntil(providerRoute.cooldownUntil)}.`,
        status: "cooling",
        routeKey: providerRoute.routeKey,
        until: providerRoute.cooldownUntil,
      };
    }

    return undefined;
  }

  public getSelectionCandidate(
    context: SmsProviderRouteContext,
    now: Date = new Date(),
  ): SmsProviderSelectionCandidate {
    this.refresh(now);
    const provider = this.ensureProviderState(context.providerKey);
    const availabilityIssue = this.getAvailabilityIssue(context, now);
    const exactRoute = this.routeStates.get(buildRouteKey(context));
    const providerRoute = this.routeStates.get(buildRouteKey({
      ...context,
      scopeKind: "provider",
      scopeValue: "global",
    }));
    const exactRoutePenalty = exactRoute?.penalty ?? 0;
    const providerRoutePenalty = providerRoute?.penalty ?? 0;
    const errorClassPenalty = Math.max(
      deriveErrorClassPenalty(exactRoute?.lastErrorClass),
      deriveErrorClassPenalty(providerRoute?.lastErrorClass),
    );
    const emptyPenalty = provider.healthState === "empty" && context.routeKind === "list-public-numbers" ? 18 : 0;
    const statusPenalty = deriveStatusPenalty(provider.status, provider.healthState);
    const trend = this.buildProbeTrendSnapshot(context.providerKey, now);
    const trendPenalty = trend?.trendPenalty ?? 0;
    const trendScore = trend?.trendScore ?? 100;
    const effectiveScore = Math.round(provider.healthScore * 100)
      - exactRoutePenalty
      - providerRoutePenalty
      - errorClassPenalty
      - emptyPenalty
      - statusPenalty
      - trendPenalty
      - provider.consecutiveFailures * 2;
    const notes: string[] = [];

    if (availabilityIssue) {
      notes.push(availabilityIssue.reason);
    }
    if (exactRoutePenalty > 0) {
      notes.push(`exact route penalty=${exactRoutePenalty}`);
    }
    if (providerRoutePenalty > 0) {
      notes.push(`provider route penalty=${providerRoutePenalty}`);
    }
    if (errorClassPenalty > 0) {
      notes.push(`error class penalty=${errorClassPenalty}`);
    }
    if (emptyPenalty > 0) {
      notes.push("recent empty directory response");
    }
    if (trendPenalty > 0) {
      notes.push(`probe trend penalty=${trendPenalty}`);
    }

    return {
      providerKey: provider.providerKey,
      providerDisplayName: provider.providerDisplayName,
      routeKind: context.routeKind,
      scopeKind: context.scopeKind,
      scopeValue: context.scopeValue,
      providerStatus: provider.status,
      healthState: provider.healthState,
      healthScore: provider.healthScore,
      available: availabilityIssue === undefined,
      availabilityIssue: availabilityIssue?.reason,
      exactRoutePenalty,
      providerRoutePenalty,
      errorClassPenalty,
      emptyPenalty,
      statusPenalty,
      trendPenalty,
      trendScore,
      effectiveScore,
      fallbackRank: 0,
      notes,
    };
  }

  public rankSelectionCandidates(candidates: SmsProviderSelectionCandidate[]): SmsProviderSelectionCandidate[] {
    const sorted = [...candidates].sort(sortSelectionCandidates);
    return sorted.map((candidate, index) => ({
      ...candidate,
      fallbackRank: index + 1,
    }));
  }

  public markTemporaryDisabled(
    providerKey: SmsProviderKey,
    input: {
      reason: string;
      until: Date;
      now?: Date;
    },
  ): SmsProviderHealthSnapshot {
    const now = input.now ?? new Date();
    const current = this.ensureProviderState(providerKey);
    const next: SmsProviderHealthSnapshot = {
      ...current,
      status: "temporarily_disabled",
      temporarilyDisabledReason: input.reason,
      temporarilyDisabledUntil: input.until.toISOString(),
      lastCheckedAt: now.toISOString(),
      lastDetail: input.reason,
    };
    this.providerStates.set(providerKey, next);
    return { ...next };
  }

  public clearTemporaryDisabled(providerKey: SmsProviderKey, now: Date = new Date()): SmsProviderHealthSnapshot {
    const current = this.ensureProviderState(providerKey);
    const unlocked = clearProviderRuntimeLocks({
      ...current,
      lastCheckedAt: now.toISOString(),
    });
    const next = {
      ...unlocked,
      status: this.deriveProviderStatus(providerKey, unlocked, now),
    };
    this.providerStates.set(providerKey, next);
    return { ...next };
  }

  public resetProvider(
    providerKey?: SmsProviderKey,
    now: Date = new Date(),
  ): {
    providers: SmsProviderHealthSnapshot[];
    clearedRoutes: SmsProviderRouteHealthSnapshot[];
  } {
    const clearedRoutes: SmsProviderRouteHealthSnapshot[] = [];
    const changedProviders: SmsProviderHealthSnapshot[] = [];
    const keys = providerKey ? [providerKey] : Array.from(this.providerStates.keys());

    for (const key of keys) {
      const descriptor = this.descriptorByKey.get(key);
      if (!descriptor) {
        continue;
      }

      for (const route of Array.from(this.routeStates.values()).filter((item) => item.providerKey === key)) {
        this.routeStates.delete(route.routeKey);
        clearedRoutes.push({ ...route });
      }

      const next: SmsProviderHealthSnapshot = {
        ...defaultProviderHealthSnapshot(descriptor),
        lastCheckedAt: now.toISOString(),
        providerDisplayName: descriptor.displayName,
      };
      this.providerStates.set(key, next);
      changedProviders.push({ ...next });
    }

    return {
      providers: changedProviders.sort(sortProviderSnapshots),
      clearedRoutes: clearedRoutes.sort(sortRouteSnapshots),
    };
  }

  public recordRouteSuccess(
    context: SmsProviderRouteContext,
    input: {
      detail: string;
      itemCount?: number;
      isEmpty?: boolean;
      now?: Date;
    },
  ): SmsProviderRouteHealthSnapshot {
    const now = input.now ?? new Date();
    const provider = this.ensureProviderState(context.providerKey);
    const routeKey = buildRouteKey(context);
    const existingRoute = this.routeStates.get(routeKey);
    const nextRoute: SmsProviderRouteHealthSnapshot = {
      routeKey,
      providerKey: context.providerKey,
      routeKind: context.routeKind,
      scopeKind: context.scopeKind,
      scopeValue: context.scopeValue,
      penalty: 0,
      consecutiveFailures: 0,
      cooldownUntil: undefined,
      lastErrorClass: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      lastReportedAt: now.toISOString(),
    };
    this.routeStates.set(routeKey, nextRoute);

    const nextProvider: SmsProviderHealthSnapshot = {
      ...provider,
      status: this.deriveProviderStatus(context.providerKey, provider, now),
      healthState: input.isEmpty ? "empty" : "healthy",
      healthScore: input.isEmpty
        ? deriveHealthScoreForEmpty(provider.healthScore)
        : deriveHealthScoreForSuccess(provider.healthScore),
      consecutiveFailures: 0,
      activeRouteCoolingCount: this.countActiveRouteCooling(context.providerKey, now),
      lastCheckedAt: now.toISOString(),
      lastSuccessAt: input.isEmpty ? provider.lastSuccessAt : now.toISOString(),
      lastEmptyAt: input.isEmpty ? now.toISOString() : provider.lastEmptyAt,
      lastFailureAt: provider.lastFailureAt,
      lastRouteKind: context.routeKind,
      lastDetail: input.detail,
      lastErrorClass: undefined,
      lastErrorMessage: undefined,
      cooldownUntil: undefined,
    };

    if (existingRoute?.cooldownUntil) {
      nextProvider.lastDetail = `${input.detail} after route recovery`;
    }

    this.providerStates.set(context.providerKey, {
      ...nextProvider,
      status: this.deriveProviderStatus(context.providerKey, nextProvider, now),
      activeRouteCoolingCount: this.countActiveRouteCooling(context.providerKey, now),
    });
    return { ...nextRoute };
  }

  public recordRouteFailure(
    context: SmsProviderRouteContext,
    error: unknown,
    now: Date = new Date(),
  ): SmsProviderRouteReportResult {
    const provider = this.ensureProviderState(context.providerKey);
    const decision = classifySmsProviderRouteFailure(error);
    const routeKey = buildRouteKey(context);
    const existingRoute = this.routeStates.get(routeKey);
    const consecutiveFailures = (existingRoute?.consecutiveFailures ?? 0) + 1;
    const cooldownMs = decision.cooldownEscalatedMs > 0
      && consecutiveFailures >= decision.escalateAfterCount
      ? decision.cooldownEscalatedMs
      : decision.cooldownBaseMs;
    const cooldownUntil = cooldownMs > 0 ? new Date(now.getTime() + cooldownMs).toISOString() : undefined;
    const nextRoute: SmsProviderRouteHealthSnapshot = {
      routeKey,
      providerKey: context.providerKey,
      routeKind: context.routeKind,
      scopeKind: context.scopeKind,
      scopeValue: context.scopeValue,
      penalty: clamp(decision.penalty + Math.max(0, consecutiveFailures - 1) * 5, 0, 95),
      consecutiveFailures,
      cooldownUntil,
      lastErrorClass: decision.errorClass,
      lastErrorCode: decision.errorCode,
      lastErrorMessage: normalizeText(error instanceof Error ? error.message : String(error)),
      lastReportedAt: now.toISOString(),
    };
    this.routeStates.set(routeKey, nextRoute);

    const nextProvider: SmsProviderHealthSnapshot = {
      ...provider,
      healthState: decision.healthState,
      healthScore: deriveHealthScoreForFailure(provider.healthScore, decision.healthState),
      consecutiveFailures: provider.consecutiveFailures + 1,
      lastCheckedAt: now.toISOString(),
      lastFailureAt: now.toISOString(),
      lastRouteKind: context.routeKind,
      lastDetail: nextRoute.lastErrorMessage,
      lastErrorClass: decision.errorClass,
      lastErrorMessage: nextRoute.lastErrorMessage,
      cooldownUntil: context.scopeKind === "provider" ? cooldownUntil : provider.cooldownUntil,
    };
    this.providerStates.set(context.providerKey, {
      ...nextProvider,
      status: this.deriveProviderStatus(context.providerKey, nextProvider, now),
      activeRouteCoolingCount: this.countActiveRouteCooling(context.providerKey, now),
    });

    return {
      provider: { ...this.ensureProviderState(context.providerKey) },
      route: { ...nextRoute },
      cooldownApplied: Boolean(cooldownUntil),
    };
  }

  public refresh(now: Date = new Date()): {
    providers: SmsProviderHealthSnapshot[];
    routes: SmsProviderRouteHealthSnapshot[];
  } {
    const changedProviders: SmsProviderHealthSnapshot[] = [];
    const changedRoutes: SmsProviderRouteHealthSnapshot[] = [];

    for (const [providerKey, entries] of this.probeHistoryByProvider.entries()) {
      const filtered = entries
        .filter((entry) => {
          const checkedAtMs = parseTimestampMs(entry.checkedAt);
          return checkedAtMs !== undefined && checkedAtMs >= now.getTime() - this.options.probeHistoryWindowMs;
        })
        .slice(0, this.options.probeHistoryMaxEntries);
      if (filtered.length === 0) {
        this.probeHistoryByProvider.delete(providerKey);
        continue;
      }

      this.probeHistoryByProvider.set(providerKey, filtered);
    }

    for (const [routeKey, route] of this.routeStates.entries()) {
      const cooldownUntilMs = parseTimestampMs(route.cooldownUntil);
      if (cooldownUntilMs !== undefined && cooldownUntilMs <= now.getTime()) {
        const nextRoute = {
          ...route,
          cooldownUntil: undefined,
        };
        this.routeStates.set(routeKey, nextRoute);
        changedRoutes.push({ ...nextRoute });
      }
    }

    for (const [providerKey, provider] of this.providerStates.entries()) {
      let next = { ...provider };
      let changed = false;
      const disabledUntilMs = parseTimestampMs(next.temporarilyDisabledUntil);
      if (disabledUntilMs !== undefined && disabledUntilMs <= now.getTime()) {
        next = {
          ...next,
          temporarilyDisabledUntil: undefined,
          temporarilyDisabledReason: undefined,
        };
        changed = true;
      }

      next.activeRouteCoolingCount = this.countActiveRouteCooling(providerKey, now);
      const derivedStatus = this.deriveProviderStatus(providerKey, next, now);
      if (derivedStatus !== next.status) {
        next.status = derivedStatus;
        changed = true;
      }

      if (changed) {
        this.providerStates.set(providerKey, next);
        changedProviders.push({ ...next });
      }
    }

    return {
      providers: changedProviders.sort(sortProviderSnapshots),
      routes: changedRoutes.sort(sortRouteSnapshots),
    };
  }

  private ensureProviderState(providerKey: SmsProviderKey): SmsProviderHealthSnapshot {
    const existing = this.providerStates.get(providerKey);
    if (existing) {
      return existing;
    }

    const descriptor = this.descriptorByKey.get(providerKey);
    if (!descriptor) {
      throw new Error(`Unknown provider state: ${providerKey}`);
    }

    const created = defaultProviderHealthSnapshot(descriptor);
    this.providerStates.set(providerKey, created);
    return created;
  }

  private countActiveRouteCooling(providerKey: SmsProviderKey, now: Date): number {
    let count = 0;

    for (const route of this.routeStates.values()) {
      if (route.providerKey !== providerKey) {
        continue;
      }

      const cooldownUntilMs = parseTimestampMs(route.cooldownUntil);
      if (cooldownUntilMs !== undefined && cooldownUntilMs > now.getTime()) {
        count += 1;
      }
    }

    return count;
  }

  private deriveProviderStatus(
    providerKey: SmsProviderKey,
    provider: SmsProviderHealthSnapshot,
    now: Date,
  ): SmsProviderOperationalStatus {
    const disabledUntilMs = parseTimestampMs(provider.temporarilyDisabledUntil);
    if (disabledUntilMs !== undefined && disabledUntilMs > now.getTime()) {
      return "temporarily_disabled";
    }

    const providerCooldownActive = Array.from(this.routeStates.values()).some((route) => {
      if (route.providerKey !== providerKey || route.scopeKind !== "provider") {
        return false;
      }

      const cooldownUntilMs = parseTimestampMs(route.cooldownUntil);
      return cooldownUntilMs !== undefined && cooldownUntilMs > now.getTime();
    });
    if (providerCooldownActive) {
      return "cooling";
    }

    if (provider.healthState === "challenge" || provider.healthState === "blocked" || provider.activeRouteCoolingCount > 0) {
      return "degraded";
    }

    return provider.status === "offline" ? "offline" : "active";
  }

  private buildProbeTrendSnapshot(
    providerKey: SmsProviderKey,
    now: Date,
  ): SmsProviderProbeTrendSnapshot | undefined {
    const descriptor = this.descriptorByKey.get(providerKey);
    if (!descriptor) {
      return undefined;
    }

    const entries = (this.probeHistoryByProvider.get(providerKey) ?? [])
      .filter((entry) => {
        const checkedAtMs = parseTimestampMs(entry.checkedAt);
        return checkedAtMs !== undefined && checkedAtMs >= now.getTime() - this.options.probeHistoryWindowMs;
      })
      .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
    const errorClassCounts: Record<string, number> = {};
    let successCount = 0;
    let emptyCount = 0;
    let challengeCount = 0;
    let blockedCount = 0;
    let degradedCount = 0;
    let totalWeightedPenalty = 0;
    let totalWeight = 0;

    for (const entry of entries) {
      if (entry.ok && entry.healthState === "healthy") {
        successCount += 1;
      }
      if (entry.healthState === "empty") {
        emptyCount += 1;
      }
      if (entry.healthState === "challenge") {
        challengeCount += 1;
      }
      if (entry.healthState === "blocked") {
        blockedCount += 1;
      }
      if (entry.healthState === "degraded") {
        degradedCount += 1;
      }
      if (entry.errorClass) {
        errorClassCounts[entry.errorClass] = (errorClassCounts[entry.errorClass] ?? 0) + 1;
      }

      const checkedAtMs = parseTimestampMs(entry.checkedAt) ?? now.getTime();
      const ageMs = Math.max(0, now.getTime() - checkedAtMs);
      const weight = ageMs <= 60 * 60 * 1000
        ? 3
        : ageMs <= 6 * 60 * 60 * 1000
          ? 2
          : 1;
      const statePenalty = entry.healthState === "challenge"
        ? 24
        : entry.healthState === "blocked"
          ? 18
          : entry.healthState === "degraded"
            ? 12
            : entry.healthState === "empty"
              ? 8
              : 0;
      totalWeightedPenalty += statePenalty * weight;
      totalWeight += weight;
    }

    const averagePenalty = totalWeight > 0 ? Math.round(totalWeightedPenalty / totalWeight) : 0;
    const streakPenalty = Math.max(challengeCount - 1, 0) * 4 + Math.max(blockedCount - 1, 0) * 3;
    const trendPenalty = clamp(averagePenalty + streakPenalty, 0, 45);

    return {
      providerKey,
      providerDisplayName: descriptor.displayName,
      windowStartAt: entries[0]?.checkedAt,
      windowEndAt: now.toISOString(),
      sampleCount: entries.length,
      successCount,
      emptyCount,
      challengeCount,
      blockedCount,
      degradedCount,
      errorClassCounts,
      lastCheckedAt: entries.at(-1)?.checkedAt,
      trendPenalty,
      trendScore: clamp(100 - trendPenalty, 0, 100),
    };
  }
}
