import type { EasySmsRuntimeConfig } from "../domain/models.js";
import {
  dispatchEasySmsWebRequest,
  isMutatingEasySmsRoute,
  type EasySmsReleaseMetadata,
} from "../http/web-router.js";
import {
  loadEasySmsRuntimeStateFromD1,
  peekEasySmsRuntimeStateRevisionFromD1,
  saveEasySmsRuntimeStateToD1,
  type D1DatabaseLike,
} from "../persistence/d1-store.js";
import { mergeEasySmsConfig } from "../runtime/from-config.js";
import { createEasySmsService, type EasySmsService } from "../service/easy-sms-service.js";

export interface R2BucketLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: string | Uint8Array | ArrayBuffer): Promise<unknown>;
}

export interface EasySmsWorkerEnv {
  STATE_DB?: D1DatabaseLike;
  BACKUP_STORE?: R2BucketLike;
  EASYSMS_API_KEY?: string;
  EASYSMS_CONFIG_JSON?: string;
  EASYSMS_HEROSMS_API_KEY?: string;
  EASYSMS_ONLINESIM_API_KEY?: string;
  EASYSMS_SMSTOME_EMAIL?: string;
  EASYSMS_SMSTOME_PASSWORD?: string;
  EASYSMS_RECEIVESMSS_USERNAME?: string;
  EASYSMS_RECEIVESMSS_PASSWORD?: string;
  EASYSMS_RECEIVESMSFREECC_EMAIL?: string;
  EASYSMS_RECEIVESMSFREECC_PASSWORD?: string;
  SBA_APPLICATION_ID?: string;
  SBA_RELEASE_VERSION?: string;
  SBA_RELEASE_SHA?: string;
  SBA_ENVIRONMENT?: string;
  SBA_PURPOSE?: string;
  EASYSMS_PREVIEW_ISOLATED?: string;
}

export interface EasySmsWorkerExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
}

const DISABLED_SECRET_SENTINELS = new Set(["", "disabled", "none", "null", "verification-not-applicable"]);

function normalizeOptionalSecret(raw: string | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || DISABLED_SECRET_SENTINELS.has(trimmed.toLowerCase())) {
    return "";
  }
  return trimmed;
}

