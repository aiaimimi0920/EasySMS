import {
  EASY_SMS_HTTP_ROUTES,
  parseListPublicNumbersOptions,
  parseProviderCatalogQuery,
  parseProviderHealthQuery,
  parseProviderProbeHistoryQuery,
  parseSessionMessageQueryFilters,
  parseSessionQueryFilters,
} from "../contracts.js";
import type { EasySmsHttpHandler } from "../handler.js";

export interface EasySmsAdminRouteContext {
  method: string;
  path: string;
  url: URL;
  handler: EasySmsHttpHandler;
}

function extractProviderProbeKey(path: string): string | undefined {
  const matched = path.match(/^\/sms\/providers\/([^/]+)\/probe$/);
  return matched?.[1] ? decodeURIComponent(matched[1]) : undefined;
}

function extractSessionQueryId(path: string): string | undefined {
  const matched = path.match(/^\/sms\/query\/sessions\/([^/]+)$/);
  return matched?.[1] ? decodeURIComponent(matched[1]) : undefined;
}

function extractMessageQueryId(path: string): string | undefined {
  const matched = path.match(/^\/sms\/query\/messages\/([^/]+)$/);
  return matched?.[1] ? decodeURIComponent(matched[1]) : undefined;
}

export async function handleAdminRoute(context: EasySmsAdminRouteContext): Promise<unknown | undefined> {
  const { method, path, url, handler } = context;

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryProviders) {
    return handler.queryProviders(parseProviderCatalogQuery(url));
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryRuntime) {
    return handler.getRuntimeDiagnostics();
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryProviderHealth) {
    return handler.queryProviderHealth(parseProviderHealthQuery(url));
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryProviderProbeHistory) {
    return handler.queryProviderProbeHistory(parseProviderProbeHistoryQuery(url));
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryProviderSelectionPlan) {
    return handler.queryProviderSelectionPlan(parseListPublicNumbersOptions(url));
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.querySessions) {
    return handler.querySessions(parseSessionQueryFilters(url));
  }

  const sessionId = extractSessionQueryId(path);
  if (method === "GET" && sessionId) {
    return handler.getSession(sessionId);
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryMessages) {
    return handler.queryObservedMessages(parseSessionMessageQueryFilters(url));
  }

  const messageId = extractMessageQueryId(path);
  if (method === "GET" && messageId) {
    const { refreshProjected } = parseSessionMessageQueryFilters(url);
    return handler.getObservedMessage(messageId, { refreshProjected });
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryStats) {
    return handler.getStats();
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.probeAllProviders) {
    return handler.probeAllProviders();
  }

  const providerKey = extractProviderProbeKey(path);
  if (method === "GET" && providerKey) {
    return handler.probeProvider(providerKey);
  }

  return undefined;
}
