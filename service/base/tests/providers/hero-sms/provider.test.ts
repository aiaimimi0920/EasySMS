import { describe, expect, test, vi } from "vitest";

import {
  HeroSmsActivationProvider,
  extractHeroSmsCountryPrice,
  normalizeHeroSmsActivationResponse,
  normalizeHeroSmsStatusResponse,
  parseHeroSmsCountriesResponse,
  parseHeroSmsTopCountriesResponse,
} from "../../../src/activation-providers/hero_sms/index.js";

describe("hero_sms provider helpers", () => {
  test("parses countries response from object map", () => {
    const countries = parseHeroSmsCountriesResponse({
      16: { id: 16, chn: "英国", eng: "United Kingdom", visible: 1, retry: 1 },
      2: { id: 2, chn: "哈萨克斯坦", eng: "Kazakhstan", phoneCode: "7" },
    });

    expect(countries).toHaveLength(2);
    expect(countries[0]).toMatchObject({
      countryId: 2,
      apiName: "哈萨克斯坦",
      dialCode: "+7",
    });
    expect(countries[1]).toMatchObject({
      countryId: 16,
      apiName: "英国",
      visible: true,
      retry: true,
    });
  });

  test("parses top countries and sorts by price then count", () => {
    const rows = parseHeroSmsTopCountriesResponse(
      {
        16: { country: 16, name: "United Kingdom", price: 0.8, count: 4, phoneCode: "44" },
        2: { country: 2, name: "Kazakhstan", price: 0.4, count: 2, phoneCode: "7" },
      },
      "dr",
    );

    expect(rows[0]).toMatchObject({
      service: "dr",
      countryId: 2,
      price: 0.4,
      dialCode: "+7",
    });
    expect(rows[1].countryId).toBe(16);
  });

  test("extracts one country price from nested service matrix", () => {
    const quote = extractHeroSmsCountryPrice(
      {
        dr: {
          16: {
            cost: 0.63,
            count: 11,
          },
        },
      },
      16,
      "dr",
    );

    expect(quote).toMatchObject({
      countryId: 16,
      service: "dr",
      price: 0.63,
      count: 11,
    });
  });

  test("lists normalized country prices from the raw price matrix", async () => {
    const provider = new HeroSmsActivationProvider({
      server: { host: "127.0.0.1", port: 8080 },
      strategy: { strictProviderMode: false, providerStrategyModeId: "aggregate-latest" },
      maintenance: { enabled: false, intervalMs: 30000, keepRecentCount: 100, activeProbeEnabled: false, activeProbeIntervalMs: 300000, probeHistoryMaxEntries: 24, probeHistoryWindowMs: 86400000 },
      persistence: { enabled: false, driver: "file", intervalMs: 60000, filePath: "state.json" },
      scraping: { requestTimeoutMs: 15000, maxNumbersPerProvider: 20, userAgent: "Mozilla/5.0" },
      providers: {
        enabledProviders: [],
        onlineSim: {},
        smsToMe: {},
        receiveSmss: {},
        receiveSmsFreeCc: {},
        heroSms: {
          enabled: true,
          apiKey: "demo-key",
          baseUrl: "https://hero-sms.com/stubs/handler_api.php",
          defaultService: "dr",
          defaultCountry: 16,
          selectionMode: "balanced",
          reuseEnabled: true,
          defaultMaxBindingsPerPhone: 1,
          refundableCancelWindowSeconds: 120,
          leaseWindowSeconds: 1200,
        },
      },
    });

    vi.spyOn(provider, "getPrices").mockResolvedValue({
      dr: {
        16: { cost: 0.63, count: 11 },
        2: { cost: 0.40, count: 2 },
      },
    });

    const items = await provider.listCountryPrices("dr", [
      { providerKey: "hero_sms", countryId: 16, apiName: "United Kingdom", dialCode: "+44" },
      { providerKey: "hero_sms", countryId: 2, apiName: "Kazakhstan", dialCode: "+7" },
    ]);

    expect(items.map((item) => item.countryId)).toEqual([2, 16]);
    expect(items[0]).toMatchObject({ price: 0.4, count: 2, dialCode: "+7" });
  });

  test("normalizes activation create response", () => {
    const activation = normalizeHeroSmsActivationResponse(
      {
        activationId: 12345,
        phoneNumber: "447700900123",
        activationCost: 0.55,
      },
      { service: "dr", country: 16, operator: "vodafone" },
    );

    expect(activation).toMatchObject({
      activationId: 12345,
      phoneNumber: "+447700900123",
      service: "dr",
      countryId: 16,
      operator: "vodafone",
      activationCost: 0.55,
    });
  });

  test("normalizes V2 status response with sms payload", () => {
    const status = normalizeHeroSmsStatusResponse(12345, {
      verificationType: 2,
      sms: {
        code: "654321",
        text: "Your code is 654321",
        dateTime: "2026-05-12T08:00:00Z",
      },
    });

    expect(status).toMatchObject({
      activationId: 12345,
      received: true,
      cancelled: false,
      code: "654321",
      text: "Your code is 654321",
      receivedAtIso: "2026-05-12T08:00:00Z",
    });
  });

  test("normalizes legacy text status responses", () => {
    expect(normalizeHeroSmsStatusResponse(1, "STATUS_WAIT_CODE")).toMatchObject({
      received: false,
      cancelled: false,
      rawStatusText: "STATUS_WAIT_CODE",
    });
    expect(normalizeHeroSmsStatusResponse(1, "STATUS_CANCEL")).toMatchObject({
      received: false,
      cancelled: true,
      rawStatusText: "STATUS_CANCEL",
    });
    expect(normalizeHeroSmsStatusResponse(1, "STATUS_OK:4321")).toMatchObject({
      received: true,
      code: "4321",
      rawStatusText: "STATUS_OK:4321",
    });
  });
});
