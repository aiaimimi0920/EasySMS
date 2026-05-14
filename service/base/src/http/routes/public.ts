import {
  parseActivationActionRequest,
  EASY_SMS_HTTP_ROUTES,
  parseObserveSmsMessageRequest,
  parseRecoverSessionByPhoneRequest,
  parseSnapshotModeQuery,
  parseSessionOutcomeReport,
  parseSmsSessionOpenRequest,
  parseSmsSessionPlanRequest,
} from "../contracts.js";
import type { EasySmsHttpHandler } from "../handler.js";

export interface EasySmsPublicRouteContext {
  method: string;
  path: string;
  url: URL;
  handler: EasySmsHttpHandler;
  readJsonBody<T>(): Promise<T>;
}

function extractSessionId(path: string, suffix: "code" | "messages" | "status" | "actions"): string | undefined {
  const matched = path.match(new RegExp(`^/sms/sessions/([^/]+)/${suffix}$`));
  return matched?.[1] ? decodeURIComponent(matched[1]) : undefined;
}

export async function handlePublicRoute(context: EasySmsPublicRouteContext): Promise<unknown | undefined> {
  const { method, path, url, handler, readJsonBody } = context;

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.catalog) {
    return handler.getCatalog();
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.snapshot) {
    return handler.getSnapshot(parseSnapshotModeQuery(url));
  }

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.planSession) {
    const payload = parseSmsSessionPlanRequest(await readJsonBody());
    return handler.planSession(payload.input, {
      providerKey: payload.providerKey,
      costTier: payload.costTier,
    });
  }

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.openSession) {
    const payload = parseSmsSessionOpenRequest(await readJsonBody());
    return handler.openSession(payload.input, {
      providerKey: payload.providerKey,
      costTier: payload.costTier,
    });
  }

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.recoverSessionByPhone) {
    return handler.recoverSessionByPhone(parseRecoverSessionByPhoneRequest(await readJsonBody()));
  }

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.reportSessionOutcome) {
    return handler.reportSessionOutcome(parseSessionOutcomeReport(await readJsonBody()));
  }

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.observeMessage) {
    return handler.observeMessage(parseObserveSmsMessageRequest(await readJsonBody()));
  }

  if (method === "GET" && path === EASY_SMS_HTTP_ROUTES.queryHeroSmsStats) {
    return handler.getHeroSmsStats();
  }

  const sessionCodeId = extractSessionId(path, "code");
  if (method === "GET" && sessionCodeId) {
    return handler.readSessionCode(sessionCodeId);
  }

  const sessionMessagesId = extractSessionId(path, "messages");
  if (method === "GET" && sessionMessagesId) {
    return handler.readSessionMessages(sessionMessagesId);
  }

  const sessionStatusId = extractSessionId(path, "status");
  if (method === "GET" && sessionStatusId) {
    return handler.readSessionStatus(sessionStatusId);
  }

  const sessionActionId = extractSessionId(path, "actions");
  if (method === "POST" && sessionActionId) {
    const payload = parseActivationActionRequest(await readJsonBody());
    return handler.updateSessionAction(sessionActionId, payload.action);
  }

  return undefined;
}
