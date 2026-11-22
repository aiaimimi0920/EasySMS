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
  let inFlightProbe: Promise<SmsProviderHealthProbeResult[]> | undefined;

  const runSerializedProbe = (label: "Initial" | "Periodic" | "Manual"): Promise<SmsProviderHealthProbeResult[]> => {
    if (inFlightProbe) {
      return inFlightProbe;
    }

    const startedAt = new Date();
    const task = service.probeAllProviders()
      .then((probes) => {
        service.recordActiveProbeLoopSuccess(
          startedAt,
          `${label} active probe completed for ${probes.length} providers.`,
        );
        return probes;
      })
      .catch((error) => {
        service.recordActiveProbeLoopFailure(startedAt, error, `${label} active probe failed.`);
        throw error;
      })
      .finally(() => {
        inFlightProbe = undefined;
      });

    inFlightProbe = task;
    return task;
  };

  if (options.activeProbeEnabled) {
    void runSerializedProbe("Initial").catch((error) => {
      console.error("[EasySMS] maintenance: initial probe failed:", error);
    });
  }

  const maintenanceHandle = setInterval(() => {
    const startedAt = new Date();
    try {
      const result = service.runMaintenance();
      const refreshedCount = result.refreshed.providers.length + result.refreshed.routes.length;
      const prunedCount = (result.pruned?.sessions ?? 0) + (result.pruned?.leases ?? 0) + (result.pruned?.issuedNumbers ?? 0);
      service.recordMaintenanceLoopSuccess(
        startedAt,
        prunedCount > 0
          ? `Maintenance refreshed ${refreshedCount} operational-state entries and pruned ${prunedCount} stale records.`
          : `Maintenance refreshed ${refreshedCount} operational-state entries.`,
      );
    } catch (error) {
      service.recordMaintenanceLoopFailure(startedAt, error, "Periodic maintenance tick failed.");
      console.error("[EasySMS] maintenance: periodic maintenance tick failed:", error);
    }
  }, options.intervalMs);

  const activeProbeHandle = options.activeProbeEnabled
    ? setInterval(() => {
        void runSerializedProbe("Periodic").catch((error) => {
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
        const prunedCount = (result.pruned?.sessions ?? 0) + (result.pruned?.leases ?? 0) + (result.pruned?.issuedNumbers ?? 0);
        service.recordMaintenanceLoopSuccess(
          startedAt,
          prunedCount > 0
            ? `Manual maintenance refreshed ${refreshedCount} operational-state entries and pruned ${prunedCount} stale records.`
            : `Manual maintenance refreshed ${refreshedCount} operational-state entries.`,
        );
        return result;
      } catch (error) {
        service.recordMaintenanceLoopFailure(startedAt, error, "Manual maintenance tick failed.");
        throw error;
      }
    },
    probeAll() {
      return runSerializedProbe("Manual");
    },
    stop() {
      clearInterval(maintenanceHandle);
      if (activeProbeHandle !== undefined) {
        clearInterval(activeProbeHandle);
      }
    },
  };
}
