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
    void service.probeAllProviders().catch(() => undefined);
  }

  const maintenanceHandle = setInterval(() => {
    service.runMaintenance();
  }, options.intervalMs);

  const activeProbeHandle = options.activeProbeEnabled
    ? setInterval(() => {
        void service.probeAllProviders().catch(() => undefined);
      }, options.activeProbeIntervalMs)
    : undefined;

  return {
    intervalMs: options.intervalMs,
    tick() {
      return service.runMaintenance();
    },
    probeAll() {
      return service.probeAllProviders();
    },
    stop() {
      clearInterval(maintenanceHandle);
      if (activeProbeHandle !== undefined) {
        clearInterval(activeProbeHandle);
      }
    },
  };
}