export function buildWorkerRuntimeConfig(env: EasySmsWorkerEnv): {
  config: EasySmsRuntimeConfig;
  releaseMetadata?: EasySmsReleaseMetadata;
  previewIsolated: boolean;
} {
  let publicConfig: Record<string, unknown> = {};
  if (env.EASYSMS_CONFIG_JSON?.trim()) {
    const parsed = JSON.parse(env.EASYSMS_CONFIG_JSON);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      publicConfig = parsed as Record<string, unknown>;
    }
  }

  const serviceSettings = (publicConfig.service && typeof publicConfig.service === "object" && !Array.isArray(publicConfig.service))
    ? publicConfig.service as Record<string, unknown>
    : {};
  const runtimeOptions = (publicConfig.runtimeOptions && typeof publicConfig.runtimeOptions === "object" && !Array.isArray(publicConfig.runtimeOptions))
    ? publicConfig.runtimeOptions as Record<string, unknown>
    : {};

  const purposeRaw = String(env.SBA_PURPOSE ?? "production").trim();
  const purpose: "production" | "preview" | "local" = purposeRaw === "preview"
    ? "preview"
    : purposeRaw === "local"
      ? "local"
      : "production";
  const previewIsolated = purpose === "preview" || env.EASYSMS_PREVIEW_ISOLATED === "1";

  const apiKey = normalizeOptionalSecret(env.EASYSMS_API_KEY);
  const heroSmsApiKey = previewIsolated ? "" : normalizeOptionalSecret(env.EASYSMS_HEROSMS_API_KEY);
  const onlineSimApiKey = normalizeOptionalSecret(env.EASYSMS_ONLINESIM_API_KEY);
  const smsToMeEmail = normalizeOptionalSecret(env.EASYSMS_SMSTOME_EMAIL);
  const smsToMePassword = normalizeOptionalSecret(env.EASYSMS_SMSTOME_PASSWORD);
  const receiveSmssUsername = normalizeOptionalSecret(env.EASYSMS_RECEIVESMSS_USERNAME);
  const receiveSmssPassword = normalizeOptionalSecret(env.EASYSMS_RECEIVESMSS_PASSWORD);
  const receiveSmsFreeCcEmail = normalizeOptionalSecret(env.EASYSMS_RECEIVESMSFREECC_EMAIL);
  const receiveSmsFreeCcPassword = normalizeOptionalSecret(env.EASYSMS_RECEIVESMSFREECC_PASSWORD);

  const heroSmsEnabledConfig = typeof serviceSettings.heroSmsEnabled === "boolean"
    ? serviceSettings.heroSmsEnabled
    : Boolean(heroSmsApiKey);

  const mergedInput: Record<string, unknown> = {
    ...runtimeOptions,
    server: {
      ...((runtimeOptions.server && typeof runtimeOptions.server === "object") ? runtimeOptions.server as Record<string, unknown> : {}),
      apiKey: apiKey || undefined,
    },
    strategy: {
      strictProviderMode: typeof serviceSettings.strictProviderMode === "boolean"
        ? serviceSettings.strictProviderMode
        : undefined,
      providerStrategyModeId: typeof serviceSettings.strategyModeId === "string"
        ? serviceSettings.strategyModeId
        : undefined,
      ...((runtimeOptions.strategy && typeof runtimeOptions.strategy === "object") ? runtimeOptions.strategy as Record<string, unknown> : {}),
    },
    maintenance: {
      enabled: true,
      activeProbeEnabled: !previewIsolated,
      keepRecentCount: typeof serviceSettings.keepRecentCount === "number"
        ? serviceSettings.keepRecentCount
        : undefined,
      ...((runtimeOptions.maintenance && typeof runtimeOptions.maintenance === "object") ? runtimeOptions.maintenance as Record<string, unknown> : {}),
    },
    persistence: {
      enabled: Boolean(env.STATE_DB),
      driver: env.STATE_DB ? "cloudflare-d1" : "memory",
      intervalMs: 60_000,
      filePath: env.STATE_DB ? "d1://STATE_DB/easysms_runtime_state" : "memory://ephemeral",
    },
    providers: {
      enabledProviders: Array.isArray(serviceSettings.enabledProviders)
        ? serviceSettings.enabledProviders
        : undefined,
      ...((runtimeOptions.providers && typeof runtimeOptions.providers === "object") ? runtimeOptions.providers as Record<string, unknown> : {}),
      onlineSim: { apiKey: onlineSimApiKey },
      smsToMe: { email: smsToMeEmail, password: smsToMePassword },
      receiveSmss: { username: receiveSmssUsername, password: receiveSmssPassword },
      receiveSmsFreeCc: { email: receiveSmsFreeCcEmail, password: receiveSmsFreeCcPassword },
      heroSms: {
        ...(((runtimeOptions.providers as Record<string, unknown> | undefined)?.heroSms && typeof (runtimeOptions.providers as Record<string, unknown>).heroSms === "object")
          ? (runtimeOptions.providers as Record<string, unknown>).heroSms as Record<string, unknown>
          : {}),
        enabled: !previewIsolated && heroSmsEnabledConfig && Boolean(heroSmsApiKey),
        apiKey: heroSmsApiKey,
        defaultService: typeof serviceSettings.heroSmsDefaultService === "string"
          ? serviceSettings.heroSmsDefaultService
          : undefined,
        defaultCountry: typeof serviceSettings.heroSmsDefaultCountry === "number"
          ? serviceSettings.heroSmsDefaultCountry
          : undefined,
        selectionMode: typeof serviceSettings.heroSmsSelectionMode === "string"
          ? serviceSettings.heroSmsSelectionMode
          : undefined,
      },
    },
  };

  const config = mergeEasySmsConfig(mergedInput);
  const releaseMetadata = env.SBA_RELEASE_VERSION && env.SBA_RELEASE_SHA
    ? {
        applicationId: (env.SBA_APPLICATION_ID || "easysms").trim(),
        applicationVersion: env.SBA_RELEASE_VERSION.trim(),
        sourceSha: env.SBA_RELEASE_SHA.trim(),
        environment: (env.SBA_ENVIRONMENT || "production").trim(),
        purpose,
      } satisfies EasySmsReleaseMetadata
    : undefined;

  return { config, releaseMetadata, previewIsolated };
}

interface IsolateServiceCacheEntry {
  configFingerprint: string;
  service: EasySmsService;
  lastHydratedRevision: number;
  lastHydratedAtMs: number;
  lastMaintenanceAtMs: number;
}

