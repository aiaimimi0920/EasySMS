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
  const flushOnce = async (): Promise<void> => {
    await saveEasySmsRuntimeState(config, service.getRuntimeStateSnapshot());
  };

  const intervalHandle = setInterval(() => {
    void flushOnce().catch(() => undefined);
  }, options.intervalMs);

  return {
    intervalMs: options.intervalMs,
    flush() {
      return flushOnce();
    },
    async stop() {
      clearInterval(intervalHandle);
      await flushOnce();
    },
  };
}
