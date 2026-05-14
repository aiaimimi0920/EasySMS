import { EASY_SMS_HTTP_ROUTES } from "../contracts.js";
import type { EasySmsHttpHandler } from "../handler.js";

export interface EasySmsInternalRouteContext {
  method: string;
  path: string;
  handler: EasySmsHttpHandler;
}

export async function handleInternalRoute(context: EasySmsInternalRouteContext): Promise<unknown | undefined> {
  const { method, path, handler } = context;

  if (method === "POST" && path === EASY_SMS_HTTP_ROUTES.runMaintenance) {
    return handler.runMaintenance();
  }

  return undefined;
}
