import { describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import {
  resolveProviderRequestTimeoutMs,
  withProviderRequestTimeout,
} from "../../src/shared/index.js";

describe("provider-specific request timeouts", () => {
  it("uses a longer default timeout for slow logged-in providers", () => {
    expect(resolveProviderRequestTimeoutMs(defaultEasySmsRuntimeConfig, "smstome")).toBe(75_000);
    expect(resolveProviderRequestTimeoutMs(defaultEasySmsRuntimeConfig, "receive_smss")).toBe(30_000);
    expect(resolveProviderRequestTimeoutMs(defaultEasySmsRuntimeConfig, "receive_sms_free_cc")).toBe(30_000);
    expect(resolveProviderRequestTimeoutMs(defaultEasySmsRuntimeConfig, "onlinesim")).toBe(15_000);
  });

  it("lets config override a provider default without mutating the base config", () => {
    const config = {
      ...defaultEasySmsRuntimeConfig,
      scraping: {
        ...defaultEasySmsRuntimeConfig.scraping,
        requestTimeoutMs: 15_000,
        providerRequestTimeoutMs: {
          smstome: 90_000,
        },
      },
    };

    const providerConfig = withProviderRequestTimeout(config, "smstome");

    expect(providerConfig.scraping.requestTimeoutMs).toBe(90_000);
    expect(config.scraping.requestTimeoutMs).toBe(15_000);
  });
});
