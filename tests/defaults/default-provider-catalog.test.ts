import { describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { createEasySmsService } from "../../src/service/easy-sms-service.js";

describe("EasySMS defaults", () => {
  it("exposes the enabled public SMS providers by default", () => {
    const service = createEasySmsService(defaultEasySmsRuntimeConfig);
    const providerKeys = service.listProviders().map((provider) => provider.key);

    expect(providerKeys).toContain("freephonenum");
    expect(providerKeys).toContain("jiemahao");
    expect(providerKeys).toContain("onlinesim");
    expect(providerKeys).toContain("quackr");
    expect(providerKeys).toContain("receivesms_co");
    expect(providerKeys).toContain("receive_smss");
    expect(providerKeys).toContain("temp_number");
    expect(providerKeys).toContain("temporary_phone_number");
    expect(providerKeys).toContain("receive_sms_free_cc");
    expect(providerKeys).toContain("yunduanxin");
    expect(providerKeys).toContain("sms24");
  });

  it("ships browser-like scraping defaults", () => {
    expect(defaultEasySmsRuntimeConfig.scraping.requestTimeoutMs).toBeGreaterThan(0);
    expect(defaultEasySmsRuntimeConfig.scraping.maxNumbersPerProvider).toBeGreaterThan(0);
    expect(defaultEasySmsRuntimeConfig.scraping.userAgent).toContain("Mozilla/5.0");
  });
});
