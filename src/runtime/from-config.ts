import { defaultEasySmsRuntimeConfig } from "../defaults/index.js";
import type { EasySmsRuntimeConfig } from "../domain/models.js";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function mergeEasySmsConfig(input: unknown): EasySmsRuntimeConfig {
  const root = asRecord(input);
  const server = asRecord(root.server);
  const strategy = asRecord(root.strategy);
  const maintenance = asRecord(root.maintenance);
  const persistence = asRecord(root.persistence);
  const scraping = asRecord(root.scraping);
  const providers = asRecord(root.providers);

  return {
    server: {
      host: asString(server.host, defaultEasySmsRuntimeConfig.server.host),
      port: asNumber(server.port, defaultEasySmsRuntimeConfig.server.port),
      apiKey: typeof server.apiKey === "string" ? server.apiKey : defaultEasySmsRuntimeConfig.server.apiKey,
    },
    strategy: {
      strictProviderMode: asBoolean(
        strategy.strictProviderMode,
        defaultEasySmsRuntimeConfig.strategy.strictProviderMode,
      ),
      providerStrategyModeId: asString(
        strategy.providerStrategyModeId,
        defaultEasySmsRuntimeConfig.strategy.providerStrategyModeId,
      ),
    },
    maintenance: {
      enabled: asBoolean(maintenance.enabled, defaultEasySmsRuntimeConfig.maintenance.enabled),
      intervalMs: asNumber(maintenance.intervalMs, defaultEasySmsRuntimeConfig.maintenance.intervalMs),
      keepRecentCount: asNumber(
        maintenance.keepRecentCount,
        defaultEasySmsRuntimeConfig.maintenance.keepRecentCount,
      ),
      activeProbeEnabled: asBoolean(
        maintenance.activeProbeEnabled,
        defaultEasySmsRuntimeConfig.maintenance.activeProbeEnabled,
      ),
      activeProbeIntervalMs: asNumber(
        maintenance.activeProbeIntervalMs,
        defaultEasySmsRuntimeConfig.maintenance.activeProbeIntervalMs,
      ),
      probeHistoryMaxEntries: asNumber(
        maintenance.probeHistoryMaxEntries,
        defaultEasySmsRuntimeConfig.maintenance.probeHistoryMaxEntries,
      ),
      probeHistoryWindowMs: asNumber(
        maintenance.probeHistoryWindowMs,
        defaultEasySmsRuntimeConfig.maintenance.probeHistoryWindowMs,
      ),
    },
    persistence: {
      enabled: asBoolean(persistence.enabled, defaultEasySmsRuntimeConfig.persistence.enabled),
      driver: asString(persistence.driver, defaultEasySmsRuntimeConfig.persistence.driver),
      intervalMs: asNumber(persistence.intervalMs, defaultEasySmsRuntimeConfig.persistence.intervalMs),
      filePath: asString(persistence.filePath, defaultEasySmsRuntimeConfig.persistence.filePath),
    },
    scraping: {
      requestTimeoutMs: asNumber(
        scraping.requestTimeoutMs,
        defaultEasySmsRuntimeConfig.scraping.requestTimeoutMs,
      ),
      maxNumbersPerProvider: asNumber(
        scraping.maxNumbersPerProvider,
        defaultEasySmsRuntimeConfig.scraping.maxNumbersPerProvider,
      ),
      userAgent: asString(scraping.userAgent, defaultEasySmsRuntimeConfig.scraping.userAgent),
    },
    providers: {
      enabledProviders: asStringArray(
        providers.enabledProviders,
        defaultEasySmsRuntimeConfig.providers.enabledProviders,
      ),
    },
  };
}
