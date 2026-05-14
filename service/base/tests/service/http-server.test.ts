import { afterEach, describe, expect, it } from "vitest";

import type {
  CostTier,
  EasySmsRuntimeConfig,
  HeroSmsActivationAction,
  HeroSmsActivationCreateInput,
  ProviderDescriptor,
} from "../../src/domain/models.js";
import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { startHttpServer } from "../../src/http/server.js";

type ProviderCatalogFilters = {
  costTier?: CostTier;
  capability?: string;
};

function createConfig(apiKey?: string): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    server: {
      ...defaultEasySmsRuntimeConfig.server,
      host: "127.0.0.1",
      port: 0,
      apiKey,
    },
  };
}

function createProvider(
  key: ProviderDescriptor["key"],
  costTier: CostTier,
  capabilities: string[],
): ProviderDescriptor {
  return {
    key,
    displayName: key,
    homepageUrl: `https://example.com/${key}`,
    sourceType: costTier === "paid" ? "otp-activation-api" : "public-web-scrape",
    costTier,
    capabilities,
    enabled: true,
    countryHints: [],
    notes: [],
  };
}

let activeServers: Array<import("node:http").Server> = [];

afterEach(async () => {
  await Promise.all(
    activeServers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  activeServers = [];
});

describe("HTTP server unified provider routes", () => {
  it("enforces bearer auth when server.apiKey is configured while keeping healthz and openapi anonymous", async () => {
    const config = createConfig("test-secret");
    const service = {
      config,
      getHealthSummary: () => ({ totalProviders: 0, activeCount: 0, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviders: () => ([]),
      listProviderHealth: () => ([]),
      listRouteHealth: () => ([]),
      listProbeTrends: () => ([]),
      listProbeHistory: () => ([]),
      getListSelectionPlan: () => ([]),
      getCatalog: () => ({ providers: [], strategyModeId: "aggregate-latest", compatibility: { facadePath: "/stubs/handler_api.php", supportedActions: [] } }),
      getSnapshot: () => ({ mode: "summary", catalog: { providers: [], strategyModeId: "aggregate-latest", compatibility: { facadePath: "/stubs/handler_api.php", supportedActions: [] } }, runtime: { serviceStartedAt: "2026-05-12T12:00:00.000Z", stateStore: { enabled: false, driver: "file", filePath: "state/easy-sms-state.json" }, stateLoad: { attempted: false, status: "skipped" }, maintenanceLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 }, activeProbeLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 }, persistenceLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 } }, runtimeState: { providers: [], routes: [], probeHistory: [], updatedAt: "2026-05-12T12:00:00.000Z" } }),
      getRuntimeDiagnostics: () => ({ serviceStartedAt: "2026-05-12T12:00:00.000Z", stateStore: { enabled: false, driver: "file", filePath: "state/easy-sms-state.json" }, stateLoad: { attempted: false, status: "skipped" }, maintenanceLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 }, activeProbeLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 }, persistenceLoop: { enabled: false, runCount: 0, successCount: 0, failureCount: 0 } }),
      querySessions: () => ([]),
      queryObservedMessages: async () => ([]),
      getPersistenceStats: () => ({
        sessionCount: 0,
        observedMessageCount: 0,
        providerCount: 0,
        syntheticSessionCount: 0,
        paidSessionCount: 0,
        storedObservedMessageCount: 0,
        cachedProjectedMessageCount: 0,
        heroSmsPaidLeaseCount: 0,
        heroSmsActiveReusableLeaseCount: 0,
        heroSmsSelectionStats: [],
      }),
      runMaintenance: () => ({ refreshed: { providers: [], routes: [] } }),
      recordMaintenanceLoopSuccess: () => undefined,
      recordMaintenanceLoopFailure: () => undefined,
      probeProvider: async () => { throw new Error("not used"); },
      probeAllProviders: async () => ([]),
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => { throw new Error("not used"); },
      listHeroSmsCountries: async () => ([]),
      listFacadeCountries: async () => ([]),
      getFacadePrices: async () => ({}),
      listFacadeTopCountries: async () => ([]),
      listFacadeOperatorQuotes: async () => ([]),
      resolveFacadeCountry: async () => ({ countryId: 0, countryCode: "+1", countryName: "United States" }),
      createActivation: async () => { throw new Error("not used"); },
      getActivationStatus: async () => { throw new Error("not used"); },
      setActivationStatus: async () => { throw new Error("not used"); },
      disableProviderTemporarily: () => { throw new Error("not used"); },
      enableProvider: () => { throw new Error("not used"); },
      resetOperationalState: () => { throw new Error("not used"); },
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, config);
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${baseUrl}/sms/catalog`);
    expect(unauthorized.status).toBe(401);

    const wrongAuth = await fetch(`${baseUrl}/sms/catalog`, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(wrongAuth.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/sms/catalog`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(authorized.status).toBe(200);

    const healthz = await fetch(`${baseUrl}/healthz`);
    expect(healthz.status).toBe(200);

    const openapi = await fetch(`${baseUrl}/openapi.json`);
    expect(openapi.status).toBe(200);
  });

  it("filters the unified provider catalog by costTier and capability", async () => {
    const allProviders = [
      createProvider("onlinesim", "free", ["list-public-numbers", "read-public-inbox"]),
      createProvider("hero_sms", "paid", ["create-activation", "get-activation-status"]),
    ];

    const service = {
      getHealthSummary: () => ({ totalProviders: 2, activeCount: 2, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviders: (filters: ProviderCatalogFilters = {}) =>
        allProviders.filter((provider) => {
          if (filters.costTier && provider.costTier !== filters.costTier) return false;
          if (filters.capability && !provider.capabilities.includes(filters.capability)) return false;
          return true;
        }),
      listProviderHealth: () => [],
      listRouteHealth: () => [],
      listProbeTrends: () => [],
      listProbeHistory: () => [],
      getListSelectionPlan: () => [],
      probeProvider: async () => {
        throw new Error("not used");
      },
      probeAllProviders: async () => [],
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => {
        throw new Error("not used");
      },
      listHeroSmsCountries: async () => ({ items: [] }),
      listFacadeCountries: async () => ([]),
      getHeroSmsPrices: async () => ({}),
      getFacadePrices: async () => ({}),
      listHeroSmsTopCountries: async () => ({ items: [] }),
      listFacadeTopCountries: async () => ([]),
      listHeroSmsOperatorQuotes: async () => ({ items: [] }),
      listFacadeOperatorQuotes: async () => ([]),
      resolveFacadeCountry: async () => ({ countryId: 16, countryCode: "+44", countryName: "United Kingdom" }),
      createActivation: async () => {
        throw new Error("not used");
      },
      getActivationStatus: async () => {
        throw new Error("not used");
      },
      setActivationStatus: async () => {
        throw new Error("not used");
      },
      disableProviderTemporarily: () => {
        throw new Error("not used");
      },
      enableProvider: () => {
        throw new Error("not used");
      },
      resetOperationalState: () => {
        throw new Error("not used");
      },
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, createConfig());
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }

    const paidResponse = await fetch(`http://127.0.0.1:${address.port}/providers?costTier=paid`);
    const paidPayload = await paidResponse.json() as { providers: Array<{ key: string }> };
    expect(paidPayload.providers).toHaveLength(1);
    expect(paidPayload.providers[0]?.key).toBe("hero_sms");

    const activationResponse = await fetch(`http://127.0.0.1:${address.port}/providers?capability=create-activation`);
    const activationPayload = await activationResponse.json() as { providers: Array<{ key: string }> };
    expect(activationPayload.providers).toHaveLength(1);
    expect(activationPayload.providers[0]?.key).toBe("hero_sms");
  });

  it("routes generic activation create, status, and action calls through the unified API", async () => {
    const createCalls: Array<{ input: HeroSmsActivationCreateInput; options: { providerKey?: string; costTier?: CostTier } }> = [];
    const statusCalls: Array<{ activationId: number; options: { providerKey?: string; costTier?: CostTier } }> = [];
    const actionCalls: Array<{ activationId: number; action: HeroSmsActivationAction; options: { providerKey?: string; costTier?: CostTier } }> = [];

    const service = {
      getHealthSummary: () => ({ totalProviders: 1, activeCount: 1, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviders: () => [],
      listProviderHealth: () => [],
      listRouteHealth: () => [],
      listProbeTrends: () => [],
      listProbeHistory: () => [],
      getListSelectionPlan: () => [],
      probeProvider: async () => {
        throw new Error("not used");
      },
      probeAllProviders: async () => [],
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => {
        throw new Error("not used");
      },
      listHeroSmsCountries: async () => ({ items: [] }),
      listFacadeCountries: async () => ([]),
      getHeroSmsPrices: async () => ({}),
      getFacadePrices: async () => ({}),
      listHeroSmsTopCountries: async () => ({ items: [] }),
      listFacadeTopCountries: async () => ([]),
      listHeroSmsOperatorQuotes: async () => ({ items: [] }),
      listFacadeOperatorQuotes: async () => ([]),
      resolveFacadeCountry: async () => ({ countryId: 16, countryCode: "+44", countryName: "United Kingdom" }),
      createActivation: async (input: HeroSmsActivationCreateInput, options: { providerKey?: string; costTier?: CostTier }) => {
        createCalls.push({ input, options });
        return {
          providerKey: "hero_sms",
          activationId: 12345,
          phoneNumber: "+447700900123",
          service: String(input.service),
          countryId: Number(input.country),
          createdAtIso: "2026-05-12T10:00:00.000Z",
        };
      },
      getActivationStatus: async (activationId: number, options: { providerKey?: string; costTier?: CostTier }) => {
        statusCalls.push({ activationId, options });
        return {
          providerKey: "hero_sms",
          activationId,
          fetchedAtIso: "2026-05-12T10:01:00.000Z",
          received: false,
          cancelled: false,
        };
      },
      setActivationStatus: async (
        activationId: number,
        action: HeroSmsActivationAction,
        options: { providerKey?: string; costTier?: CostTier },
      ) => {
        actionCalls.push({ activationId, action, options });
        return {
          providerKey: "hero_sms",
          activationId,
          requestedAction: action,
          requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
          resultText: "OK",
          updatedAtIso: "2026-05-12T10:02:00.000Z",
        };
      },
      disableProviderTemporarily: () => {
        throw new Error("not used");
      },
      enableProvider: () => {
        throw new Error("not used");
      },
      resetOperationalState: () => {
        throw new Error("not used");
      },
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, createConfig());
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const createResponse = await fetch(`${baseUrl}/sms/activations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerKey: "hero_sms",
        service: "dr",
        country: 16,
      }),
    });
    const createPayload = await createResponse.json() as { activation: { activationId: number } };
    expect(createPayload.activation.activationId).toBe(12345);
    expect(createCalls).toEqual([
      {
        input: { service: "dr", country: 16 },
        options: { providerKey: "hero_sms", costTier: undefined },
      },
    ]);

    const statusResponse = await fetch(`${baseUrl}/sms/activations/12345/status?providerKey=hero_sms`);
    const statusPayload = await statusResponse.json() as { activation: { activationId: number } };
    expect(statusPayload.activation.activationId).toBe(12345);
    expect(statusCalls).toEqual([
      {
        activationId: 12345,
        options: { providerKey: "hero_sms", costTier: undefined },
      },
    ]);

    const actionResponse = await fetch(`${baseUrl}/sms/activations/12345/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerKey: "hero_sms",
        action: "cancel",
      }),
    });
    const actionPayload = await actionResponse.json() as { activation: { requestedAction: string } };
    expect(actionPayload.activation.requestedAction).toBe("cancel");
    expect(actionCalls).toEqual([
      {
        activationId: 12345,
        action: "cancel",
        options: { providerKey: "hero_sms", costTier: undefined },
      },
    ]);
  });

  it("exposes a HeroSMS-compatible handler_api facade", async () => {
    const service = {
      getHealthSummary: () => ({ totalProviders: 1, activeCount: 1, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviders: () => [],
      listProviderHealth: () => [],
      listRouteHealth: () => [],
      listProbeTrends: () => [],
      listProbeHistory: () => [],
      getListSelectionPlan: () => [],
      probeProvider: async () => {
        throw new Error("not used");
      },
      probeAllProviders: async () => [],
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => {
        throw new Error("not used");
      },
      listHeroSmsCountries: async () => ([
        {
          providerKey: "hero_sms",
          countryId: 16,
          apiName: "United Kingdom",
          visible: true,
          retry: true,
        },
      ]),
      listFacadeCountries: async () => ([
        {
          providerKey: "hero_sms",
          countryId: 16,
          apiName: "United Kingdom",
          dialCode: "+44",
          visible: true,
          retry: true,
        },
      ]),
      getHeroSmsPrices: async () => ({
        dr: {
          16: { cost: 0.55, count: 7 },
        },
      }),
      getFacadePrices: async () => ({
        dr: {
          16: { cost: 0.55, count: 7 },
        },
      }),
      listHeroSmsTopCountries: async () => ([
        {
          providerKey: "hero_sms",
          service: "dr",
          countryId: 16,
          price: 0.55,
          count: 7,
          apiName: "United Kingdom",
        },
      ]),
      listFacadeTopCountries: async () => ([
        {
          providerKey: "hero_sms",
          service: "dr",
          countryId: 16,
          price: 0.55,
          count: 7,
          apiName: "United Kingdom",
          dialCode: "+44",
        },
      ]),
      listHeroSmsOperatorQuotes: async () => ([
        {
          providerKey: "hero_sms",
          service: "dr",
          countryId: 16,
          operator: "vodafone",
        },
      ]),
      listFacadeOperatorQuotes: async () => ([
        {
          providerKey: "hero_sms",
          service: "dr",
          countryId: 16,
          operator: "vodafone",
          price: 0.55,
          count: 7,
        },
      ]),
      resolveFacadeCountry: async () => ({
        countryId: 700000001,
        countryCode: "+1",
        countryName: "United States",
      }),
      createHeroSmsActivation: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        phoneNumber: "+447700900123",
        service: "dr",
        countryId: 16,
        createdAtIso: "2026-05-12T10:00:00.000Z",
      }),
      getHeroSmsActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        fetchedAtIso: "2026-05-12T10:01:00.000Z",
        received: true,
        cancelled: false,
        code: "4321",
      }),
      setHeroSmsActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: "cancel",
        requestedStatus: 8,
        resultText: "ACCESS_CANCEL",
        updatedAtIso: "2026-05-12T10:02:00.000Z",
      }),
      createActivation: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        phoneNumber: "+447700900123",
        service: "dr",
        countryId: 16,
        createdAtIso: "2026-05-12T10:00:00.000Z",
      }),
      getActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        fetchedAtIso: "2026-05-12T10:01:00.000Z",
        received: true,
        cancelled: false,
        code: "4321",
      }),
      setActivationStatus: async () => ({
        providerKey: "hero_sms",
        activationId: 555,
        requestedAction: "cancel",
        requestedStatus: 8,
        resultText: "ACCESS_CANCEL",
        updatedAtIso: "2026-05-12T10:02:00.000Z",
      }),
      disableProviderTemporarily: () => {
        throw new Error("not used");
      },
      enableProvider: () => {
        throw new Error("not used");
      },
      resetOperationalState: () => {
        throw new Error("not used");
      },
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, createConfig());
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const buildUrl = (pathAndQuery: string) => new URL(pathAndQuery, `${baseUrl}/`).toString();

    const countries = await fetch(buildUrl("stubs/handler_api.php?action=getCountries&providerKey=hero_sms"));
    const countriesPayload = await countries.json() as Record<string, { id: number; eng: string }>;
    expect(countriesPayload["16"]?.id).toBe(16);
    expect(countriesPayload["16"]?.eng).toBe("United Kingdom");

    const prices = await fetch(buildUrl("stubs/handler_api.php?action=getPrices&service=dr&providerKey=hero_sms"));
    const pricesPayload = await prices.json() as { dr: { 16: { cost: number; count: number } } };
    expect(pricesPayload.dr[16].cost).toBe(0.55);

    const number = await fetch(buildUrl("stubs/handler_api.php?action=getNumberV2&service=dr&country=16&providerKey=hero_sms"));
    const numberPayload = await number.json() as { activationId: number; phoneNumber: string };
    expect(numberPayload.activationId).toBe(555);
    expect(numberPayload.phoneNumber).toBe("+447700900123");

    const status = await fetch(buildUrl("stubs/handler_api.php?action=getStatus&id=555&providerKey=hero_sms"));
    const statusPayload = await status.text();
    expect(statusPayload).toBe("STATUS_OK:4321");

    const setStatus = await fetch(buildUrl("stubs/handler_api.php?action=setStatus&id=555&status=8&providerKey=hero_sms"));
    const setStatusPayload = await setStatus.text();
    expect(setStatusPayload).toBe("ACCESS_CANCEL");
  });

  it("serves the OpenAPI contract and allows free-facade handler_api activation parameters", async () => {
    const createCalls: Array<{ input: HeroSmsActivationCreateInput; options: { providerKey?: string; costTier?: CostTier } }> = [];

    const service = {
      getHealthSummary: () => ({ totalProviders: 1, activeCount: 1, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviders: () => ([
        {
          key: "onlinesim",
          displayName: "onlinesim",
          homepageUrl: "https://example.com/onlinesim",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["create-activation", "list-public-numbers", "read-public-inbox"],
          enabled: true,
          countryHints: [],
          notes: [],
        },
      ]),
      listProviderHealth: () => [],
      listRouteHealth: () => [],
      listProbeTrends: () => [],
      listProbeHistory: () => [],
      getListSelectionPlan: () => [],
      probeProvider: async () => {
        throw new Error("not used");
      },
      probeAllProviders: async () => [],
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => {
        throw new Error("not used");
      },
      listHeroSmsCountries: async () => [],
      listFacadeCountries: async () => ([
        {
          providerKey: "onlinesim",
          countryId: 700000001,
          apiName: "United States",
          dialCode: "+1",
          visible: true,
          retry: true,
        },
      ]),
      getHeroSmsPrices: async () => ({}),
      getFacadePrices: async () => ({
        otp: {
          700000001: { cost: 0, count: 1 },
        },
      }),
      listHeroSmsTopCountries: async () => [],
      listFacadeTopCountries: async () => ([]),
      listHeroSmsOperatorQuotes: async () => [],
      listFacadeOperatorQuotes: async () => ([]),
      resolveFacadeCountry: async (countryId: number) => ({
        countryId,
        countryCode: "+1",
        countryName: "United States",
      }),
      createActivation: async (input: HeroSmsActivationCreateInput, options: { providerKey?: string; costTier?: CostTier }) => {
        createCalls.push({ input, options });
        return {
          providerKey: "onlinesim",
          activationId: 900000000,
          phoneNumber: "+12025550123",
          service: String(input.service),
          countryId: 0,
          countryCode: input.countryCode,
          countryName: input.countryName,
          numberId: input.numberId,
          sourceUrl: "https://example.com/number/1",
          costTier: "free",
          sessionMode: "synthetic-public-inbox",
          createdAtIso: "2026-05-12T12:00:00.000Z",
        };
      },
      getActivationStatus: async () => ({
        providerKey: "onlinesim",
        activationId: 900000000,
        fetchedAtIso: "2026-05-12T12:01:00.000Z",
        received: false,
        cancelled: false,
      }),
      setActivationStatus: async () => ({
        providerKey: "onlinesim",
        activationId: 900000000,
        requestedAction: "request-code",
        requestedStatus: 3,
        resultText: "ACCESS_RETRY_GET",
        updatedAtIso: "2026-05-12T12:02:00.000Z",
      }),
      disableProviderTemporarily: () => {
        throw new Error("not used");
      },
      enableProvider: () => {
        throw new Error("not used");
      },
      resetOperationalState: () => {
        throw new Error("not used");
      },
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, createConfig());
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApiPayload = await openApiResponse.json() as { openapi: string; paths: Record<string, unknown> };
    expect(openApiPayload.openapi).toBe("3.1.0");
    expect(openApiPayload.paths["/sms/activations"]).toBeTruthy();
    expect(openApiPayload.paths["/sms/query/runtime"]).toBeTruthy();
    expect(openApiPayload.paths["/sms/query/providers/health"]).toBeTruthy();
    expect(openApiPayload.paths["/sms/query/providers/probe-history"]).toBeTruthy();
    expect(openApiPayload.paths["/sms/query/providers/selection-plan"]).toBeTruthy();
    expect(openApiPayload.paths["/stubs/handler_api.php"]).toBeTruthy();

    const countries = await fetch(`${baseUrl}/stubs/handler_api.php?action=getCountries`);
    const countriesPayload = await countries.json() as Record<string, { id: number; eng: string }>;
    expect(countriesPayload["700000001"]?.eng).toBe("United States");

    const number = await fetch(
      `${baseUrl}/stubs/handler_api.php?action=getNumberV2&operator=onlinesim&country=700000001&numberId=abc123`,
    );
    const numberPayload = await number.json() as { activationId: number; costTier: string };
    expect(numberPayload.activationId).toBe(900000000);
    expect(numberPayload.costTier).toBe("free");
    expect(createCalls).toEqual([
      {
        input: {
          service: "dr",
          country: 700000001,
          countryCode: "+1",
          countryName: "United States",
          numberId: "abc123",
          operator: "onlinesim",
        },
        options: {
          providerKey: "onlinesim",
          costTier: undefined,
        },
      },
    ]);
  });
});
