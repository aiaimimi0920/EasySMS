import { describe, expect, it } from "vitest";

import type {
  EasySmsRuntimeConfig,
  ListPublicNumbersOptions,
  ProviderDescriptor,
  SmsInboxSnapshot,
  SmsPublicNumber,
} from "../../src/domain/models.js";
import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import type { SmsProvider } from "../../src/providers/contracts.js";
import { EasySmsService } from "../../src/service/easy-sms-service.js";

class FakeSmsProvider implements SmsProvider {
  readonly descriptor: ProviderDescriptor;

  public constructor(descriptor: ProviderDescriptor) {
    this.descriptor = descriptor;
  }

  async listPublicNumbers(_options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    return [];
  }

  async getInbox(_numberId: string): Promise<SmsInboxSnapshot> {
    return {
      providerKey: "onlinesim",
      providerDisplayName: "unused",
      numberId: "unused",
      phoneNumber: "+10000000000",
      sourceUrl: "https://example.com",
      fetchedAtIso: new Date().toISOString(),
      messages: [],
    };
  }
}

function createConfig(): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    providers: {
      ...defaultEasySmsRuntimeConfig.providers,
      enabledProviders: ["onlinesim"],
      heroSms: {
        ...defaultEasySmsRuntimeConfig.providers.heroSms,
        enabled: true,
        apiKey: "test-key",
      },
    },
  };
}

describe("EasySms provider catalog", () => {
  it("treats free and paid as provider attributes instead of a separate provider layer", () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider({
          key: "onlinesim",
          displayName: "Free Provider",
          homepageUrl: "https://example.com/free",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["list-public-numbers", "read-public-inbox"],
          enabled: true,
          countryHints: [],
          notes: [],
        }),
        new FakeSmsProvider({
          key: "sms24",
          displayName: "List Only Provider",
          homepageUrl: "https://example.com/list-only",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["list-public-numbers"],
          enabled: true,
          countryHints: [],
          notes: [],
        }),
      ],
    );

    const allProviders = service.listProviders();
    const freeProviders = service.listProviders({ costTier: "free" });
    const paidProviders = service.listProviders({ costTier: "paid" });
    const activationProviders = service.listProviders({ capability: "create-activation" });

    expect(allProviders.map((item) => item.key)).toContain("onlinesim");
    expect(allProviders.map((item) => item.key)).toContain("sms24");
    expect(allProviders.map((item) => item.key)).toContain("hero_sms");
    expect(freeProviders.map((item) => item.key)).toEqual(["onlinesim", "sms24"]);
    expect(paidProviders.map((item) => item.key)).toEqual(["hero_sms"]);
    expect(activationProviders.map((item) => item.key)).toEqual(["onlinesim", "hero_sms"]);
  });

  it("includes paid activation providers in provider health summaries", () => {
    const service = new EasySmsService(
      createConfig(),
      [
        new FakeSmsProvider({
          key: "onlinesim",
          displayName: "Free Provider",
          homepageUrl: "https://example.com/free",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["list-public-numbers", "read-public-inbox"],
          enabled: true,
          countryHints: [],
          notes: [],
        }),
      ],
    );

    const providerKeys = service.listProviders().map((item) => item.key);
    const healthKeys = service.listProviderHealth().map((item) => item.providerKey);
    const summary = service.getHealthSummary();
    const runtimeSnapshotProviderKeys = service.getRuntimeStateSnapshot().providers.map((item) => item.providerKey);

    expect(providerKeys).toEqual(["onlinesim", "hero_sms"]);
    expect(healthKeys).toEqual(["onlinesim", "hero_sms"]);
    expect(runtimeSnapshotProviderKeys).toEqual(["onlinesim", "hero_sms"]);
    expect(summary.totalProviders).toBe(2);
    expect(summary.activeCount).toBe(2);
  });
});
