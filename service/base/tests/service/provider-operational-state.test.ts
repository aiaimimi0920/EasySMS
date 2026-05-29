import { describe, expect, it } from "vitest";

import type { ProviderDescriptor } from "../../src/domain/models.js";
import { EasySmsProviderOperationalState } from "../../src/service/provider-operational-state.js";

const descriptor: ProviderDescriptor = {
  key: "onlinesim",
  displayName: "Fake Provider",
  homepageUrl: "https://example.com",
  sourceType: "public-web-scrape",
  costTier: "free",
  capabilities: ["list-public-numbers", "read-public-inbox"],
  enabled: true,
  countryHints: [],
  notes: [],
};

describe("EasySmsProviderOperationalState", () => {
  it("applies cooldown for provider-scope challenge failures and clears it after recovery", () => {
    const state = new EasySmsProviderOperationalState([descriptor]);
    const now = new Date("2026-04-05T12:00:00.000Z");
    const context = {
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      routeKind: "list-public-numbers" as const,
      scopeKind: "provider" as const,
      scopeValue: "global",
    };

    const failure = state.recordRouteFailure(context, new Error("Cloudflare challenge page"), now);

    expect(failure.cooldownApplied).toBe(true);
    expect(state.getAvailabilityIssue(context, now)?.status).toBe("cooling");

    state.recordRouteSuccess(context, {
      detail: "Recovered",
      itemCount: 1,
      now: new Date("2026-04-05T12:05:00.000Z"),
    });

    expect(state.getAvailabilityIssue(context, new Date("2026-04-05T12:05:00.000Z"))).toBeUndefined();
    expect(state.listProviderHealth()[0]?.healthState).toBe("healthy");
  });

  it("expires temporary disable windows during refresh", () => {
    const state = new EasySmsProviderOperationalState([descriptor]);
    const disabled = state.markTemporaryDisabled(descriptor.key, {
      reason: "manual_disable",
      until: new Date("2026-04-05T12:30:00.000Z"),
      now: new Date("2026-04-05T12:00:00.000Z"),
    });

    expect(disabled.status).toBe("temporarily_disabled");

    state.refresh(new Date("2026-04-05T12:31:00.000Z"));

    const current = state.listProviderHealth(new Date("2026-04-05T12:31:00.000Z"))[0];
    expect(current?.status).toBe("active");
    expect(current?.temporarilyDisabledUntil).toBeUndefined();
  });

  it("builds probe trend buckets and penalties from recent probe history", () => {
    const state = new EasySmsProviderOperationalState([descriptor], {
      probeHistoryMaxEntries: 10,
      probeHistoryWindowMs: 24 * 60 * 60 * 1000,
    });

    state.recordProbeResult({
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      ok: false,
      status: "degraded",
      healthState: "challenge",
      healthScore: 0.2,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T12:00:00.000Z",
      detail: "Cloudflare challenge",
    });
    state.recordProbeResult({
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      ok: false,
      status: "degraded",
      healthState: "blocked",
      healthScore: 0.25,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T12:30:00.000Z",
      detail: "network error",
    });
    state.recordProbeResult({
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      ok: true,
      status: "active",
      healthState: "healthy",
      healthScore: 1,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T13:00:00.000Z",
      detail: "ok",
    });

    const trend = state.listProbeTrends(undefined, new Date("2026-04-05T13:10:00.000Z"))[0];

    expect(trend?.sampleCount).toBe(3);
    expect(trend?.challengeCount).toBe(1);
    expect(trend?.blockedCount).toBe(1);
    expect(trend?.successCount).toBe(1);
    expect(trend?.trendPenalty).toBeGreaterThan(0);
  });

  it("marks empty list candidates unavailable without provider-specific rules", () => {
    const state = new EasySmsProviderOperationalState([descriptor]);
    const context = {
      providerKey: descriptor.key,
      providerDisplayName: descriptor.displayName,
      routeKind: "list-public-numbers" as const,
      scopeKind: "provider" as const,
      scopeValue: "global",
    };

    state.recordRouteSuccess(context, {
      detail: "Provider responded but returned no public numbers.",
      itemCount: 0,
      isEmpty: true,
      now: new Date("2026-04-05T13:00:00.000Z"),
    });

    const candidate = state.getSelectionCandidate(context, new Date("2026-04-05T13:01:00.000Z"));

    expect(candidate.healthState).toBe("empty");
    expect(candidate.available).toBe(false);
    expect(candidate.availabilityIssue).toContain("empty public number");
    expect(candidate.emptyPenalty).toBeGreaterThanOrEqual(80);
  });
});
