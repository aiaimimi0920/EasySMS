import { EasySmsError, ValidationError } from "../domain/errors.js";
import type { EasySmsRuntimeConfig } from "../domain/models.js";
import type { EasySmsService } from "../service/easy-sms-service.js";
import { redactSensitiveText } from "../shared/index.js";
import { EasySmsHttpHandler } from "./handler.js";
import { handleAdminRoute } from "./routes/admin.js";
import { handleInternalRoute } from "./routes/internal.js";
import { handleLegacyRoute } from "./routes/legacy.js";
import { handlePublicRoute } from "./routes/public.js";

export const EASY_SMS_RELEASE_MANIFEST_PATH = "/.well-known/easysms-release.json";

export interface EasySmsReleaseMetadata {
  applicationId: string;
  applicationVersion: string;
  sourceSha: string;
  environment: string;
  purpose: "production" | "preview" | "local";
}

export interface EasySmsWebRouterOptions {
  requireAuth?: boolean;
  releaseMetadata?: EasySmsReleaseMetadata;
  previewIsolated?: boolean;
}

function timingSafeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

export function isUnauthenticatedAllowedPath(path: string): boolean {
  return path === "/healthz"
    || path === "/openapi.json"
    || path === EASY_SMS_RELEASE_MANIFEST_PATH;
}

function isAuthorizedWebRequest(
  request: Request,
  url: URL,
  config: EasySmsRuntimeConfig,
  requireAuth: boolean,
): boolean {
  const configuredKey = config.server.apiKey?.trim();
  if (!configuredKey) {
    return !requireAuth;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    if (timingSafeEqualString(token, configuredKey)) {
      return true;
    }
  }

  if (url.pathname === "/stubs/handler_api.php") {
    const queryKey = url.searchParams.get("api_key");
    if (queryKey && timingSafeEqualString(queryKey, configuredKey)) {
      return true;
    }
  }

  return false;
}

function jsonResponse(statusCode: number, payload: unknown): Response {
  const body = JSON.stringify(payload, null, 2);
  return new Response(body, {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof EasySmsError) {
    return jsonResponse(error.statusCode, { error: redactSensitiveText(error.message) });
  }
  return jsonResponse(500, {
    error: error instanceof Error ? redactSensitiveText(error.message) : "Internal server error.",
  });
}

async function readWebRequestJsonBody(request: Request): Promise<unknown> {
  const maxBodySizeBytes = 1024 * 1024;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBodySizeBytes) {
    throw new ValidationError("Request body exceeds maximum allowed size (1 MB).");
  }
  if (buffer.byteLength === 0) {
    return {};
  }
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(buffer));
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

export function isMutatingEasySmsRoute(method: string, path: string, url: URL): boolean {
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return true;
  }
  if (method === "GET" && path === "/stubs/handler_api.php") {
    const action = url.searchParams.get("action") ?? "";
    return action === "getNumberV2" || action === "setStatus" || action === "getStatus" || action === "getStatusV2";
  }
  if (method === "GET" && (path === "/sms/providers/probe" || /^\/sms\/providers\/[^/]+\/probe$/.test(path))) {
    return true;
  }
  return false;
}

function isBlockedByPreviewIsolation(method: string, path: string, url: URL): boolean {
  if (path === "/providers/probe" || path === "/sms/providers/probe" || /^\/sms\/providers\/[^/]+\/probe$/.test(path)) {
    return true;
  }
  if (/^\/admin\/providers\/[^/]+\/probe$/.test(path)) {
    return true;
  }
  if (method === "POST" && (path === "/sms/sessions/open" || path === "/sms/activations" || /^\/sms\/activations\/\d+\/actions$/.test(path) || /^\/sms\/sessions\/[^/]+\/actions$/.test(path))) {
    return true;
  }
  if (method === "GET" && path === "/stubs/handler_api.php") {
    const action = url.searchParams.get("action") ?? "";
    if (action === "getNumberV2" || action === "setStatus") {
      return true;
    }
  }
  return false;
}

export async function dispatchEasySmsWebRequest(
  request: Request,
  service: EasySmsService,
  config: EasySmsRuntimeConfig,
  options: EasySmsWebRouterOptions = {},
): Promise<Response> {
  const method = (request.method || "GET").toUpperCase();
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (method === "GET" && path === EASY_SMS_RELEASE_MANIFEST_PATH) {
      if (!options.releaseMetadata) {
        return jsonResponse(404, { error: "Release metadata is not configured." });
      }
      return jsonResponse(200, {
        schemaVersion: 1,
        applicationId: options.releaseMetadata.applicationId,
        applicationVersion: options.releaseMetadata.applicationVersion,
        sourceSha: options.releaseMetadata.sourceSha,
        environment: options.releaseMetadata.environment,
        purpose: options.releaseMetadata.purpose,
      });
    }

    if (options.requireAuth && !config.server.apiKey?.trim() && !isUnauthenticatedAllowedPath(path)) {
      return jsonResponse(503, { error: "Service authentication key is not configured." });
    }

    if (!isAuthorizedWebRequest(request, url, config, Boolean(options.requireAuth)) && !isUnauthenticatedAllowedPath(path)) {
      return jsonResponse(401, { error: "Unauthorized." });
    }

    if (options.previewIsolated && isBlockedByPreviewIsolation(method, path, url)) {
      return jsonResponse(403, {
        error: "Preview environment isolates live upstream activation and probe side effects.",
      });
    }

    const handler = new EasySmsHttpHandler(service);
    let bodyCache: Promise<unknown> | undefined;
    const readBodyJson = <T>() => {
      if (!bodyCache) {
        bodyCache = readWebRequestJsonBody(request);
      }
      return bodyCache as Promise<T>;
    };

    let textResponse: Response | undefined;
    const writeText = (statusCode: number, body: string): void => {
      textResponse = new Response(body, {
        status: statusCode,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    };

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
      writeText,
      readJsonBody: readBodyJson,
    });

    if (result === null) {
      return textResponse ?? new Response("", { status: 200 });
    }

    if (result !== undefined) {
      return jsonResponse(200, result);
    }

    return jsonResponse(404, { error: "Route not found." });
  } catch (error) {
    return errorResponse(error);
  }
}
