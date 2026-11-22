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
import { encodeNumberId } from "../../src/shared/index.js";

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

  it("marks synthetic list candidates unavailable when provider-scope inbox route is cooling", () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            capabilities: ["list-public-numbers", "read-public-inbox"],
          },
          async () => [{
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "number-1",
            sourceUrl: "https://example.com/number",
            phoneNumber: "+10000000000",
          }],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "number-1",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteFailure(
      {
        providerKey: "onlinesim",
        providerDisplayName: "Fake Provider",
        routeKind: "read-public-inbox",
        scopeKind: "provider",
        scopeValue: "global",
      },
      new Error("Cloudflare challenge page"),
      new Date("2026-04-05T16:00:00.000Z"),
    );

    const plan = service.getListSelectionPlan({}, new Date("2026-04-05T16:01:00.000Z"));

    expect(plan[0]).toMatchObject({
      providerKey: "onlinesim",
      available: false,
      healthState: "challenge",
    });
    expect(plan[0]?.availabilityIssue).toContain("read-public-inbox");
  });

  it("keeps a healthy country list route selectable when the provider global list route is cooling", () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [{
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "number-44",
            sourceUrl: "https://example.com/number-44",
            phoneNumber: "+440000000000",
            countryCode: "+44",
          }],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "number-44",
            phoneNumber: "+440000000000",
            sourceUrl: "https://example.com/number-44",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteSuccess({
      providerKey: "onlinesim",
      providerDisplayName: "Fake Provider",
      routeKind: "list-public-numbers",
      scopeKind: "country",
      scopeValue: "+44",
    }, {
      detail: "country route has stock",
      isEmpty: false,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });
    service.operationalState.recordRouteFailure(
      {
        providerKey: "onlinesim",
        providerDisplayName: "Fake Provider",
        routeKind: "list-public-numbers",
        scopeKind: "provider",
        scopeValue: "global",
      },
      new Error("timeout while listing the global directory"),
      new Date("2026-04-05T16:01:00.000Z"),
    );

    const globalPlan = service.getListSelectionPlan({}, new Date("2026-04-05T16:02:00.000Z"));
    expect(globalPlan[0]).toMatchObject({
      providerKey: "onlinesim",
      available: false,
      healthState: "blocked",
    });

    const countryPlan = service.getListSelectionPlan(
      { countryCode: "+44", costTier: "free" },
      new Date("2026-04-05T16:02:00.000Z"),
    );

    expect(countryPlan[0]).toMatchObject({
      providerKey: "onlinesim",
      available: true,
      healthState: "healthy",
    });
    expect(countryPlan[0]?.availabilityIssue).toBeUndefined();
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

  it("retries providers whose list candidate only has an empty public pool penalty", async () => {
    const calls: string[] = [];
    const config = {
      ...createConfig(),
      strategy: {
        ...createConfig().strategy,
        providerStrategyModeId: "weighted-fallback",
      },
    };

    const service = new EasySmsService(
      config,
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => {
            calls.push("onlinesim");
            return [];
          },
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/unused",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteSuccess({
      providerKey: "onlinesim",
      providerDisplayName: "Fake Provider",
      routeKind: "list-public-numbers",
      scopeKind: "provider",
      scopeValue: "global",
    }, {
      detail: "recent empty",
      isEmpty: true,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });

    const result = await service.listPublicNumbers({ limit: 1 });

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(calls).toEqual(["onlinesim"]);
  });

  it("refreshes empty selection candidates when no providers are currently available", async () => {
    let listCalls = 0;
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async (options) => {
            listCalls += 1;
            expect(options.countryCode).toBe("+1");
            return [{
              providerKey: "onlinesim",
              providerDisplayName: "Fake Provider",
              numberId: "number-1",
              sourceUrl: "https://example.com/number",
              phoneNumber: "+10000000000",
              countryCode: "+1",
            }];
          },
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "number-1",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteSuccess({
      providerKey: "onlinesim",
      providerDisplayName: "Fake Provider",
      routeKind: "list-public-numbers",
      scopeKind: "country",
      scopeValue: "+1",
    }, {
      detail: "recent empty",
      isEmpty: true,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });

    const stalePlan = service.getListSelectionPlan({ countryCode: "+1", costTier: "free" });
    expect(stalePlan[0]).toMatchObject({
      providerKey: "onlinesim",
      available: false,
      healthState: "empty",
    });

    const refreshedPlan = await service.queryListSelectionPlan({ countryCode: "+1", costTier: "free" });

    expect(listCalls).toBe(1);
    expect(refreshedPlan[0]).toMatchObject({
      providerKey: "onlinesim",
      available: true,
      healthState: "healthy",
    });
  });

  it("refreshes stale empty selection candidates even when another provider is available", async () => {
    const calls: string[] = [];
    const firstDescriptor = {
      ...createDescriptor(),
      key: "onlinesim",
      displayName: "First Provider",
    } satisfies ProviderDescriptor;
    const recoveredDescriptor = {
      ...createDescriptor(),
      key: "receive_sms_free_cc",
      displayName: "Recovered Provider",
    } satisfies ProviderDescriptor;
    const service = new EasySmsService(
      {
        ...createConfig(),
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim", "receive_sms_free_cc"],
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
          recoveredDescriptor,
          async () => {
            calls.push("receive_sms_free_cc");
            return [{
              providerKey: "receive_sms_free_cc",
              providerDisplayName: "Recovered Provider",
              numberId: "recovered",
              sourceUrl: "https://example.com/recovered",
              phoneNumber: "+10000000002",
            }];
          },
          async () => ({
            providerKey: "receive_sms_free_cc",
            providerDisplayName: "Recovered Provider",
            numberId: "recovered",
            phoneNumber: "+10000000002",
            sourceUrl: "https://example.com/recovered",
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
      detail: "available",
      isEmpty: false,
      now: new Date("2026-04-05T15:00:00.000Z"),
    });
    service.operationalState.recordRouteSuccess({
      providerKey: "receive_sms_free_cc",
      providerDisplayName: "Recovered Provider",
      routeKind: "list-public-numbers",
      scopeKind: "provider",
      scopeValue: "global",
    }, {
      detail: "stale empty",
      isEmpty: true,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });

    const stalePlan = service.getListSelectionPlan({ costTier: "free" });
    expect(stalePlan.find((item) => item.providerKey === "receive_sms_free_cc")).toMatchObject({
      available: false,
      healthState: "empty",
    });

    const refreshedPlan = await service.queryListSelectionPlan({ costTier: "free" });

    expect(calls).toEqual(["receive_sms_free_cc"]);
    expect(refreshedPlan.find((item) => item.providerKey === "receive_sms_free_cc")).toMatchObject({
      available: true,
      healthState: "healthy",
    });
  });

  it("returns current selection candidates when stale empty refresh is slower than the foreground budget", async () => {
    vi.useFakeTimers();

    let releaseSlowRefresh: ((items: SmsPublicNumber[]) => void) | undefined;
    const slowRefresh = new Promise<SmsPublicNumber[]>((resolve) => {
      releaseSlowRefresh = resolve;
    });
    const firstDescriptor = {
      ...createDescriptor(),
      key: "onlinesim",
      displayName: "Available Provider",
    } satisfies ProviderDescriptor;
    const staleDescriptor = {
      ...createDescriptor(),
      key: "sms24",
      displayName: "Slow Empty Provider",
    } satisfies ProviderDescriptor;
    const service = new EasySmsService(
      {
        ...createConfig(),
        scraping: {
          ...createConfig().scraping,
          requestTimeoutMs: 50,
        },
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim", "sms24"],
        },
      },
      [
        new FakeSmsProvider(
          firstDescriptor,
          async () => [{
            providerKey: "onlinesim",
            providerDisplayName: "Available Provider",
            numberId: "available",
            sourceUrl: "https://example.com/available",
            phoneNumber: "+10000000001",
          }],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Available Provider",
            numberId: "available",
            phoneNumber: "+10000000001",
            sourceUrl: "https://example.com/available",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          staleDescriptor,
          async () => slowRefresh,
          async () => ({
            providerKey: "sms24",
            providerDisplayName: "Slow Empty Provider",
            numberId: "slow",
            phoneNumber: "+10000000002",
            sourceUrl: "https://example.com/slow",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.operationalState.recordRouteSuccess({
      providerKey: "sms24",
      providerDisplayName: "Slow Empty Provider",
      routeKind: "list-public-numbers",
      scopeKind: "provider",
      scopeValue: "global",
    }, {
      detail: "stale empty",
      isEmpty: true,
      now: new Date("2026-04-05T16:00:00.000Z"),
    });

    const planPromise = service.queryListSelectionPlan({ costTier: "free", limit: 2 });
    await vi.advanceTimersByTimeAsync(51);
    const result = await planPromise;

    releaseSlowRefresh?.([]);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({
      providerKey: "onlinesim",
      available: true,
    });
  });

  it("keeps completed request-scoped refresh results when another provider exceeds the foreground budget", async () => {
    vi.useFakeTimers();

    let releaseSlowRefresh: ((items: SmsPublicNumber[]) => void) | undefined;
    const slowRefresh = new Promise<SmsPublicNumber[]>((resolve) => {
      releaseSlowRefresh = resolve;
    });
    const fastDescriptor = {
      ...createDescriptor(),
      key: "onlinesim",
      displayName: "Fast Provider",
    } satisfies ProviderDescriptor;
    const slowDescriptor = {
      ...createDescriptor(),
      key: "sms24",
      displayName: "Slow Provider",
    } satisfies ProviderDescriptor;
    const rejectedNumber = {
      providerKey: "onlinesim",
      providerDisplayName: "Fast Provider",
      numberId: "rejected",
      sourceUrl: "https://example.com/rejected",
      phoneNumber: "+12025550123",
    } satisfies SmsPublicNumber;
    const service = new EasySmsService(
      {
        ...createConfig(),
        scraping: {
          ...createConfig().scraping,
          requestTimeoutMs: 50,
        },
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim", "sms24"],
        },
      },
      [
        new FakeSmsProvider(
          fastDescriptor,
          async () => [rejectedNumber],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fast Provider",
            numberId: "rejected",
            phoneNumber: "+12025550123",
            sourceUrl: "https://example.com/rejected",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
        new FakeSmsProvider(
          slowDescriptor,
          async () => slowRefresh,
          async () => ({
            providerKey: "sms24",
            providerDisplayName: "Slow Provider",
            numberId: "slow",
            phoneNumber: "+12025550124",
            sourceUrl: "https://example.com/slow",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    const planPromise = service.queryListSelectionPlan({
      costTier: "free",
      allowReuse: false,
      phoneBlacklist: [rejectedNumber.phoneNumber],
      limit: 2,
    });
    await vi.advanceTimersByTimeAsync(51);
    const result = await planPromise;

    releaseSlowRefresh?.([]);

    const fastCandidate = result.find((candidate) => candidate.providerKey === "onlinesim");
    expect(fastCandidate?.available).toBe(false);
    expect(fastCandidate?.availabilityIssue).toContain("No request-eligible public numbers");
  });

  it("lets request-scoped nonempty refresh override a stale mostly-empty probe trend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T13:01:00.000Z"));

    const descriptor = {
      ...createDescriptor(),
      key: "yunduanxin",
      displayName: "Recovered Provider",
    } satisfies ProviderDescriptor;
    const usableNumber = {
      providerKey: "yunduanxin",
      providerDisplayName: "Recovered Provider",
      numberId: "recovered",
      sourceUrl: "https://example.com/recovered",
      phoneNumber: "+3197010518996",
      countryCode: "+31",
    } satisfies SmsPublicNumber;
    const service = new EasySmsService(
      {
        ...createConfig(),
        maintenance: {
          ...createConfig().maintenance,
          probeHistoryMaxEntries: 20,
          probeHistoryWindowMs: 24 * 60 * 60 * 1000,
        },
        providers: {
          ...createConfig().providers,
          enabledProviders: ["yunduanxin"],
        },
      },
      [
        new FakeSmsProvider(
          descriptor,
          async () => [usableNumber],
          async () => ({
            providerKey: "yunduanxin",
            providerDisplayName: "Recovered Provider",
            numberId: "recovered",
            phoneNumber: "+3197010518996",
            sourceUrl: "https://example.com/recovered",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    for (let index = 0; index < 19; index += 1) {
      service.operationalState.recordProbeResult({
        providerKey: "yunduanxin",
        providerDisplayName: "Recovered Provider",
        ok: true,
        status: "active",
        healthState: "empty",
        healthScore: 1,
        routeKind: "list-public-numbers",
        checkedAt: new Date(Date.UTC(2026, 3, 5, 12, index)).toISOString(),
        detail: "probe found no public numbers",
      });
    }
    service.operationalState.recordProbeResult({
      providerKey: "yunduanxin",
      providerDisplayName: "Recovered Provider",
      ok: true,
      status: "active",
      healthState: "healthy",
      healthScore: 1,
      routeKind: "list-public-numbers",
      checkedAt: "2026-04-05T12:59:00.000Z",
      detail: "probe found one usable public number",
    });

    const plan = await service.queryListSelectionPlan({
      costTier: "free",
      allowReuse: false,
      limit: 1,
    }, new Date("2026-04-05T13:01:00.000Z"));

    expect(plan[0]).toMatchObject({
      providerKey: "yunduanxin",
      available: true,
    });
    expect(plan[0]?.availabilityIssue).toBeUndefined();
    expect(plan[0]?.notes).toContain("Request-scoped refresh found 1 usable public number.");
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

  it("probes HeroSMS non-destructively via activation-catalog and supports admin disable/enable/reset", async () => {
    const now = new Date("2026-05-15T10:00:00.000Z");
    const service = new EasySmsService(
      {
        ...createConfig(),
        providers: {
          ...createConfig().providers,
          enabledProviders: [],
          heroSms: {
            ...createConfig().providers.heroSms,
            enabled: true,
            apiKey: "paid-key",
            defaultService: "dr",
          },
        },
      },
      [],
    );

    (service as any).heroSmsActivationProvider = {
      descriptor: (service as any).heroSmsActivationProvider.descriptor,
      getTopCountriesByService: vi.fn(async () => [
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.4, count: 14, apiName: "United Kingdom" },
        { providerKey: "hero_sms", service: "dr", countryId: 36, price: 0.6, count: 8, apiName: "Canada" },
      ]),
    };

    const probeResult = await service.probeProvider("hero_sms", now);
    expect(probeResult).toMatchObject({
      providerKey: "hero_sms",
      ok: true,
      status: "active",
      healthState: "healthy",
      routeKind: "activation-catalog",
      publicNumberCount: 22,
    });

    const allResults = await service.probeAllProviders(now);
    expect(allResults.map((entry) => entry.providerKey)).toEqual(["hero_sms"]);

    const history = service.listProbeHistory({ providerKey: "hero_sms", routeKind: "activation-catalog" }, now);
    expect(history).toHaveLength(2);

    const disabled = service.disableProviderTemporarily("hero_sms", {
      reason: "maintenance_window",
      until: new Date("2099-05-15T11:00:00.000Z"),
      now,
    });
    expect(disabled.status).toBe("temporarily_disabled");

    const disabledPlan = await service.planSession({ service: "dr" }, { providerKey: "hero_sms", costTier: "paid" });
    expect(disabledPlan.planned).toBe(false);
    expect(disabledPlan.notes.join(" ")).toContain("temporarily disabled");

    await expect(
      service.createActivation({ service: "dr" }, { providerKey: "hero_sms", costTier: "paid" }),
    ).rejects.toThrow("temporarily disabled");

    const reenabled = service.enableProvider("hero_sms", now);
    expect(reenabled.status).toBe("active");

    const activePlan = await service.planSession({ service: "dr" }, { providerKey: "hero_sms", costTier: "paid" });
    expect(activePlan.planned).toBe(true);

    const reset = service.resetOperationalState("hero_sms", now);
    expect(reset.providers[0]?.providerKey).toBe("hero_sms");
    expect(reset.providers[0]?.healthState).toBe("unknown");
  });

  it("cools down HeroSMS on invalid API key errors and avoids falling back to unavailable paid or free tiers in planSession", async () => {
    const now = new Date("2026-05-15T12:00:00.000Z");
    const service = new EasySmsService(
      {
        ...createConfig(),
        providers: {
          ...createConfig().providers,
          enabledProviders: ["onlinesim"],
          heroSms: {
            ...createConfig().providers.heroSms,
            enabled: true,
            apiKey: "bad-paid-key",
            defaultService: "dr",
          },
        },
      },
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            capabilities: ["list-public-numbers", "read-public-inbox"],
          },
          async () => [],
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "unused",
            phoneNumber: "+10000000000",
            sourceUrl: "https://example.com/number",
            fetchedAtIso: now.toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    service.disableProviderTemporarily("onlinesim", {
      reason: "free_pool_maintenance",
      until: new Date("2099-05-15T13:00:00.000Z"),
      now,
    });

    const freeOnlyPlan = await service.planSession({ countryCode: "+1" }, { costTier: "free" });
    expect(freeOnlyPlan.planned).toBe(false);

    const fallbackToPaidPlan = await service.planSession({ countryCode: "+1" });
    expect(fallbackToPaidPlan).toMatchObject({
      planned: true,
      providerKey: "hero_sms",
      costTier: "paid",
      sessionMode: "paid-api",
    });

    (service as any).heroSmsActivationProvider = {
      descriptor: (service as any).heroSmsActivationProvider.descriptor,
      getTopCountriesByService: vi.fn(async () => {
        throw new Error("HeroSMS API key is invalid.");
      }),
    };

    const failedProbe = await service.probeProvider("hero_sms", now);
    expect(failedProbe).toMatchObject({
      providerKey: "hero_sms",
      ok: false,
      status: "cooling",
      healthState: "degraded",
      routeKind: "activation-catalog",
      cooldownApplied: true,
    });

    // Also record create-activation failure when an activation creation fails with auth error
    (service as any).heroSmsActivationProvider = {
      descriptor: (service as any).heroSmsActivationProvider.descriptor,
      getCountries: async () => [{ providerKey: "hero_sms", countryId: 16, apiName: "United Kingdom", dialCode: "+44" }],
      listCountryPrices: async () => [{ providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.4, count: 5, apiName: "United Kingdom", dialCode: "+44" }],
      getOperatorQuoteOptions: async () => [],
      createActivation: async () => {
        throw new Error("HeroSMS balance is insufficient.");
      },
    };

    await expect(
      service.createActivation({ service: "dr", country: 16 }, { providerKey: "hero_sms", costTier: "paid" }),
    ).rejects.toThrow("balance is insufficient");

    const bothUnavailablePlan = await service.planSession({ countryCode: "+44" });
    expect(bothUnavailablePlan.planned).toBe(false);
    expect(bothUnavailablePlan.notes.join(" ")).toContain("cooling");
  });

  it("redacts sensitive query secrets in probeProvider results and stored probe history", async () => {
    const now = new Date("2026-05-16T08:00:00.000Z");
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => {
            throw new Error(
              "Command failed: curl https://onlinesim.io/api/getFreeList?lang=en&apikey=super-secret-key",
            );
          },
          async () => {
            throw new Error("unused");
          },
        ),
      ],
    );

    const probe = await service.probeProvider("onlinesim", now);
    expect(probe.detail).toContain("apikey=<redacted>");
    expect(probe.detail).not.toContain("super-secret-key");

    const history = service.operationalState.listProbeHistory({ providerKey: "onlinesim" }, now);
    expect(history[0]?.detail).toContain("apikey=<redacted>");
    expect(history[0]?.detail).not.toContain("super-secret-key");
  });

  it("caches and deduplicates synthetic facade country projections and invalidates on operational reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T09:00:00.000Z"));

    let listCalls = 0;
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            capabilities: ["list-public-numbers", "read-public-inbox"],
          },
          async () => {
            listCalls += 1;
            return [{
              providerKey: "onlinesim",
              providerDisplayName: "Fake Provider",
              numberId: "num-us-1",
              sourceUrl: "https://example.com/us-1",
              phoneNumber: "+12025550111",
              countryCode: "+1",
              countryName: "United States",
            }];
          },
          async () => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId: "num-us-1",
            phoneNumber: "+12025550111",
            sourceUrl: "https://example.com/us-1",
            fetchedAtIso: new Date().toISOString(),
            messages: [],
          }),
        ),
      ],
    );

    const [countries, prices] = await Promise.all([
      service.listFacadeCountries({ costTier: "free" }),
      service.getFacadePrices("public-web-sms", { costTier: "free" }),
    ]);

    expect(listCalls).toBe(1);
    expect(countries).toHaveLength(1);
    expect(Object.keys(prices["public-web-sms"] ?? {})).toHaveLength(1);

    await service.listFacadeTopCountries("public-web-sms", true, { costTier: "free" });
    expect(listCalls).toBe(1);

    service.resetOperationalState("onlinesim");
    await service.listFacadeCountries({ costTier: "free" });
    expect(listCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(31_000);
    await service.listFacadeCountries({ costTier: "free" });
    expect(listCalls).toBe(3);
  });

  it("prunes terminal sessions beyond keepRecentCount while retaining active and cooldown-protected sessions", async () => {
    const config: EasySmsRuntimeConfig = {
      ...createConfig(),
      maintenance: {
        ...createConfig().maintenance,
        keepRecentCount: 1,
      },
      providers: {
        ...createConfig().providers,
        synthetic: {
          ...createConfig().providers.synthetic,
          leaseWindowSeconds: 60,
          terminalOutcomeCooldownSeconds: 600,
        },
      },
    };

    let counter = 0;
    const service = new EasySmsService(
      config,
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            capabilities: ["list-public-numbers", "read-public-inbox", "synthetic-activation"],
          },
          async () => {
            counter += 1;
            const phoneNumber = `+1202555010${counter}`;
            const sourceUrl = `https://example.com/num-${counter}`;
            return [{
              providerKey: "onlinesim",
              providerDisplayName: "Fake Provider",
              numberId: encodeNumberId({
                providerKey: "onlinesim",
                sourceUrl,
                phoneNumber,
                countryCode: "+1",
                countryName: "United States",
              }),
              sourceUrl,
              phoneNumber,
              countryCode: "+1",
              countryName: "United States",
            }];
          },
          async (numberId) => ({
            providerKey: "onlinesim",
            providerDisplayName: "Fake Provider",
            numberId,
            phoneNumber: "+12025550101",
            sourceUrl: `https://example.com/${numberId}`,
            fetchedAtIso: "2026-05-16T10:00:00.000Z",
            messages: [],
          }),
        ),
      ],
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00.000Z"));
    const oldestClosed = await service.openSession({ service: "test-svc", allowReuse: false });
    await service.setActivationStatus(oldestClosed.activationId, "cancel");

    vi.setSystemTime(new Date("2026-05-16T10:01:00.000Z"));
    const cooldownProtected = await service.openSession({ service: "test-svc", allowReuse: false });
    service.reportSessionOutcome({
      sessionId: cooldownProtected.id,
      success: false,
      failureReason: "phone_number_in_use",
      detail: "Rejected by target site",
    });
    await service.setActivationStatus(cooldownProtected.activationId, "cancel");

    vi.setSystemTime(new Date("2026-05-16T10:02:00.000Z"));
    const newestKept = await service.openSession({ service: "test-svc", allowReuse: false });
    await service.setActivationStatus(newestKept.activationId, "complete");

    expect(service.managedSessions.size).toBe(3);

    const maintenanceTime = new Date("2026-05-16T10:05:00.000Z");
    service.runMaintenance(maintenanceTime);

    const remainingIds = Array.from(service.managedSessions.values()).map((item) => item.activationId);
    expect(remainingIds).not.toContain(oldestClosed.activationId);
    expect(remainingIds).toContain(cooldownProtected.activationId);
    expect(remainingIds).toContain(newestKept.activationId);
  });
});
