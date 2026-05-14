import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EasySmsRuntimeConfig,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  HeroSmsActivationSession,
  HeroSmsActivationStatusSnapshot,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../src/domain/models.js";
import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import type { SmsProvider } from "../../src/providers/contracts.js";
import { encodeNumberId } from "../../src/shared/index.js";
import { EasySmsService } from "../../src/service/easy-sms-service.js";

function createConfig(): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    providers: {
      ...defaultEasySmsRuntimeConfig.providers,
      enabledProviders: [],
      heroSms: {
        ...defaultEasySmsRuntimeConfig.providers.heroSms,
        enabled: true,
        apiKey: "paid-test-key",
      },
    },
  };
}

function buildProviderActivation(
  input: HeroSmsActivationCreateInput,
  activationId = 555,
): HeroSmsActivationSession {
  return {
    providerKey: "hero_sms",
    activationId,
    phoneNumber: "+447700900123",
    service: String(input.service ?? "dr"),
    countryId: Number(input.country ?? 16),
    countryCode: "+44",
    countryName: "United Kingdom",
    operator: input.operator,
    activationCost: 0.4,
    costTier: "paid",
    sessionMode: "paid-api",
    createdAtIso: new Date().toISOString(),
  };
}

class FakeFreeProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor = {
    key: "onlinesim",
    displayName: "OnlineSIM Free Numbers",
    homepageUrl: "https://example.com/onlinesim",
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox", "create-activation", "get-activation-status", "set-activation-status"],
    enabled: true,
    countryHints: ["United Kingdom"],
    notes: [],
  };

  async listPublicNumbers(_options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    return [{
      providerKey: "onlinesim",
      providerDisplayName: "OnlineSIM Free Numbers",
      numberId: encodeNumberId({
        providerKey: "onlinesim",
        sourceUrl: "https://example.com/number/1",
        phoneNumber: "+447700900123",
        countryCode: "+44",
        countryName: "United Kingdom",
      }),
      sourceUrl: "https://example.com/number/1",
      phoneNumber: "+447700900123",
      countryCode: "+44",
      countryName: "United Kingdom",
      latestActivityText: "1 minute ago",
    }];
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    return {
      providerKey: "onlinesim",
      providerDisplayName: "OnlineSIM Free Numbers",
      numberId,
      phoneNumber: "+447700900123",
      sourceUrl: "https://example.com/number/1",
      countryCode: "+44",
      countryName: "United Kingdom",
      fetchedAtIso: new Date().toISOString(),
      messages: [{
        id: "free-1",
        sender: "Example",
        receivedAtText: "1 minute ago",
        receivedAtIso: new Date().toISOString(),
        content: "Your verification code is 123456",
        sourceUrl: "https://example.com/number/1",
      }],
    };
  }
}

