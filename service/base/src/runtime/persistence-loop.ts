import type { EasySmsService } from "../service/easy-sms-service.js";
import type { EasySmsRuntimeConfig } from "../domain/models.js";
import { saveEasySmsRuntimeState } from "../persistence/index.js";

export interface EasySmsStatePersistenceLoop {
  intervalMs: number;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export interface EasySmsStatePersistenceLoopOptions {
  intervalMs: number;
}

export function startEasySmsStatePersistenceLoop(
  service: EasySmsService,
  config: EasySmsRuntimeConfig,
  options: EasySmsStatePersistenceLoopOptions,
): EasySmsStatePersistenceLoop {
  const flushOnce = async (detail?: string): Promise<void> => {
    const startedAt = new Date();
    try {
      await saveEasySmsRuntimeState(config, service.getRuntimeStateSnapshot());
      service.recordPersistenceLoopSuccess(
        startedAt,
        detail ?? `Runtime state flushed to ${config.persistence.filePath}.`,
      );
    } catch (error) {
      service.recordPersistenceLoopFailure(
        startedAt,
        error,
        detail ?? "Periodic runtime state flush failed.",
      );
      throw error;
    }
  };

  const intervalHandle = setInterval(() => {
    void flushOnce().catch((error) =>
      console.error("[EasySMS] persistence: periodic flush failed:", error),
    );
  }, options.intervalMs);

  return {
    intervalMs: options.intervalMs,
    flush() {
      return flushOnce("Manual runtime state flush completed.");
    },
    async stop() {
      clearInterval(intervalHandle);
      await flushOnce("Shutdown runtime state flush completed.");
    },
  };
}
