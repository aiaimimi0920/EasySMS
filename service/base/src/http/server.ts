import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { EasySmsError } from "../domain/errors.js";
import type { EasySmsRuntimeConfig } from "../domain/models.js";
import type { EasySmsService } from "../service/easy-sms-service.js";
import { readJsonBody, writeJson } from "../shared/index.js";
import { EasySmsHttpHandler } from "./handler.js";
import { handleAdminRoute } from "./routes/admin.js";
import { handleInternalRoute } from "./routes/internal.js";
import { handleLegacyRoute } from "./routes/legacy.js";
import { handlePublicRoute } from "./routes/public.js";

function isAuthorized(request: IncomingMessage, config: EasySmsRuntimeConfig): boolean {
  if (!config.server.apiKey) {
    return true;
  }

  const header = request.headers.authorization;
  return header === `Bearer ${config.server.apiKey}`;
}

function isUnauthenticatedAllowedPath(path: string): boolean {
  return path === "/healthz" || path === "/openapi.json";
}

function writeError(response: ServerResponse, error: unknown): void {
  if (error instanceof EasySmsError) {
    writeJson(response, error.statusCode, { error: error.message });
    return;
  }

  writeJson(response, 500, { error: error instanceof Error ? error.message : "Internal server error." });
}

export function startHttpServer(
  service: EasySmsService,
  config: EasySmsRuntimeConfig,
): Promise<Server> {
  const handler = new EasySmsHttpHandler(service);

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (!isAuthorized(request, config) && !isUnauthenticatedAllowedPath(path)) {
        writeJson(response, 401, { error: "Unauthorized." });
        return;
      }

      const readBodyJson = <T>() => readJsonBody(request) as Promise<T>;

      const result = await handleAdminRoute({
        method,
        path,
        url,
        handler,
      }) ?? await handlePublicRoute({
        method,
        path,
        url,
        handler,
        readJsonBody: readBodyJson,
      }) ?? await handleInternalRoute({
        method,
        path,
        handler,
      }) ?? await handleLegacyRoute({
        method,
        path,
        url,
        handler,
        response,
        readJsonBody: readBodyJson,
      });

      if (result === null) {
        return;
      }

      if (result !== undefined) {
        writeJson(response, 200, result);
        return;
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
