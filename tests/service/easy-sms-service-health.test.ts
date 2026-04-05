import { describe, expect, it } from "vitest";

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
      enabledProviders: ["freephonenum"],
    },
  };
}

function createDescriptor(): ProviderDescriptor {
  return {
    key: "freephonenum",
    displayName: "Fake Provider",
    homepageUrl: "https://example.com",
    sourceType: "public-web-scrape",
    capabilities: ["list-public-numbers"],
    enabled: true,
    countryHints: [],
    notes: [],
  };
}

describe("EasySmsService health integration", () => {
  it("marks empty probes as empty instead of failed", async () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider(
          createDescriptor(),
          async () => [],
          async () => ({
            providerKey: "freephonenum",
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

    const result = await service.probeProvider("freephonenum", new Date("2026-04-05T13:00:00.000Z"));

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
            providerKey: "freephonenum",
            providerDisplayName: "Fake Provider",
            numberId: "abc",
            sourceUrl: "https://example.com/number",
            phoneNumber: "+10000000000",
          }],
          async () => ({
            providerKey: "freephonenum",
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

    service.disableProviderTemporarily("freephonenum", {
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

    const result = await service.probeProvider("freephonenum", new Date("2026-04-05T15:00:00.000Z"));

    expect(result.ok).toBe(false);
    expect(result.healthState).toBe("challenge");
    expect(result.cooldownApplied).toBe(true);
  });

  it("ranks healthier providers ahead of recently empty ones", async () => {
    const firstDescriptor = {
      ...createDescriptor(),
      key: "freephonenum",
      displayName: "First Provider",
    } satisfies ProviderDescriptor;
    const secondDescriptor = {
      ...createDescriptor(),
      key: "quackr",
      displayName: "Second Provider",
    } satisfies ProviderDescriptor;

    const service = new EasySmsService(
      {
        ...createConfig(),
        providers: {
          enabledProviders: ["freephonenum", "quackr"],
        },
      },
      [
        new FakeSmsProvider(
          firstDescriptor,
          async () => [{
            providerKey: "freephonenum",
            providerDisplayName: "First Provider",
            numberId: "first",
            sourceUrl: "https://example.com/first",
            phoneNumber: "+10000000001",
          }],
          async () => ({
            providerKey: "freephonenum",
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
            providerKey: "quackr",
            providerDisplayName: "Second Provider",
            numberId: "second",
            sourceUrl: "https://example.com/second",
            phoneNumber: "+10000000002",
          }],
          async () => ({
            providerKey: "quackr",
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
      providerKey: "freephonenum",
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

    expect(plan[0]?.providerKey).toBe("quackr");
    expect(plan[1]?.providerKey).toBe("freephonenum");
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
        enabledProviders: ["freephonenum", "quackr", "receivesms_co"],
      },
    };

    const service = new EasySmsService(
      config,
      [
        new FakeSmsProvider(
          {
            ...createDescriptor(),
            key: "freephonenum",
            displayName: "First Provider",
          },
          async () => {
            calls.push("freephonenum");
            return [];
          },
          async () => ({
            providerKey: "freephonenum",
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
            key: "quackr",
            displayName: "Second Provider",
          },
          async () => {
            calls.push("quackr");
            return [{
              providerKey: "quackr",
              providerDisplayName: "Second Provider",
              numberId: "second",
              sourceUrl: "https://example.com/second",
              phoneNumber: "+10000000002",
            }];
          },
          async () => ({
            providerKey: "quackr",
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
            key: "receivesms_co",
            displayName: "Third Provider",
          },
          async () => {
            calls.push("receivesms_co");
            return [{
              providerKey: "receivesms_co",
              providerDisplayName: "Third Provider",
              numberId: "third",
              sourceUrl: "https://example.com/third",
              phoneNumber: "+10000000003",
            }];
          },
          async () => ({
            providerKey: "receivesms_co",
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

    expect(result.items.map((item) => item.providerKey)).toEqual(["quackr"]);
    expect(calls).toEqual(["freephonenum", "quackr"]);
  });

  it("uses probe trend penalties to demote unstable providers", () => {
    const firstDescriptor = {
      ...createDescriptor(),
      key: "freephonenum",
      displayName: "First Provider",
    } satisfies ProviderDescriptor;
    const secondDescriptor = {
      ...createDescriptor(),
      key: "quackr",
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
          enabledProviders: ["freephonenum", "quackr"],
        },
      },
      [
        new FakeSmsProvider(
          firstDescriptor,
          async () => [],
          async () => ({
            providerKey: "freephonenum",
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
            providerKey: "quackr",
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
      providerKey: "freephonenum",
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
      providerKey: "freephonenum",
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

    expect(plan[0]?.providerKey).toBe("quackr");
    expect(plan[1]?.providerKey).toBe("freephonenum");
    expect(plan[1]?.trendPenalty).toBeGreaterThan(0);
  });
});
