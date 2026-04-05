import { ValidationError } from "../domain/errors.js";
import type { GetInboxOptions, ListPublicNumbersOptions } from "../domain/models.js";

export function parseListPublicNumbersOptions(url: URL): ListPublicNumbersOptions {
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  if (limitParam && (!Number.isFinite(limit) || limit <= 0)) {
    throw new ValidationError("limit must be a positive integer.");
  }

  return {
    providerKey: url.searchParams.get("providerKey") ?? undefined,
    limit: limit ?? undefined,
    countryCode: url.searchParams.get("countryCode") ?? undefined,
    countryName: url.searchParams.get("countryName") ?? undefined,
  };
}

export function parseGetInboxOptions(url: URL): GetInboxOptions {
  const providerKey = url.searchParams.get("providerKey");
  const numberId = url.searchParams.get("numberId");

  if (!providerKey) {
    throw new ValidationError("providerKey is required.");
  }

  if (!numberId) {
    throw new ValidationError("numberId is required.");
  }

  return {
    providerKey,
    numberId,
  };
}

export function parseProviderHealthQuery(url: URL): { providerKey?: string } {
  return {
    providerKey: url.searchParams.get("providerKey") ?? undefined,
  };
}

export function parseTemporaryDisableInput(
  body: unknown,
  now: Date = new Date(),
): { reason: string; until: Date } {
  const payload = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const reason = typeof payload.reason === "string" && payload.reason.trim()
    ? payload.reason.trim()
    : "manual_temporary_disable";
  const durationMs = typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
    ? payload.durationMs
    : undefined;
  const until = typeof payload.until === "string" && payload.until.trim()
    ? new Date(payload.until)
    : undefined;

  if (until && Number.isNaN(until.getTime())) {
    throw new ValidationError("until must be a valid ISO timestamp.");
  }

  if (durationMs !== undefined && durationMs <= 0) {
    throw new ValidationError("durationMs must be a positive number.");
  }

  if (!until && durationMs === undefined) {
    return {
      reason,
      until: new Date(now.getTime() + 60 * 60 * 1000),
    };
  }

  return {
    reason,
    until: until ?? new Date(now.getTime() + (durationMs as number)),
  };
}
