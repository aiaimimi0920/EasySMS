import { createEasySmsService } from "../service/easy-sms-service.js";
import { startHttpServer } from "../http/server.js";
import { loadEasySmsRuntimeState } from "../persistence/index.js";
import { loadEasySmsConfig } from "./config.js";
import { startEasySmsMaintenanceLoop } from "./maintenance-loop.js";
import { startEasySmsStatePersistenceLoop } from "./persistence-loop.js";

async function main(): Promise<void> {
  const config = await loadEasySmsConfig();
  const service = createEasySmsService(config);
  service.hydrateRuntimeState(await loadEasySmsRuntimeState(config));

  const maintenanceLoop = config.maintenance.enabled
    ? startEasySmsMaintenanceLoop(service, {
        intervalMs: config.maintenance.intervalMs,
        activeProbeEnabled: config.maintenance.activeProbeEnabled,
        activeProbeIntervalMs: config.maintenance.activeProbeIntervalMs,
      })
    : undefined;
  const persistenceLoop = config.persistence.enabled
    ? startEasySmsStatePersistenceLoop(service, config, {
        intervalMs: config.persistence.intervalMs,
      })
    : undefined;

  const server = await startHttpServer(service, config);
  console.log(`EasySMS listening on http://${config.server.host}:${config.server.port}`);

  const shutdown = async () => {
    maintenanceLoop?.stop();
    await persistenceLoop?.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

void main().catch((error) => {
  console.error("Failed to start EasySMS.", error);
  process.exitCode = 1;
});
