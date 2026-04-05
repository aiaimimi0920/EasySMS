import {
  ProviderFetchError,
  ProviderNotFoundError,
  ProviderRouteUnavailableError,
} from "../domain/errors.js";
import type {
  EasySmsRuntimeStateSnapshot,
  EasySmsRuntimeConfig,
  GetInboxOptions,
  ListPublicNumbersOptions,
  ListPublicNumbersResult,
  ProviderDescriptor,
  SmsProviderHealthProbeResult,
  SmsProviderHealthSnapshot,
  SmsProviderHealthSummary,
  SmsProviderKey,
  SmsProviderProbeHistoryEntry,
  SmsProviderProbeTrendSnapshot,
  SmsProviderSelectionCandidate,
  SmsProviderRouteHealthSnapshot,
  SmsProviderRouteKind,
  SmsInboxSnapshot,
  SmsNumberReference,
} from "../domain/models.js";
import type { SmsProvider } from "../providers/contracts.js";
import { FreePhoneNumProvider } from "../providers/freephonenum/index.js";
import { JiemahaoProvider } from "../providers/jiemahao/index.js";
import { OnlineSimProvider } from "../providers/onlinesim/index.js";
import { QuackrProvider } from "../providers/quackr/index.js";
import { ReceiveSmsCoProvider } from "../providers/receivesms_co/index.js";
import { ReceiveSmssProvider } from "../providers/receive_smss/index.js";
import { createReceiveSmsFreeCcProvider } from "../providers/receive_sms_free_cc/index.js";
import { Sms24Provider } from "../providers/sms24/index.js";
import { TempNumberProvider } from "../providers/temp_number/index.js";
import { createTemporaryPhoneNumberProvider } from "../providers/temporary_phone_number/index.js";
import { YunDuanXinProvider } from "../providers/yunduanxin/index.js";
import { decodeNumberId } from "../shared/index.js";
import {
  type SmsProviderRouteContext,
  EasySmsProviderOperationalState,
} from "./provider-operational-state.js";

export class EasySmsService {
  readonly config: EasySmsRuntimeConfig;
  readonly providers: Map<string, SmsProvider>;
  readonly operationalState: EasySmsProviderOperationalState;

  constructor(config: EasySmsRuntimeConfig, providers: SmsProvider[]) {
    this.config = config;
    this.providers = new Map(providers.map((provider) => [provider.descriptor.key, provider]));
    this.operationalState = new EasySmsProviderOperationalState(this.listProviders());
  }

  listProviders(): ProviderDescriptor[] {
    return Array.from(this.providers.values(), (provider) => provider.descriptor);
  }

  listProviderHealth(now: Date = new Date()): SmsProviderHealthSnapshot[] {
    return this.operationalState.listProviderHealth(now);
  }

  listRouteHealth(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderRouteHealthSnapshot[] {
    return this.operationalState.listRouteHealth(providerKey, now);
  }

  listProbeHistory(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderProbeHistoryEntry[] {
    return this.operationalState.listProbeHistory(providerKey, now);
  }

  listProbeTrends(providerKey?: SmsProviderKey, now: Date = new Date()): SmsProviderProbeTrendSnapshot[] {
    return this.operationalState.listProbeTrends(providerKey, now);
  }

  getListSelectionPlan(
    options: Pick<ListPublicNumbersOptions, "countryCode" | "countryName" | "providerKey"> = {},
    now: Date = new Date(),
  ): SmsProviderSelectionCandidate[] {
    if (options.providerKey) {
      const provider = this.providers.get(options.providerKey);
      if (!provider) {
        throw new ProviderNotFoundError(options.providerKey);
      }

      return this.operationalState.rankSelectionCandidates([
        this.operationalState.getSelectionCandidate(this.buildListRouteContext(provider, options), now),
      ]);
    }

    return this.operationalState.rankSelectionCandidates(
      Array.from(this.providers.values(), (provider) =>
        this.operationalState.getSelectionCandidate(this.buildListRouteContext(provider, options), now)
      ),
    );
  }

  getHealthSummary(now: Date = new Date()): SmsProviderHealthSummary {
    return this.operationalState.summarize(now);
  }

  getRuntimeStateSnapshot(now: Date = new Date()): EasySmsRuntimeStateSnapshot {
    return this.operationalState.snapshot(now);
  }

  hydrateRuntimeState(snapshot: EasySmsRuntimeStateSnapshot | undefined, now: Date = new Date()): void {
    this.operationalState.hydrate(snapshot, now);
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
            return {
              items: items.slice(0, limit),
              errors,
            };
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

    return {
      items: items.slice(0, limit),
      errors,
    };
  }

  async getInbox(options: GetInboxOptions): Promise<SmsInboxSnapshot> {
    const provider = this.providers.get(options.providerKey);
    if (!provider) {
      throw new ProviderNotFoundError(options.providerKey);
    }

    const reference = decodeNumberId(options.numberId);
    const context = this.buildInboxRouteContext(provider, reference);
    const availabilityIssue = this.operationalState.getAvailabilityIssue(context);
    if (availabilityIssue) {
      throw new ProviderRouteUnavailableError(options.providerKey, availabilityIssue.reason);
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

  async probeProvider(providerKey: SmsProviderKey, now: Date = new Date()): Promise<SmsProviderHealthProbeResult> {
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
    const results: SmsProviderHealthProbeResult[] = [];

    for (const provider of this.providers.values()) {
      results.push(await this.probeProvider(provider.descriptor.key, now));
    }

    return results;
  }

  refreshOperationalState(now: Date = new Date()) {
    return this.operationalState.refresh(now);
  }

  resetOperationalState(providerKey?: SmsProviderKey, now: Date = new Date()) {
    return this.operationalState.resetProvider(providerKey, now);
  }

  disableProviderTemporarily(
    providerKey: SmsProviderKey,
    input: { until: Date; reason: string; now?: Date },
  ): SmsProviderHealthSnapshot {
    this.ensureProviderKeyExists(providerKey);
    return this.operationalState.markTemporaryDisabled(providerKey, input);
  }

  enableProvider(providerKey: SmsProviderKey, now: Date = new Date()): SmsProviderHealthSnapshot {
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
    options: Pick<ListPublicNumbersOptions, "providerKey" | "countryCode" | "countryName">,
    now: Date = new Date(),
  ): Array<{ provider: SmsProvider; candidate: SmsProviderSelectionCandidate }> {
    if (options.providerKey) {
      const provider = this.providers.get(options.providerKey);
      if (!provider) {
        throw new ProviderNotFoundError(options.providerKey);
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

  private ensureProviderKeyExists(providerKey: SmsProviderKey): void {
    if (!this.providers.has(providerKey)) {
      throw new ProviderNotFoundError(providerKey);
    }
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
    providerKey: SmsProviderKey,
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

export function createEasySmsService(config: EasySmsRuntimeConfig): EasySmsService {
  const enabledProviders = new Set(config.providers.enabledProviders);
  const providers: SmsProvider[] = [
    new FreePhoneNumProvider(config),
    new JiemahaoProvider(config),
    new OnlineSimProvider(config),
    new QuackrProvider(config),
    new ReceiveSmsCoProvider(config),
    new ReceiveSmssProvider(config),
    new TempNumberProvider(config),
    createTemporaryPhoneNumberProvider(config),
    createReceiveSmsFreeCcProvider(config),
    new YunDuanXinProvider(config),
    new Sms24Provider(config),
  ].filter((provider) => provider.descriptor.enabled);

  return new EasySmsService(
    config,
    providers.filter((provider) => enabledProviders.has(provider.descriptor.key)),
  );
}
