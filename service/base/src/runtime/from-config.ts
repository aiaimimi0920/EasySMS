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
  const onlineSim = asRecord(providers.onlineSim);
  const smsToMe = asRecord(providers.smsToMe);
  const receiveSmss = asRecord(providers.receiveSmss);
  const receiveSmsFreeCc = asRecord(providers.receiveSmsFreeCc);
  const heroSms = asRecord(providers.heroSms);

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
      onlineSim: {
        apiKey: typeof onlineSim.apiKey === "string"
          ? onlineSim.apiKey
          : defaultEasySmsRuntimeConfig.providers.onlineSim.apiKey,
      },
      smsToMe: {
        email: typeof smsToMe.email === "string"
          ? smsToMe.email
          : defaultEasySmsRuntimeConfig.providers.smsToMe.email,
        password: typeof smsToMe.password === "string"
          ? smsToMe.password
          : defaultEasySmsRuntimeConfig.providers.smsToMe.password,
      },
      receiveSmss: {
        username: typeof receiveSmss.username === "string"
          ? receiveSmss.username
          : defaultEasySmsRuntimeConfig.providers.receiveSmss.username,
        password: typeof receiveSmss.password === "string"
          ? receiveSmss.password
          : defaultEasySmsRuntimeConfig.providers.receiveSmss.password,
      },
      receiveSmsFreeCc: {
        email: typeof receiveSmsFreeCc.email === "string"
          ? receiveSmsFreeCc.email
          : defaultEasySmsRuntimeConfig.providers.receiveSmsFreeCc.email,
        password: typeof receiveSmsFreeCc.password === "string"
          ? receiveSmsFreeCc.password
          : defaultEasySmsRuntimeConfig.providers.receiveSmsFreeCc.password,
      },
      heroSms: {
        enabled: asBoolean(
          heroSms.enabled,
          defaultEasySmsRuntimeConfig.providers.heroSms.enabled,
        ),
        apiKey: typeof heroSms.apiKey === "string"
          ? heroSms.apiKey
          : defaultEasySmsRuntimeConfig.providers.heroSms.apiKey,
        baseUrl: asString(
          heroSms.baseUrl,
          defaultEasySmsRuntimeConfig.providers.heroSms.baseUrl,
        ),
        defaultService: asString(
          heroSms.defaultService,
          defaultEasySmsRuntimeConfig.providers.heroSms.defaultService,
        ),
        defaultCountry: asNumber(
          heroSms.defaultCountry,
          defaultEasySmsRuntimeConfig.providers.heroSms.defaultCountry,
        ),
        selectionMode: ((): EasySmsRuntimeConfig["providers"]["heroSms"]["selectionMode"] => {
          const value = asString(
            heroSms.selectionMode,
            defaultEasySmsRuntimeConfig.providers.heroSms.selectionMode,
          );
          return ["price-first", "success-first", "stock-first", "balanced"].includes(value)
            ? value as EasySmsRuntimeConfig["providers"]["heroSms"]["selectionMode"]
            : defaultEasySmsRuntimeConfig.providers.heroSms.selectionMode;
        })(),
        reuseEnabled: asBoolean(
          heroSms.reuseEnabled,
          defaultEasySmsRuntimeConfig.providers.heroSms.reuseEnabled,
        ),
        defaultMaxBindingsPerPhone: asNumber(
          heroSms.defaultMaxBindingsPerPhone,
          defaultEasySmsRuntimeConfig.providers.heroSms.defaultMaxBindingsPerPhone,
        ),
        refundableCancelWindowSeconds: asNumber(
          heroSms.refundableCancelWindowSeconds,
          defaultEasySmsRuntimeConfig.providers.heroSms.refundableCancelWindowSeconds,
        ),
        leaseWindowSeconds: asNumber(
          heroSms.leaseWindowSeconds,
          defaultEasySmsRuntimeConfig.providers.heroSms.leaseWindowSeconds,
        ),
      },
    },
  };
}
