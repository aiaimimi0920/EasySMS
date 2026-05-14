import { describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { createEasySmsService } from "../../src/service/easy-sms-service.js";

describe("EasySMS defaults", () => {
  it("exposes the enabled public SMS providers by default", () => {
    const service = createEasySmsService(defaultEasySmsRuntimeConfig);
    const providerKeys = service.listProviders().map((provider) => provider.key);

    expect(providerKeys).toEqual(["onlinesim", "smstome", "receive_smss", "receive_sms_free_cc", "sms24", "yunduanxin"]);
  });

  it("does not re-enable deprecated free providers just because legacy keys are present in config", () => {
    const service = createEasySmsService({
      ...defaultEasySmsRuntimeConfig,
      providers: {
        ...defaultEasySmsRuntimeConfig.providers,
        enabledProviders: ["onlinesim", "quackr"],
      },
    });

    expect(service.listProviders().map((provider) => provider.key)).toEqual(["onlinesim"]);
  });

  it("allows receive_sms_free_cc to join the runtime provider catalog when explicitly enabled", () => {
    const service = createEasySmsService({
      ...defaultEasySmsRuntimeConfig,
      providers: {
        ...defaultEasySmsRuntimeConfig.providers,
        enabledProviders: ["onlinesim", "smstome", "receive_smss", "receive_sms_free_cc", "sms24", "yunduanxin"],
      },
    });

    expect(service.listProviders().map((provider) => provider.key)).toEqual([
      "onlinesim",
      "smstome",
      "receive_smss",
      "receive_sms_free_cc",
      "sms24",
      "yunduanxin",
    ]);
  });

  it("ships browser-like scraping defaults", () => {
    expect(defaultEasySmsRuntimeConfig.scraping.requestTimeoutMs).toBeGreaterThan(0);
    expect(defaultEasySmsRuntimeConfig.scraping.maxNumbersPerProvider).toBeGreaterThan(0);
    expect(defaultEasySmsRuntimeConfig.scraping.userAgent).toContain("Mozilla/5.0");
  });
});
