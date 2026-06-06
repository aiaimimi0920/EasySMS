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

function createConfig(): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    server: {
      ...defaultEasySmsRuntimeConfig.server,
      host: "127.0.0.1",
      port: 0,
    },
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

describe("EasySms session-centric native routes", () => {
  it("exposes catalog, plan, open, code, messages, report, observe, query, and stats routes", async () => {
    const allProviders: ProviderDescriptor[] = [
      {
        key: "onlinesim",
        displayName: "OnlineSIM Free Numbers",
        homepageUrl: "https://example.com/onlinesim",
        sourceType: "public-web-scrape",
        costTier: "free",
        capabilities: ["create-activation", "list-public-numbers", "read-public-inbox"],
        enabled: true,
        countryHints: ["United States"],
        notes: [],
      },
    ];
    const openCalls: Array<{ input: HeroSmsActivationCreateInput; options: { providerKey?: string; costTier?: CostTier } }> = [];
    const selectionPlanCalls: Array<Record<string, unknown>> = [];
    const reportCalls: string[] = [];
    const observeCalls: string[] = [];

    const service = {
      config: createConfig(),
      getCatalog: () => ({
        providers: allProviders,
        strategyModeId: "aggregate-latest",
        compatibility: {
          facadePath: "/stubs/handler_api.php",
          supportedActions: ["getNumberV2"],
        },
      }),
      getSnapshot: (mode: "summary" | "detail" = "summary") => ({
        mode,
        catalog: {
          providers: allProviders,
          strategyModeId: "aggregate-latest",
          compatibility: {
            facadePath: "/stubs/handler_api.php",
            supportedActions: ["getNumberV2"],
          },
        },
        runtime: {
          serviceStartedAt: "2026-05-12T12:59:00.000Z",
          stateStore: {
            enabled: true,
            driver: "file",
            filePath: "/var/lib/easy-sms/runtime-state.json",
          },
          stateLoad: {
            attempted: true,
            status: "loaded",
            checkedAt: "2026-05-12T12:59:05.000Z",
            detail: "Runtime state was loaded from the persistence store.",
          },
          maintenanceLoop: {
            enabled: true,
            intervalMs: 60000,
            runCount: 1,
            successCount: 1,
            failureCount: 0,
            lastStartedAt: "2026-05-12T13:00:00.000Z",
            lastCompletedAt: "2026-05-12T13:00:01.000Z",
            lastSucceededAt: "2026-05-12T13:00:01.000Z",
            lastDurationMs: 1000,
            detail: "Maintenance refreshed 1 providers.",
          },
          activeProbeLoop: {
            enabled: true,
            intervalMs: 300000,
            runCount: 1,
            successCount: 1,
            failureCount: 0,
            lastStartedAt: "2026-05-12T13:00:10.000Z",
            lastCompletedAt: "2026-05-12T13:00:12.000Z",
            lastSucceededAt: "2026-05-12T13:00:12.000Z",
            lastDurationMs: 2000,
            detail: "Periodic active probe completed for 1 providers.",
          },
          persistenceLoop: {
            enabled: true,
            intervalMs: 120000,
            runCount: 1,
            successCount: 1,
            failureCount: 0,
            lastStartedAt: "2026-05-12T13:00:20.000Z",
            lastCompletedAt: "2026-05-12T13:00:20.500Z",
            lastSucceededAt: "2026-05-12T13:00:20.500Z",
            lastDurationMs: 500,
            detail: "Runtime state flushed to /var/lib/easy-sms/runtime-state.json.",
          },
        },
        runtimeState: {
          providers: [],
          routes: [],
          ...(mode === "detail" ? { probeHistory: [] } : {}),
          updatedAt: "2026-05-12T13:00:00.000Z",
        },
        ...(mode === "detail"
          ? {
              sessions: [],
              observedMessages: [],
              projectedMessages: [],
            }
          : {}),
      }),
      getRuntimeDiagnostics: () => ({
        serviceStartedAt: "2026-05-12T12:59:00.000Z",
        stateStore: {
          enabled: true,
          driver: "file",
          filePath: "/var/lib/easy-sms/runtime-state.json",
        },
        stateLoad: {
          attempted: true,
          status: "loaded",
          checkedAt: "2026-05-12T12:59:05.000Z",
          detail: "Runtime state was loaded from the persistence store.",
        },
        maintenanceLoop: {
          enabled: true,
          intervalMs: 60000,
          runCount: 1,
          successCount: 1,
          failureCount: 0,
          lastSucceededAt: "2026-05-12T13:00:01.000Z",
        },
        activeProbeLoop: {
          enabled: true,
          intervalMs: 300000,
          runCount: 1,
          successCount: 1,
          failureCount: 0,
          lastSucceededAt: "2026-05-12T13:00:12.000Z",
        },
        persistenceLoop: {
          enabled: true,
          intervalMs: 120000,
          runCount: 1,
          successCount: 1,
          failureCount: 0,
          lastSucceededAt: "2026-05-12T13:00:20.500Z",
        },
      }),
      listProviders: () => allProviders,
      getHealthSummary: () => ({ totalProviders: 1, activeCount: 1, coolingCount: 0, temporarilyDisabledCount: 0, degradedCount: 0, challengeCount: 0, blockedCount: 0, emptyCount: 0 }),
      listProviderHealth: () => [],
      listRouteHealth: () => [],
      listProbeTrends: () => [],
      listProbeHistory: () => [],
      getListSelectionPlan: (options: Record<string, unknown>) => {
        selectionPlanCalls.push(options);
        return [];
      },
      queryListSelectionPlan: async (options: Record<string, unknown>) => {
        selectionPlanCalls.push(options);
        return [];
      },
      probeProvider: async (providerKey: string) => ({
        providerKey,
        providerDisplayName: "OnlineSIM Free Numbers",
        ok: true,
        status: "active",
        healthState: "healthy",
        healthScore: 1,
        routeKind: "list-public-numbers",
        checkedAt: "2026-05-12T13:00:00.000Z",
      }),
      probeAllProviders: async () => [],
      planSession: async () => ({
        planned: true,
        routeKind: "open-sms-session",
        providerKey: "onlinesim",
        providerDisplayName: "OnlineSIM Free Numbers",
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
        countryCode: "+1",
        compatibilityAction: "getNumberV2",
        notes: ["planned"],
      }),
      openSession: async (input: HeroSmsActivationCreateInput, options: { providerKey?: string; costTier?: CostTier }) => {
        openCalls.push({ input, options });
        return {
          id: "sms_session_000001",
          providerKey: "onlinesim",
          providerDisplayName: "OnlineSIM Free Numbers",
          activationId: 900000000,
          sessionMode: "synthetic-public-inbox",
          costTier: "free",
          numberId: "abc123",
          phoneNumber: "+12025550123",
          sourceUrl: "https://example.com/number/1",
          service: "otp",
          countryId: 0,
          countryCode: "+1",
          countryName: "United States",
          openedAtIso: "2026-05-12T13:00:00.000Z",
        };
      },
      readSessionStatus: async () => ({
        providerKey: "onlinesim",
        activationId: 900000000,
        sessionId: "sms_session_000001",
        fetchedAtIso: "2026-05-12T13:00:10.000Z",
        received: true,
        cancelled: false,
        code: "123456",
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
      }),
      readSessionCode: async () => ({
        sessionId: "sms_session_000001",
        providerKey: "onlinesim",
        code: "123456",
        source: "provider-inbox",
        observedMessageId: "sms_session_000001:provider:1",
        candidates: ["123456"],
      }),
      listSessionMessages: async () => ([
        {
          id: "sms_session_000001:provider:1",
          sessionId: "sms_session_000001",
          providerKey: "onlinesim",
          sourceType: "provider-inbox",
          content: "Your code is 123456",
          code: "123456",
          observedAtIso: "2026-05-12T13:00:10.000Z",
        },
      ]),
      updateSessionAction: async (_sessionId: string, action: HeroSmsActivationAction) => ({
        providerKey: "onlinesim",
        activationId: 900000000,
        sessionId: "sms_session_000001",
        requestedAction: action,
        requestedStatus: action === "cancel" ? 8 : action === "complete" ? 6 : 3,
        resultText: action === "cancel" ? "ACCESS_CANCEL" : "OK",
        costTier: "free",
        sessionMode: "synthetic-public-inbox",
        updatedAtIso: "2026-05-12T13:00:20.000Z",
      }),
      recoverSessionByPhone: (request: { phoneNumber: string }) => ({
        recovered: request.phoneNumber === "+12025550123",
        strategy: "session_restore",
        session: {
          id: "sms_session_000001",
          providerKey: "onlinesim",
          providerDisplayName: "OnlineSIM Free Numbers",
          activationId: 900000000,
          sessionMode: "synthetic-public-inbox",
          costTier: "free",
          phoneNumber: "+12025550123",
          service: "otp",
          countryId: 0,
          openedAtIso: "2026-05-12T13:00:00.000Z",
        },
      }),
      reportSessionOutcome: (report: { sessionId: string }) => {
        reportCalls.push(report.sessionId);
        return {
          accepted: true,
          sessionId: report.sessionId,
          providerKey: "onlinesim",
          recordedAtIso: "2026-05-12T13:00:30.000Z",
        };
      },
      observeSessionMessage: (input: { sessionId: string; content: string }) => {
        observeCalls.push(input.sessionId);
        return {
          id: "manual-1",
          sessionId: input.sessionId,
          providerKey: "onlinesim",
          sourceType: "manual-observe",
          content: input.content,
          observedAtIso: "2026-05-12T13:00:40.000Z",
        };
      },
      querySessions: () => ([
        {
          id: "sms_session_000001",
          providerKey: "onlinesim",
          providerDisplayName: "OnlineSIM Free Numbers",
          activationId: 900000000,
          sessionMode: "synthetic-public-inbox",
          costTier: "free",
          phoneNumber: "+12025550123",
          service: "otp",
          countryId: 0,
          openedAtIso: "2026-05-12T13:00:00.000Z",
        },
      ]),
      getSessionById: (sessionId: string) => sessionId === "sms_session_000001"
        ? {
            id: "sms_session_000001",
            providerKey: "onlinesim",
            providerDisplayName: "OnlineSIM Free Numbers",
            activationId: 900000000,
            sessionMode: "synthetic-public-inbox",
            costTier: "free",
            phoneNumber: "+12025550123",
            service: "otp",
            countryId: 0,
            openedAtIso: "2026-05-12T13:00:00.000Z",
          }
        : undefined,
      queryObservedMessages: async () => ([
        {
          id: "sms_session_000001:provider:1",
          sessionId: "sms_session_000001",
          providerKey: "onlinesim",
          sourceType: "provider-inbox",
          content: "Your code is 123456",
          code: "123456",
          observedAtIso: "2026-05-12T13:00:10.000Z",
        },
        {
          id: "manual-1",
          sessionId: "sms_session_000001",
          providerKey: "onlinesim",
          sourceType: "manual-observe",
          content: "manual message",
          observedAtIso: "2026-05-12T13:00:40.000Z",
        },
      ]),
      getObservedMessageById: async (messageId: string) => messageId === "manual-1"
        ? {
            id: "manual-1",
            sessionId: "sms_session_000001",
            providerKey: "onlinesim",
            sourceType: "manual-observe",
            content: "manual message",
            observedAtIso: "2026-05-12T13:00:40.000Z",
          }
        : undefined,
      getPersistenceStats: () => ({
        sessionCount: 1,
        observedMessageCount: 2,
        providerCount: 1,
        syntheticSessionCount: 1,
        paidSessionCount: 0,
        storedObservedMessageCount: 1,
        cachedProjectedMessageCount: 1,
        heroSmsPaidLeaseCount: 1,
        heroSmsActiveReusableLeaseCount: 1,
        heroSmsSelectionStats: [
          {
            providerKey: "hero_sms",
            service: "dr",
            countryId: 16,
            assignmentCount: 2,
            successCount: 1,
            failureCount: 1,
            refundedCancelCount: 1,
            paidCancelCount: 0,
            successRate: 0.5,
          },
        ],
      }),
      runMaintenance: () => ({ refreshed: [] }),
      getLegacyProviderCatalog: () => ({ providers: allProviders }),
      getLegacyProviderHealth: () => ({ summary: {}, providers: [], routes: [], trends: [] }),
      getLegacyProbeHistory: () => ({ history: [], trends: [] }),
      getLegacySelectionPlan: () => ({ strategyModeId: "aggregate-latest", routeKind: "list-public-numbers", candidates: [] }),
      legacyProbe: async () => ({ results: [] }),
      listPublicNumbers: async () => ({ items: [], errors: [] }),
      getInbox: async () => ({ providerKey: "onlinesim", providerDisplayName: "OnlineSIM Free Numbers", numberId: "abc123", phoneNumber: "+12025550123", sourceUrl: "https://example.com/number/1", fetchedAtIso: "2026-05-12T13:00:00.000Z", messages: [] }),
      listFacadeCountries: async () => [],
      getFacadePrices: async () => ({}),
      listFacadeTopCountries: async () => [],
      listFacadeOperatorQuotes: async () => [],
      resolveFacadeCountry: async () => ({ countryId: 0, countryCode: "+1", countryName: "United States" }),
      createActivation: async () => ({ providerKey: "onlinesim", activationId: 900000000, phoneNumber: "+12025550123", service: "otp", countryId: 0, createdAtIso: "2026-05-12T13:00:00.000Z" }),
      getActivationStatus: async () => ({ providerKey: "onlinesim", activationId: 900000000, fetchedAtIso: "2026-05-12T13:00:10.000Z", received: false, cancelled: false }),
      setActivationStatus: async () => ({ providerKey: "onlinesim", activationId: 900000000, requestedAction: "request-code", requestedStatus: 3, resultText: "OK", updatedAtIso: "2026-05-12T13:00:20.000Z" }),
      listHeroSmsCountries: async () => [],
      listHeroSmsTopCountries: async () => [],
      listHeroSmsOperatorQuotes: async () => [],
      disableProviderTemporarily: () => ({ provider: {} }),
      enableProvider: () => ({ provider: {} }),
      resetOperationalState: () => ({}),
    } as unknown as import("../../src/service/easy-sms-service.js").EasySmsService;

    const server = await startHttpServer(service, createConfig());
    activeServers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Server did not bind to an address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const catalogPayload = await (await fetch(`${baseUrl}/sms/catalog`)).json() as { catalog: { providers: Array<{ key: string }> } };
    expect(catalogPayload.catalog.providers[0]?.key).toBe("onlinesim");

    const snapshotPayload = await (await fetch(`${baseUrl}/sms/snapshot`)).json() as {
      snapshot: {
        mode: string;
        runtime: { maintenanceLoop: { enabled: boolean } };
        runtimeState: { probeHistory?: unknown[] };
        sessions?: unknown[];
      };
    };
    expect(snapshotPayload.snapshot.mode).toBe("summary");
    expect(snapshotPayload.snapshot.runtime.maintenanceLoop.enabled).toBe(true);
    expect(snapshotPayload.snapshot.runtimeState.probeHistory).toBeUndefined();
    expect(snapshotPayload.snapshot.sessions).toBeUndefined();

    const detailSnapshotPayload = await (await fetch(`${baseUrl}/sms/snapshot?mode=detail`)).json() as {
      snapshot: {
        mode: string;
        runtimeState: { probeHistory?: unknown[] };
        sessions?: unknown[];
      };
    };
    expect(detailSnapshotPayload.snapshot.mode).toBe("detail");
    expect(detailSnapshotPayload.snapshot.runtimeState.probeHistory).toEqual([]);
    expect(detailSnapshotPayload.snapshot.sessions).toEqual([]);

    const invalidTimeWindow = await fetch(
      `${baseUrl}/sms/query/messages?since=2026-05-12T13:10:00.000Z&until=2026-05-12T13:00:00.000Z`,
    );
    expect(invalidTimeWindow.status).toBe(400);
    await expect(invalidTimeWindow.json()).resolves.toMatchObject({
      error: "since must be earlier than or equal to until.",
    });

    const planPayload = await (await fetch(`${baseUrl}/sms/sessions/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ countryCode: "+1" }),
    })).json() as { plan: { planned: boolean } };
    expect(planPayload.plan.planned).toBe(true);

    const openPayload = await (await fetch(`${baseUrl}/sms/sessions/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerKey: "onlinesim", service: "otp", countryCode: "+1" }),
    })).json() as { session: { id: string } };
    expect(openPayload.session.id).toBe("sms_session_000001");
    expect(openCalls).toEqual([
      {
        input: { service: "otp", countryCode: "+1" },
        options: { providerKey: "onlinesim", costTier: undefined },
      },
    ]);

    const codePayload = await (await fetch(`${baseUrl}/sms/sessions/sms_session_000001/code`)).json() as { code: { code: string } };
    expect(codePayload.code.code).toBe("123456");

    const messagesPayload = await (await fetch(`${baseUrl}/sms/sessions/sms_session_000001/messages`)).json() as { messages: Array<{ code?: string }> };
    expect(messagesPayload.messages[0]?.code).toBe("123456");

    const statusPayload = await (await fetch(`${baseUrl}/sms/sessions/sms_session_000001/status`)).json() as { status: { sessionId: string } };
    expect(statusPayload.status.sessionId).toBe("sms_session_000001");

    const actionPayload = await (await fetch(`${baseUrl}/sms/sessions/sms_session_000001/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    })).json() as { result: { requestedAction: string } };
    expect(actionPayload.result.requestedAction).toBe("cancel");

    const recoverPayload = await (await fetch(`${baseUrl}/sms/sessions/recover-by-phone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumber: "+12025550123" }),
    })).json() as { result: { recovered: boolean } };
    expect(recoverPayload.result.recovered).toBe(true);

    const reportPayload = await (await fetch(`${baseUrl}/sms/sessions/report-outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "sms_session_000001", success: true }),
    })).json() as { result: { accepted: boolean } };
    expect(reportPayload.result.accepted).toBe(true);
    expect(reportCalls).toEqual(["sms_session_000001"]);

    const observePayload = await (await fetch(`${baseUrl}/sms/messages/observe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "sms_session_000001", content: "manual message" }),
    })).json() as { message: { sessionId: string } };
    expect(observePayload.message.sessionId).toBe("sms_session_000001");
    expect(observeCalls).toEqual(["sms_session_000001"]);

    const querySessionsPayload = await (await fetch(`${baseUrl}/sms/query/sessions`)).json() as { sessions: Array<{ id: string }> };
    expect(querySessionsPayload.sessions[0]?.id).toBe("sms_session_000001");

    const providerHealthPayload = await (await fetch(`${baseUrl}/sms/query/providers/health`)).json() as { summary: { totalProviders: number } };
    expect(providerHealthPayload.summary.totalProviders).toBe(1);

    const providerHealthSummaryPayload = await (await fetch(`${baseUrl}/sms/query/providers/health?mode=summary`)).json() as { summary: { totalProviders: number }; providers?: unknown[] };
    expect(providerHealthSummaryPayload.summary.totalProviders).toBe(1);
    expect(providerHealthSummaryPayload.providers).toBeUndefined();

    const runtimePayload = await (await fetch(`${baseUrl}/sms/query/runtime`)).json() as { runtime: { persistenceLoop: { enabled: boolean; runCount: number } } };
    expect(runtimePayload.runtime.persistenceLoop.enabled).toBe(true);
    expect(runtimePayload.runtime.persistenceLoop.runCount).toBe(1);

    const providerProbeHistoryPayload = await (await fetch(`${baseUrl}/sms/query/providers/probe-history`)).json() as { history: Array<unknown>; trends: Array<unknown> };
    expect(providerProbeHistoryPayload.history).toEqual([]);
    expect(providerProbeHistoryPayload.trends).toEqual([]);

    const providerProbeHistorySummaryPayload = await (await fetch(`${baseUrl}/sms/query/providers/probe-history?mode=summary&includeHistory=false`)).json() as { history?: Array<unknown>; trends?: Array<unknown> };
    expect(providerProbeHistorySummaryPayload.history).toBeUndefined();
    expect(providerProbeHistorySummaryPayload.trends).toBeUndefined();

    const providerProbeHistorySummaryWithTrendsPayload = await (await fetch(`${baseUrl}/sms/query/providers/probe-history?mode=summary&includeHistory=false&includeTrends=true`)).json() as { history?: Array<unknown>; trends?: Array<unknown> };
    expect(providerProbeHistorySummaryWithTrendsPayload.history).toBeUndefined();
    expect(providerProbeHistorySummaryWithTrendsPayload.trends).toEqual([]);

    const selectionPlanPayload = await (await fetch(`${baseUrl}/sms/query/providers/selection-plan?providerKey=onlinesim&limit=1`)).json() as { routeKind: string };
    expect(selectionPlanPayload.routeKind).toBe("list-public-numbers");
    expect(selectionPlanCalls).toContainEqual({ providerKey: "onlinesim", limit: 1 });

    const querySessionPayload = await (await fetch(`${baseUrl}/sms/query/sessions/sms_session_000001`)).json() as { session: { id: string } };
    expect(querySessionPayload.session.id).toBe("sms_session_000001");
    expect((await fetch(`${baseUrl}/sms/query/sessions/missing-session`)).status).toBe(404);

    const queryMessagesPayload = await (await fetch(`${baseUrl}/sms/query/messages`)).json() as { messages: Array<{ id: string }> };
    expect(queryMessagesPayload.messages.some((item) => item.id === "sms_session_000001:provider:1")).toBe(true);
    expect(queryMessagesPayload.messages.some((item) => item.id === "manual-1")).toBe(true);

    const queryMessagePayload = await (await fetch(`${baseUrl}/sms/query/messages/manual-1`)).json() as { message: { id: string } };
    expect(queryMessagePayload.message.id).toBe("manual-1");
    expect((await fetch(`${baseUrl}/sms/query/messages/missing-message`)).status).toBe(404);

    const statsPayload = await (await fetch(`${baseUrl}/sms/query/stats`)).json() as { stats: { sessionCount: number; syntheticSessionCount: number; cachedProjectedMessageCount: number; heroSmsSelectionStats: Array<{ providerKey: string; successRate: number }> } };
    expect(statsPayload.stats.sessionCount).toBe(1);
    expect(statsPayload.stats.syntheticSessionCount).toBe(1);
    expect(statsPayload.stats.cachedProjectedMessageCount).toBe(1);
    expect(statsPayload.stats.heroSmsSelectionStats[0]?.providerKey).toBe("hero_sms");
    expect(statsPayload.stats.heroSmsSelectionStats[0]?.successRate).toBe(0.5);
  });
});
