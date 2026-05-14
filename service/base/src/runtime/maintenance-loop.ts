import type { EasySmsService } from "../service/easy-sms-service.js";
import type { SmsProviderHealthProbeResult } from "../domain/models.js";

export interface EasySmsMaintenanceLoop {
  intervalMs: number;
  tick(): ReturnType<EasySmsService["runMaintenance"]>;
  probeAll(): Promise<SmsProviderHealthProbeResult[]>;
  stop(): void;
}

export interface EasySmsMaintenanceLoopOptions {
  intervalMs: number;
  activeProbeEnabled: boolean;
  activeProbeIntervalMs: number;
}

export function startEasySmsMaintenanceLoop(
  service: EasySmsService,
  options: EasySmsMaintenanceLoopOptions,
): EasySmsMaintenanceLoop {
  if (options.activeProbeEnabled) {
    const startedAt = new Date();
    void service.probeAllProviders()
      .then((probes) => {
        service.recordActiveProbeLoopSuccess(
          startedAt,
          `Initial active probe completed for ${probes.length} providers.`,
        );
      })
      .catch((error) => {
        service.recordActiveProbeLoopFailure(startedAt, error, "Initial active probe failed.");
        console.error("[EasySMS] maintenance: initial probe failed:", error);
      });
  }

  const maintenanceHandle = setInterval(() => {
    const startedAt = new Date();
    try {
      const result = service.runMaintenance();
      const refreshedCount = result.refreshed.providers.length + result.refreshed.routes.length;
      service.recordMaintenanceLoopSuccess(
        startedAt,
        `Maintenance refreshed ${refreshedCount} operational-state entries.`,
      );
    } catch (error) {
      service.recordMaintenanceLoopFailure(startedAt, error, "Periodic maintenance tick failed.");
      console.error("[EasySMS] maintenance: periodic maintenance tick failed:", error);
    }
  }, options.intervalMs);

  const activeProbeHandle = options.activeProbeEnabled
    ? setInterval(() => {
        const startedAt = new Date();
        void service.probeAllProviders()
          .then((probes) => {
            service.recordActiveProbeLoopSuccess(
              startedAt,
              `Periodic active probe completed for ${probes.length} providers.`,
            );
          })
          .catch((error) => {
            service.recordActiveProbeLoopFailure(startedAt, error, "Periodic active probe failed.");
            console.error("[EasySMS] maintenance: periodic probe failed:", error);
          });
      }, options.activeProbeIntervalMs)
    : undefined;

  return {
    intervalMs: options.intervalMs,
    tick() {
      const startedAt = new Date();
      try {
        const result = service.runMaintenance();
        const refreshedCount = result.refreshed.providers.length + result.refreshed.routes.length;
        service.recordMaintenanceLoopSuccess(
          startedAt,
          `Manual maintenance refreshed ${refreshedCount} operational-state entries.`,
        );
        return result;
      } catch (error) {
        service.recordMaintenanceLoopFailure(startedAt, error, "Manual maintenance tick failed.");
        throw error;
      }
    },
    probeAll() {
      const startedAt = new Date();
      return service.probeAllProviders()
        .then((probes) => {
          service.recordActiveProbeLoopSuccess(
            startedAt,
            `Manual active probe completed for ${probes.length} providers.`,
          );
          return probes;
        })
        .catch((error) => {
          service.recordActiveProbeLoopFailure(startedAt, error, "Manual active probe failed.");
          throw error;
        });
    },
    stop() {
      clearInterval(maintenanceHandle);
      if (activeProbeHandle !== undefined) {
        clearInterval(activeProbeHandle);
      }
    },
  };
}
