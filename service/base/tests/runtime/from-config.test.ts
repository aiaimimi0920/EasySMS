import { describe, expect, it } from "vitest";

import { mergeEasySmsConfig } from "../../src/runtime/from-config.js";

describe("runtime config merge", () => {
  it("treats onlineSim auth as apiKey-only", () => {
    const config = mergeEasySmsConfig({
      providers: {
        onlineSim: {
          apiKey: "demo-key",
          email: "legacy@example.com",
          password: "legacy-password",
        },
      },
    });

    expect(config.providers.onlineSim).toEqual({
      apiKey: "demo-key",
    });
  });

  it("merges smsToMe credentials from config", () => {
    const config = mergeEasySmsConfig({
      providers: {
        smsToMe: {
          email: "vmjcv666@gmail.com",
          password: "Qq365210!@#$%^",
        },
      },
    });

    expect(config.providers.smsToMe).toEqual({
      email: "vmjcv666@gmail.com",
      password: "Qq365210!@#$%^",
    });
  });

  it("merges heroSms strategy and reuse settings from config", () => {
    const config = mergeEasySmsConfig({
      providers: {
        heroSms: {
          enabled: true,
          apiKey: "paid-key",
          selectionMode: "success-first",
          reuseEnabled: true,
          defaultMaxBindingsPerPhone: 3,
          refundableCancelWindowSeconds: 120,
          leaseWindowSeconds: 1200,
        },
      },
    });

    expect(config.providers.heroSms).toMatchObject({
      enabled: true,
      apiKey: "paid-key",
      selectionMode: "success-first",
      reuseEnabled: true,
      defaultMaxBindingsPerPhone: 3,
      refundableCancelWindowSeconds: 120,
      leaseWindowSeconds: 1200,
    });
  });

  it("merges synthetic public-inbox lease and outcome cooldown settings from config", () => {
    const config = mergeEasySmsConfig({
      providers: {
        synthetic: {
          leaseWindowSeconds: 900,
          terminalOutcomeCooldownSeconds: 1800,
        },
      },
    });

    expect(config.providers.synthetic).toEqual({
      leaseWindowSeconds: 900,
      terminalOutcomeCooldownSeconds: 1800,
    });
  });
});
