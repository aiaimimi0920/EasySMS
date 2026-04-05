import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { EasySmsError } from "../domain/errors.js";
import type { EasySmsRuntimeConfig } from "../domain/models.js";
import type { EasySmsService } from "../service/easy-sms-service.js";
import { readJsonBody, writeJson } from "../shared/index.js";
import {
  parseGetInboxOptions,
  parseListPublicNumbersOptions,
  parseProviderHealthQuery,
  parseTemporaryDisableInput,
} from "./contracts.js";

function isAuthorized(request: IncomingMessage, config: EasySmsRuntimeConfig): boolean {
  if (!config.server.apiKey) {
    return true;
  }

  const header = request.headers.authorization;
  return header === `Bearer ${config.server.apiKey}`;
}

function writeError(response: ServerResponse, error: unknown): void {
  if (error instanceof EasySmsError) {
    writeJson(response, error.statusCode, { error: error.message });
    return;
  }

  writeJson(response, 500, { error: "Internal server error." });
}

export function startHttpServer(
  service: EasySmsService,
  config: EasySmsRuntimeConfig,
): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      if (!isAuthorized(request, config) && request.url !== "/healthz") {
        writeJson(response, 401, { error: "Unauthorized." });
        return;
      }

      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");

      if (method === "GET" && url.pathname === "/healthz") {
        const summary = service.getHealthSummary();
        writeJson(response, 200, {
          status: "ok",
          service: "easy-sms",
          providerCount: service.listProviders().length,
          strategyModeId: config.strategy.providerStrategyModeId,
          health: summary,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/providers") {
        writeJson(response, 200, {
          providers: service.listProviders(),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/providers/health") {
        const { providerKey } = parseProviderHealthQuery(url);
        writeJson(response, 200, {
          summary: service.getHealthSummary(),
          providers: providerKey
            ? service.listProviderHealth().filter((provider) => provider.providerKey === providerKey)
            : service.listProviderHealth(),
          routes: service.listRouteHealth(providerKey as never),
          trends: service.listProbeTrends(providerKey as never),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/providers/probe-history") {
        const { providerKey } = parseProviderHealthQuery(url);
        writeJson(response, 200, {
          history: service.listProbeHistory(providerKey as never),
          trends: service.listProbeTrends(providerKey as never),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/providers/selection-plan") {
        const options = parseListPublicNumbersOptions(url);
        writeJson(response, 200, {
          strategyModeId: config.strategy.providerStrategyModeId,
          routeKind: "list-public-numbers",
          candidates: service.getListSelectionPlan(options),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/providers/probe") {
        const providerKey = url.searchParams.get("providerKey");
        writeJson(response, 200, {
          results: providerKey
            ? [await service.probeProvider(providerKey as never)]
            : await service.probeAllProviders(),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/sms/public-numbers") {
        const result = await service.listPublicNumbers(parseListPublicNumbersOptions(url));
        writeJson(response, 200, result);
        return;
      }

      if (method === "GET" && url.pathname === "/sms/inbox") {
        const inbox = await service.getInbox(parseGetInboxOptions(url));
        writeJson(response, 200, inbox);
        return;
      }

      const providerAdminMatch = url.pathname.match(/^\/admin\/providers\/([^/]+)\/(disable|enable|reset|probe)$/);
      if (providerAdminMatch) {
        const providerKey = decodeURIComponent(providerAdminMatch[1] ?? "");
        const action = providerAdminMatch[2];

        if (method === "POST" && action === "disable") {
          const payload = parseTemporaryDisableInput(await readJsonBody(request));
          writeJson(response, 200, {
            provider: service.disableProviderTemporarily(providerKey as never, payload),
          });
          return;
        }

        if (method === "POST" && action === "enable") {
          writeJson(response, 200, {
            provider: service.enableProvider(providerKey as never),
          });
          return;
        }

        if (method === "POST" && action === "reset") {
          writeJson(response, 200, service.resetOperationalState(providerKey as never));
          return;
        }

        if (method === "POST" && action === "probe") {
          writeJson(response, 200, {
            result: await service.probeProvider(providerKey as never),
          });
          return;
        }
      }

      writeJson(response, 404, { error: "Route not found." });
    } catch (error) {
      writeError(response, error);
    }
  });

  return new Promise((resolve) => {
    server.listen(config.server.port, config.server.host, () => resolve(server));
  });
}
