import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../src/domain/models.js";
import type { SmsProvider } from "../../src/providers/contracts.js";
import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { EasySmsService } from "../../src/service/easy-sms-service.js";

class FakeSmsProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor;

  public constructor(
    descriptor: ProviderDescriptor,
    private readonly listHandler: (options: ListPublicNumbersOptions) => Promise<SmsPublicNumber[]>,
    private readonly inboxHandler: (numberId: string) => Promise<SmsInboxSnapshot>,
  ) {
    this.descriptor = descriptor;
  }

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    return this.listHandler(options);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    return this.inboxHandler(numberId);
  }
}

function createConfig(): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    providers: {
      ...defaultEasySmsRuntimeConfig.providers,
      enabledProviders: ["onlinesim"],
    },
  };
}

function createDescriptor(): ProviderDescriptor {
  return {
    key: "onlinesim",
    displayName: "Fake Provider",
    homepageUrl: "https://example.com",
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers"],
    enabled: true,
    countryHints: [],
    notes: [],
  };
}

describe("EasySmsService health integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks empty probes as empty instead of failed", async () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    const result = await service.probeProvider("onlinesim", new Date("2026-04-05T13:00:00.000Z"));

    expect(result.ok).toBe(false);
    expect(result.healthState).toBe("empty");
  });

  it("skips temporarily disabled providers during list aggregation", async () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [{
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "abc",
            sourceUrl: "https://example.com/number",
            phoneNumber: "+10000000000",
          }],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "abc",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.disableProviderTemporarily("onlinesim", {
      reason: "manual_disable",
      until: new Date("2099-04-05T14:00:00.000Z"),
      now: new Date("2026-04-05T13:30:00.000Z"),
    });

    const result = await service.listPublicNumbers({});

    expect(result.items).toHaveLength(0);
    expect(result.errors[0]?.message).toContain("temporarily disabled");
  });

  it("turns challenge probe failures into challenge health state", async () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => {
            throw new Error("Cloudflare challenge");
          },
          async () => {
            throw new Error("unused");
          },
        ),
      ],
    );

    const result = await service.probeProvider("onlinesim", new Date("2026-04-05T15:00:00.000Z"));

    expect(result.ok).toBe(false);
    expect(result.healthState).toBe("challenge");
    expect(result.cooldownApplied).toBe(true);
  });

  it("ranks healthier providers ahead of recently empty ones", async () => {
    const firstDescriptor = {
      ...createDescriptor(),
      key: "onlinesim",
      displayName: "First Provider",
    } satisfies ProviderDescriptor;
    const secondDescriptor = {
      ...createDescriptor(),
      key: "receive_smss",
      displayName: "Second Provider",
    } satisfies ProviderDescriptor;

    const service = new EasySmsService(
      {
        ...createConfig(),
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim", "receive_smss"],
        },
      },
      [
        new FakeSmsProvider(
          firstDescriptor,
          async () => [{
            providerKey: "onlinesim",
            providerDisplayName: "First Provider",
            numberId: "first",
            sourceUrl: "https://example.com/first",
            phoneNumber: "+10000000001",
          }],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "First Provider",
            numberId: "first",
            phoneNumber: "+10000000001",
            sourceUrl: "https://example.com/first",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          secondDescriptor,
          async () => [{
            providerKey: "receive_smss",
            providerDisplayName: "Second Provider",
            numberId: "second",
            sourceUrl: "https://example.com/second",
            phoneNumber: "+10000000002",
          }],
          async () => ({
            providerKey: "receive_smss",
            providerDisplayName: "Second Provider",
            numberId: "second",
            phoneNumber: "+10000000002",
            sourceUrl: "https://example.com/second",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteSuccess({
      providerKey: "onlinesim",
      providerDisplayName: "First Provider",
      routeKind: "list-public-numbers",
      scopeKind: "provider",
      scopeValue: "global",
    }, {
      detail: "recent empty",
      isEmpty: true,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });

    const plan = service.getListSelectionPlan();

    expect(plan[0]?.providerKey).toBe("receive_smss");
    expect(plan[1]?.providerKey).toBe("onlinesim");
  });

  it("stops on the first successful provider in weighted-fallback mode", async () => {
    const calls: string[] = [];
    const config = {
      ...createConfig(),
      strategy: {
        ...createConfig().strategy,
        providerStrategyModeId: "weighted-fallback",
      },
      providers: {
        ...createConfig().providers,
        enabledProviders: ["onlinesim", "receive_smss", "yunduanxin"],
      },
    };

    const service = new EasySmsService(
      config,
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            key: "onlinesim",
            displayName: "First Provider",
          },
          async () => {
            calls.push("onlinesim");
            return [];
          },
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "First Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/unused",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            key: "receive_smss",
            displayName: "Second Provider",
          },
          async () => {
            calls.push("receive_smss");
            return [{
              providerKey: "receive_smss",
              providerDisplayName: "Second Provider",
              numberId: "second",
              sourceUrl: "https://example.com/second",
              phoneNumber: "+10000000002",
            }];
          },
          async () => ({
            providerKey: "receive_smss",
            providerDisplayName: "Second Provider",
            numberId: "second",
            phoneNumber: "+10000000002",
            sourceUrl: "https://example.com/second",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            key: "yunduanxin",
            displayName: "Third Provider",
          },
          async () => {
            calls.push("yunduanxin");
            return [{
              providerKey: "yunduanxin",
              providerDisplayName: "Third Provider",
              numberId: "third",
              sourceUrl: "https://example.com/third",
              phoneNumber: "+10000000003",
            }];
          },
          async () => ({
            providerKey: "yunduanxin",
            providerDisplayName: "Third Provider",
            numberId: "third",
            phoneNumber: "+10000000003",
            sourceUrl: "https://example.com/third",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    const result = await service.listPublicNumbers({ limit: 5 });

    expect(result.items.map((item) => item.providerKey)).toEqual(["receive_smss"]);
    expect(calls).toEqual(["onlinesim", "receive_smss"]);
  });

  it("uses probe trend penalties to demote unstable providers", () => {
    const firstDescriptor = {
      ...createDescriptor(),
      key: "onlinesim",
      displayName: "First Provider",
    } satisfies ProviderDescriptor;
    const secondDescriptor = {
      ...createDescriptor(),
      key: "receive_smss",
      displayName: "Second Provider",
    } satisfies ProviderDescriptor;

    const service = new EasySmsService(
      {
        ...createConfig(),
        maintenance: {
          ...createConfig().maintenance,
          probeHistoryMaxEntries: 10,
          probeHistoryWindowMs: 24 * 60 * 60 * 1000,
        },
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim", "receive_smss"],
        },
      },
      [
        new FakeSmsProvider(
          firstDescriptor,
          async () => [],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "First Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/unused",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          secondDescriptor,
          async () => [],
          async () => ({
            providerKey: "receive_smss",
            providerDisplayName: "Second Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/unused",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordProbeResult({
      providerKey: "onlinesim",
      providerDisplayName: "First Provider",
      ok: false,
      status: "degraded",
      healthState: "challenge",
      healthScore: 0.2,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T10:00:00.000Z",
      detail: "challenge",
    });
    service.operationalState.recordProbeResult({
      providerKey: "onlinesim",
      providerDisplayName: "First Provider",
      ok: false,
      status: "degraded",
      healthState: "challenge",
      healthScore: 0.2,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T11:00:00.000Z",
      detail: "challenge",
    });

    const plan = service.getListSelectionPlan({}, new Date("2026-04-05T12:00:00.000Z"));

    expect(plan[0]?.providerKey).toBe("receive_smss");
    expect(plan[1]?.providerKey).toBe("onlinesim");
    expect(plan[1]?.trendPenalty).toBeGreaterThan(0);
  });

  it("tracks runtime diagnostics for state load and background loop results", () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.recordRuntimeStateLoad({
      status: "loaded",
      detail: "Runtime state was loaded from the persistence store.",
      checkedAt: new Date("2026-05-12T13:00:00.000Z"),
    });
    service.recordMaintenanceLoopSuccess(
      new Date("2026-05-12T13:00:10.000Z"),
      "Maintenance refreshed 1 providers.",
    );
    service.recordPersistenceLoopFailure(
      new Date("2026-05-12T13:00:20.000Z"),
      new Error("disk full"),
      "Periodic runtime state flush failed.",
    );

    const runtime = service.getRuntimeDiagnostics();
    expect(runtime.stateLoad.status).toBe("loaded");
    expect(runtime.maintenanceLoop.successCount).toBe(1);
    expect(runtime.persistenceLoop.failureCount).toBe(1);
    expect(runtime.persistenceLoop.lastError).toContain("disk full");
  });

  it("filters probe history by route kind, health state, and time window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

    const service = new EasySmsService(
      {
        ...createConfig(),
        maintenance: {
          ...createConfig().maintenance,
          probeHistoryMaxEntries: 10,
          probeHistoryWindowMs: 24 * 60 * 60 * 1000,
        },
      },
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordProbeResult({
      providerKey: "onlinesim",
      providerDisplayName: "Fake Provider",
      ok: false,
      status: "cooling",
      healthState: "challenge",
      healthScore: 0.2,
      routeKind: "list-public-numbers",
      checkedAt: "2026-05-12T10:00:00.000Z",
      detail: "challenge",
    });
    service.operationalState.recordProbeResult({
      providerKey: "onlinesim",
      providerDisplayName: "Fake Provider",
      ok: true,
      status: "active",
      healthState: "healthy",
      healthScore: 1,
      routeKind: "read-public-inbox",
      checkedAt: "2026-05-12T11:00:00.000Z",
      detail: "ok",
    });

    const filtered = service.listProbeHistory({
      providerKey: "onlinesim",
      routeKind: "list-public-numbers",
      healthState: "challenge",
      since: new Date("2026-05-12T09:00:00.000Z"),
      until: new Date("2026-05-12T10:30:00.000Z"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.routeKind).toBe("list-public-numbers");
    expect(filtered[0]?.healthState).toBe("challenge");
  });
});