describe("HeroSMS paid activation strategy and lease reuse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T08:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects the cheapest operator quote when price-first is requested", async () => {
    const service = new EasySmsService(createConfig(), []);
    const createCalls: HeroSmsActivationCreateInput[] = [];

    (service as any).heroSmsActivationProvider = {
      getCountries: async () => [],
      listCountryPrices: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.8, count: 4, apiName: "United Kingdom", dialCode: "+44" },
      ]),
      getOperatorQuoteOptions: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, operator: "vodafone", price: 0.7, count: 2 },
        { providerKey: "hero_sms", service: "dr", countryId: 16, operator: "o2", price: 0.4, count: 9 },
      ]),
      createActivation: async (input: HeroSmsActivationCreateInput) => {
        createCalls.push(input);
        return buildProviderActivation(input, 555);
      },
      getActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: false,
      }),
      setActivationStatus: async (_activationId: number, action: HeroSmsActivationAction) => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: action,
        requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
        resultText: "OK",
        updatedAtIso: new Date().toISOString(),
      }),
    };

    const activation = await service.createActivation(
      {
        service: "dr",
        selectionMode: "price-first",
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      service: "dr",
      country: 16,
      operator: "o2",
    });
    expect(activation.activationId).not.toBe(555);
    expect(activation.upstreamActivationId).toBe(555);
    expect(activation.selectionMode).toBe("price-first");
  });

  it("reuses the same paid lease for the same business while bindings remain", async () => {
    const service = new EasySmsService(createConfig(), []);
    const createCalls: HeroSmsActivationCreateInput[] = [];
    let baselineStatusCalls = 0;

    (service as any).heroSmsActivationProvider = {
      getCountries: async () => [],
      listCountryPrices: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.8, count: 4, apiName: "United Kingdom", dialCode: "+44" },
      ]),
      getOperatorQuoteOptions: async () => [],
      createActivation: async (input: HeroSmsActivationCreateInput) => {
        createCalls.push(input);
        return buildProviderActivation(input, 555);
      },
      getActivationStatus: async (): Promise<HeroSmsActivationStatusSnapshot> => {
        baselineStatusCalls += 1;
        return {
          providerKey: "hero_sms",
          activationId: 555,
          fetchedAtIso: new Date().toISOString(),
          received: false,
          cancelled: false,
        };
      },
      setActivationStatus: async (_activationId: number, action: HeroSmsActivationAction) => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: action,
        requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
        resultText: "OK",
        updatedAtIso: new Date().toISOString(),
      }),
    };

    const first = await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
        maxBindingsPerPhone: 3,
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    vi.advanceTimersByTime(45_000);

    const second = await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
        maxBindingsPerPhone: 3,
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    expect(createCalls).toHaveLength(1);
    expect(baselineStatusCalls).toBeGreaterThanOrEqual(1);
    expect(first.activationId).not.toBe(second.activationId);
    expect(first.upstreamActivationId).toBe(555);
    expect(second.upstreamActivationId).toBe(555);
    expect(second.assignmentIndex).toBe(2);
    expect(second.maxBindingsPerPhone).toBe(3);
  });

  it("prefers free synthetic routing over reusable paid leases and reuses free seats for the same business", async () => {
    const service = new EasySmsService(createConfig(), [new FakeFreeProvider()]);
    const createCalls: HeroSmsActivationCreateInput[] = [];

    (service as any).heroSmsActivationProvider = {
      getCountries: async () => [],
      listCountryPrices: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.8, count: 4, apiName: "United Kingdom", dialCode: "+44" },
      ]),
      getOperatorQuoteOptions: async () => [],
      createActivation: async (input: HeroSmsActivationCreateInput) => {
        createCalls.push(input);
        return buildProviderActivation(input, 555);
      },
      getActivationStatus: async (): Promise<HeroSmsActivationStatusSnapshot> => ({
        providerKey: "hero_sms",
        activationId: 555,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: false,
      }),
      setActivationStatus: async (_activationId: number, action: HeroSmsActivationAction) => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: action,
        requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
        resultText: "OK",
        updatedAtIso: new Date().toISOString(),
      }),
    };

    await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
        maxBindingsPerPhone: 3,
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    vi.advanceTimersByTime(20_000);

    const plan = await service.planSession({
      service: "dr",
      allowReuse: true,
      businessKey: "openai-bind",
      maxBindingsPerPhone: 3,
    } as HeroSmsActivationCreateInput);
    expect(plan).toMatchObject({
      planned: true,
      providerKey: "onlinesim",
      costTier: "free",
      sessionMode: "synthetic-public-inbox",
    });
    expect(plan.notes.join(" ").toLowerCase()).toContain("free");

    const first = await service.createActivation({
      service: "dr",
      allowReuse: true,
      businessKey: "openai-bind",
      maxBindingsPerPhone: 3,
    } as HeroSmsActivationCreateInput);

    expect(createCalls).toHaveLength(1);
    expect(first.providerKey).toBe("onlinesim");
    expect(first.costTier).toBe("free");
    expect(first.assignmentIndex).toBe(1);

    const reusePlan = await service.planSession({
      service: "dr",
      allowReuse: true,
      businessKey: "openai-bind",
      maxBindingsPerPhone: 3,
    } as HeroSmsActivationCreateInput);
    expect(reusePlan).toMatchObject({
      planned: true,
      providerKey: "onlinesim",
      costTier: "free",
      sessionMode: "synthetic-public-inbox",
    });
    expect(reusePlan.notes.join(" ").toLowerCase()).toContain("reuse");

    const second = await service.createActivation({
      service: "dr",
      allowReuse: true,
      businessKey: "openai-bind",
      maxBindingsPerPhone: 3,
    } as HeroSmsActivationCreateInput);

    expect(createCalls).toHaveLength(1);
    expect(second.providerKey).toBe("onlinesim");
    expect(second.costTier).toBe("free");
    expect(second.assignmentIndex).toBe(2);
    expect(second.numberId).toBe(first.numberId);
  });

  it("filters reused assignments so baseline old codes are not re-delivered", async () => {
    const service = new EasySmsService(createConfig(), []);
    let statusMode: "baseline" | "old" | "new" = "baseline";

    (service as any).heroSmsActivationProvider = {
      getCountries: async () => [],
      listCountryPrices: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.8, count: 4, apiName: "United Kingdom", dialCode: "+44" },
      ]),
      getOperatorQuoteOptions: async () => [],
      createActivation: async (input: HeroSmsActivationCreateInput) => buildProviderActivation(input, 555),
      getActivationStatus: async (): Promise<HeroSmsActivationStatusSnapshot> => {
        if (statusMode === "baseline" || statusMode === "old") {
          return {
            providerKey: "hero_sms",
            activationId: 555,
            fetchedAtIso: new Date().toISOString(),
            received: true,
            cancelled: false,
            code: "469021",
            text: "[LeetCode力扣]您的注册验证码为：469021",
            receivedAtIso: "2026-05-13T08:00:10.000Z",
          };
        }

        return {
          providerKey: "hero_sms",
          activationId: 555,
          fetchedAtIso: new Date().toISOString(),
          received: true,
          cancelled: false,
          code: "654321",
          text: "Your code is 654321",
          receivedAtIso: "2026-05-13T08:02:20.000Z",
        };
      },
      setActivationStatus: async (_activationId: number, action: HeroSmsActivationAction) => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: action,
        requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
        resultText: "OK",
        updatedAtIso: new Date().toISOString(),
      }),
    };

    await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
        maxBindingsPerPhone: 3,
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    vi.advanceTimersByTime(30_000);

    const reused = await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
        maxBindingsPerPhone: 3,
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    statusMode = "old";
    const oldStatus = await service.getActivationStatus(reused.activationId, { providerKey: "hero_sms", costTier: "paid" });
    expect(oldStatus.received).toBe(false);
    expect(oldStatus.code).toBeUndefined();

    statusMode = "new";
    const newStatus = await service.getActivationStatus(reused.activationId, { providerKey: "hero_sms", costTier: "paid" });
    expect(newStatus.received).toBe(true);
    expect(newStatus.code).toBe("654321");
  });

  it("marks cancel actions as refund-eligible only after the 2-minute threshold with no received code", async () => {
    const service = new EasySmsService(createConfig(), []);
    const cancelCalls: Array<{ activationId: number; action: HeroSmsActivationAction }> = [];

    (service as any).heroSmsActivationProvider = {
      getCountries: async () => [],
      listCountryPrices: async () => ([
        { providerKey: "hero_sms", service: "dr", countryId: 16, price: 0.8, count: 4, apiName: "United Kingdom", dialCode: "+44" },
      ]),
      getOperatorQuoteOptions: async () => [],
      createActivation: async (input: HeroSmsActivationCreateInput) => buildProviderActivation(input, 555),
      getActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        fetchedAtIso: new Date().toISOString(),
        received: false,
        cancelled: false,
      }),
      setActivationStatus: async (activationId: number, action: HeroSmsActivationAction) => {
        cancelCalls.push({ activationId, action });
        return {
          providerKey: "hero_sms",
          activationId,
          requestedAction: action,
          requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
          resultText: "ACCESS_CANCEL",
          updatedAtIso: new Date().toISOString(),
        };
      },
    };

    const activation = await service.createActivation(
      {
        service: "dr",
        allowReuse: true,
        businessKey: "openai-bind",
      } as HeroSmsActivationCreateInput,
      { providerKey: "hero_sms", costTier: "paid" },
    );

    expect(activation.refundableCancelAvailableAtIso).toBe("2026-05-13T08:02:00.000Z");

    vi.advanceTimersByTime(121_000);

    const result = await service.setActivationStatus(activation.activationId, "cancel", {
      providerKey: "hero_sms",
      costTier: "paid",
    });

    expect(cancelCalls).toEqual([{ activationId: 555, action: "cancel" }]);
    expect(result.refundEligible).toBe(true);

    const status = await service.getActivationStatus(activation.activationId, {
      providerKey: "hero_sms",
      costTier: "paid",
    });
    expect(status.cancelled).toBe(true);
    expect(status.refundEligible).toBe(true);

    const stats = service.getPersistenceStats();
    expect(stats.heroSmsPaidLeaseCount).toBe(1);
    expect(stats.heroSmsSelectionStats).toHaveLength(1);
    expect(stats.heroSmsSelectionStats[0]).toMatchObject({
      providerKey: "hero_sms",
      service: "dr",
      countryId: 16,
      failureCount: 1,
      refundedCancelCount: 1,
      successRate: 0,
    });
  });
});