export function createEasySmsWorker() {
  let cached: IsolateServiceCacheEntry | undefined;
  let serializeChain: Promise<void> = Promise.resolve();

  const withSerializedMutation = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = serializeChain;
    let release!: () => void;
    serializeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const resolveService = async (
    env: EasySmsWorkerEnv,
    forceReloadFromD1: boolean,
  ): Promise<{
    service: EasySmsService;
    config: EasySmsRuntimeConfig;
    releaseMetadata?: EasySmsReleaseMetadata;
    previewIsolated: boolean;
  }> => {
    const { config, releaseMetadata, previewIsolated } = buildWorkerRuntimeConfig(env);
    const configFingerprint = JSON.stringify({
      config,
      releaseMetadata,
      previewIsolated,
      hasDb: Boolean(env.STATE_DB),
    });

    if (!cached || cached.configFingerprint !== configFingerprint) {
      cached = {
        configFingerprint,
        service: createEasySmsService(config),
        lastHydratedRevision: 0,
        lastHydratedAtMs: 0,
        lastMaintenanceAtMs: 0,
      };
      forceReloadFromD1 = true;
    }

    const nowMs = Date.now();
    if (env.STATE_DB && (forceReloadFromD1 || nowMs - cached.lastHydratedAtMs > 5_000)) {
      try {
        let shouldReadSnapshot = forceReloadFromD1 || cached.lastHydratedRevision === 0;
        if (!shouldReadSnapshot) {
          const remoteRevision = await peekEasySmsRuntimeStateRevisionFromD1(env.STATE_DB);
          shouldReadSnapshot = remoteRevision !== cached.lastHydratedRevision;
        }
        if (shouldReadSnapshot) {
          const stored = await loadEasySmsRuntimeStateFromD1(env.STATE_DB);
          if (stored && stored.revision !== cached.lastHydratedRevision) {
            cached.service.hydrateRuntimeState(stored.snapshot);
            cached.lastHydratedRevision = stored.revision;
          } else if (!stored && cached.lastHydratedRevision === 0) {
            cached.service.hydrateRuntimeState(undefined);
          }
          cached.service.recordRuntimeStateLoad({
            status: stored ? "loaded" : "empty",
            detail: stored
              ? `Loaded runtime state revision ${stored.revision} from Cloudflare D1.`
              : "No persisted runtime state row found in Cloudflare D1 yet.",
          });
        }
        cached.lastHydratedAtMs = nowMs;
      } catch (error) {
        cached.service.recordRuntimeStateLoad({
          status: "failed",
          detail: "Failed to load runtime state from Cloudflare D1.",
          error,
        });
        throw error;
      }
    } else if (!env.STATE_DB && cached.lastHydratedAtMs === 0) {
      cached.lastHydratedAtMs = nowMs;
      cached.service.recordRuntimeStateLoad({
        status: "skipped",
        detail: "Cloudflare D1 binding STATE_DB is not configured.",
      });
    }

    if (nowMs - cached.lastMaintenanceAtMs >= config.maintenance.intervalMs) {
      const maintenanceDate = new Date(nowMs);
      try {
        cached.service.runMaintenance(maintenanceDate);
        cached.service.recordMaintenanceLoopSuccess(maintenanceDate);
        cached.lastMaintenanceAtMs = nowMs;
      } catch (error) {
        cached.service.recordMaintenanceLoopFailure(maintenanceDate, error, "Worker maintenance tick failed.");
      }
    }

    return {
      service: cached.service,
      config,
      releaseMetadata,
      previewIsolated,
    };
  };

  const persistIfConfigured = async (env: EasySmsWorkerEnv, service: EasySmsService): Promise<void> => {
    if (!env.STATE_DB) {
      return;
    }
    const now = new Date();
    try {
      const saved = await saveEasySmsRuntimeStateToD1(env.STATE_DB, service.getRuntimeStateSnapshot());
      if (cached) {
        cached.lastHydratedRevision = saved.revision;
        cached.lastHydratedAtMs = now.getTime();
      }
      service.recordPersistenceLoopSuccess(now, `Runtime state revision ${saved.revision} flushed to D1.`);
    } catch (error) {
      service.recordPersistenceLoopFailure(now, error, "Failed to flush runtime state to D1.");
      throw error;
    }
  };

  return {
    async fetch(
      request: Request,
      env: EasySmsWorkerEnv,
      _ctx?: EasySmsWorkerExecutionContext,
    ): Promise<Response> {
      const url = new URL(request.url);
      const method = (request.method || "GET").toUpperCase();
      const mutating = isMutatingEasySmsRoute(method, url.pathname, url);

      if (!mutating) {
        const { service, config, releaseMetadata, previewIsolated } = await resolveService(env, false);
        return dispatchEasySmsWebRequest(request, service, config, {
          requireAuth: true,
          releaseMetadata,
          previewIsolated,
        });
      }

      return withSerializedMutation(async () => {
        const { service, config, releaseMetadata, previewIsolated } = await resolveService(env, true);
        const response = await dispatchEasySmsWebRequest(request, service, config, {
          requireAuth: true,
          releaseMetadata,
          previewIsolated,
        });
        if (response.status < 500 && response.status !== 401 && response.status !== 403) {
          await persistIfConfigured(env, service);
        }
        return response;
      });
    },

    async scheduled(
      _controller: { scheduledTime?: number; cron?: string },
      env: EasySmsWorkerEnv,
      _ctx?: EasySmsWorkerExecutionContext,
    ): Promise<void> {
      await withSerializedMutation(async () => {
        const { service, previewIsolated } = await resolveService(env, true);
        const now = new Date();
        service.runMaintenance(now);
        service.recordMaintenanceLoopSuccess(now);

        if (!previewIsolated) {
          try {
            await service.probeAllProviders(now);
            service.recordActiveProbeLoopSuccess(now, "Scheduled Cloudflare Worker probe completed.");
          } catch (error) {
            service.recordActiveProbeLoopFailure(now, error, "Scheduled Cloudflare Worker probe failed.");
          }
        }

        await persistIfConfigured(env, service);
      });
    },
  };
}

const defaultWorker = createEasySmsWorker();
export default defaultWorker;
