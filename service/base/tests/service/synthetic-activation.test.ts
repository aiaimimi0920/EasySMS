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
import { encodeNumberId } from "../../src/shared/index.js";
import { EasySmsService } from "../../src/service/easy-sms-service.js";

class SyntheticProvider implements SmsProvider {
  inboxCallCount = 0;

  readonly descriptor: ProviderDescriptor = {
    key: "onlinesim",
    displayName: "OnlineSIM Free Numbers",
    homepageUrl: "https://example.com/onlinesim",
    sourceType: "public-web-scrape",
    costTier: "free",
    capabilities: ["list-public-numbers", "read-public-inbox"],
    enabled: true,
    countryHints: ["US"],
    notes: [],
  };

  async listPublicNumbers(_options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    return [
      {
        providerKey: "onlinesim",
        providerDisplayName: "OnlineSIM Free Numbers",
        numberId: encodeNumberId({
          providerKey: "onlinesim",
          sourceUrl: "https://example.com/number/1",
          phoneNumber: "+12025550123",
          countryCode: "+1",
          countryName: "United States",
        }),
        sourceUrl: "https://example.com/number/1",
        phoneNumber: "+12025550123",
        countryCode: "+1",
        countryName: "United States",
      },
    ];
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    this.inboxCallCount += 1;
    const number = await this.listPublicNumbers({});
    return {
      providerKey: "onlinesim",
      providerDisplayName: "OnlineSIM Free Numbers",
      numberId,
      phoneNumber: number[0].phoneNumber,
      sourceUrl: number[0].sourceUrl,
      countryCode: number[0].countryCode,
      countryName: number[0].countryName,
      fetchedAtIso: "2026-05-12T12:00:00.000Z",
      messages: [
        {
          id: "msg-1",
          sender: "Example",
          receivedAtIso: "2026-05-12T11:59:30.000Z",
          content: "Your verification code is 123456.",
          sourceUrl: number[0].sourceUrl,
        },
      ],
    };
  }
}

function createConfig(heroEnabled = false): EasySmsRuntimeConfig {
  return {
    ...defaultEasySmsRuntimeConfig,
    providers: {
      ...defaultEasySmsRuntimeConfig.providers,
      enabledProviders: ["onlinesim"],
      heroSms: {
        ...defaultEasySmsRuntimeConfig.providers.heroSms,
        enabled: heroEnabled,
        apiKey: heroEnabled ? "placeholder-key" : "",
      },
    },
  };
}

describe("EasySms synthetic activation facade", () => {
  it("creates free activation sessions from public inbox providers and polls OTP status", async () => {
    const service = new EasySmsService(createConfig(), [new SyntheticProvider()]);

    const activation = await service.createActivation({ service: "otp" });
    expect(activation.providerKey).toBe("onlinesim");
    expect(activation.sessionId).toBe("sms_session_000001");
    expect(activation.costTier).toBe("free");
    expect(activation.sessionMode).toBe("synthetic-public-inbox");
    expect(activation.numberId).toBeTruthy();

    const status = await service.getActivationStatus(activation.activationId);
    expect(status.received).toBe(true);
    expect(status.code).toBe("123456");
    expect(status.costTier).toBe("free");
    expect(status.sessionMode).toBe("synthetic-public-inbox");

    const action = await service.setActivationStatus(activation.activationId, "cancel");
    expect(action.resultText).toBe("ACCESS_CANCEL");

    const cancelled = await service.getActivationStatus(activation.activationId);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.rawStatusText).toBe("STATUS_CANCEL");
  });

  it("opens a managed session and feeds reported outcomes back into operational state", async () => {
    const service = new EasySmsService(createConfig(), [new SyntheticProvider()]);

    const session = await service.openSession({ service: "otp" });
    expect(session.id).toBe("sms_session_000001");
    expect(session.sessionMode).toBe("synthetic-public-inbox");

    const report = service.reportSessionOutcome({
      sessionId: session.id,
      success: false,
      failureReason: "mailbox_delivery_failure",
      detail: "otp did not arrive in time",
    });
    expect(report.accepted).toBe(true);

    const query = service.querySessions({ phoneNumber: "+12025550123" });
    expect(query).toHaveLength(1);
    expect(query[0]?.lastReportedOutcome?.failureReason).toBe("mailbox_delivery_failure");

    const health = service.listProviderHealth().find((item) => item.providerKey === "onlinesim");
    expect(health?.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  it("queries a unified message view that includes projected provider messages by default", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });
    await service.listSessionMessages(session.id);
    service.observeSessionMessage({
      sessionId: session.id,
      content: "manual note without otp",
    });

    const unifiedMessages = await service.queryObservedMessages({ sessionId: session.id });
    expect(unifiedMessages.some((item) => item.sourceType === "provider-inbox" && item.code === "123456")).toBe(true);
    expect(unifiedMessages.some((item) => item.sourceType === "manual-observe")).toBe(true);

    const manualOnly = await service.queryObservedMessages({
      sessionId: session.id,
      includeProjected: false,
    });
    expect(manualOnly.every((item) => item.sourceType === "manual-observe")).toBe(true);

    const projectedOnly = await service.queryObservedMessages({
      sessionId: session.id,
      includeManual: false,
    });
    expect(projectedOnly.every((item) => item.sourceType === "provider-inbox")).toBe(true);
    expect(provider.inboxCallCount).toBe(1);
  });

  it("continues polling an already-open synthetic session when the provider inbox route is cooling", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });
    service.operationalState.recordRouteFailure(
      {
        providerKey: "onlinesim",
        providerDisplayName: "OnlineSIM Free Numbers",
        routeKind: "read-public-inbox",
        scopeKind: "country",
        scopeValue: "+1",
      },
      new Error("Cloudflare challenge page"),
      new Date(),
    );

    expect(service.operationalState.getAvailabilityIssue(
      {
        providerKey: "onlinesim",
        providerDisplayName: "OnlineSIM Free Numbers",
        routeKind: "read-public-inbox",
        scopeKind: "country",
        scopeValue: "+1",
      },
    )?.status).toBe("cooling");

    await expect(service.listSessionMessages(session.id)).resolves.toEqual([
      expect.objectContaining({
        providerKey: "onlinesim",
        sourceType: "provider-inbox",
        code: "123456",
      }),
    ]);
    expect(provider.inboxCallCount).toBe(1);
  });

  it("keeps admin-style message queries cache-first unless refreshProjected is explicitly requested", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });
    service.observeSessionMessage({
      sessionId: session.id,
      content: "manual note without otp",
    });

    const cachedOnly = await service.queryObservedMessages({ sessionId: session.id });
    expect(cachedOnly.every((item) => item.sourceType === "manual-observe")).toBe(true);
    expect(provider.inboxCallCount).toBe(0);

    const refreshed = await service.queryObservedMessages({
      sessionId: session.id,
      refreshProjected: true,
    });
    expect(refreshed.some((item) => item.sourceType === "provider-inbox" && item.code === "123456")).toBe(true);
    expect(provider.inboxCallCount).toBe(1);
  });

  it("keeps refreshProjected as a freshness knob without changing message filter semantics", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });

    const filtered = await service.queryObservedMessages({
      sessionId: session.id,
      refreshProjected: true,
      sourceType: "manual-observe",
      since: new Date("2026-05-12T12:00:00.000Z"),
      until: new Date("2026-05-12T12:30:00.000Z"),
    });

    expect(filtered).toEqual([]);
    expect(provider.inboxCallCount).toBe(1);
  });

  it("supports richer session and message query filters for long-running observability", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });
    await service.listSessionMessages(session.id);
    service.observeSessionMessage({
      sessionId: session.id,
      content: "manual note without otp",
      receivedAtIso: "2026-05-12T12:05:00.000Z",
    });
    service.reportSessionOutcome({
      sessionId: session.id,
      success: true,
      observedAt: "2026-05-12T12:06:00.000Z",
    });

    const openedAt = new Date(session.openedAtIso);
    const sessionMatches = service.querySessions({
      service: "otp",
      countryCode: "+1",
      hasOutcome: true,
      since: new Date(openedAt.getTime() - 60_000),
      until: new Date(openedAt.getTime() + 60_000),
    });
    expect(sessionMatches).toHaveLength(1);

    const manualMessages = await service.queryObservedMessages({
      sessionId: session.id,
      sourceType: "manual-observe",
      since: new Date("2026-05-12T12:04:00.000Z"),
      until: new Date("2026-05-12T12:06:00.000Z"),
    });
    expect(manualMessages).toHaveLength(1);
    expect(manualMessages[0]?.sourceType).toBe("manual-observe");
  });

  it("keeps session hasCode filters aligned with cached projected and manual messages", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const session = await service.openSession({ service: "otp" });

    expect(service.querySessions({ hasCode: true })).toEqual([]);

    await service.listSessionMessages(session.id);
    expect(service.querySessions({ hasCode: true }).map((item) => item.id)).toEqual([session.id]);

    const secondSession = await service.openSession({ service: "otp" });
    service.observeSessionMessage({
      sessionId: secondSession.id,
      content: "manual code 654321",
      receivedAtIso: "2026-05-12T12:10:00.000Z",
    });

    expect(service.querySessions({ hasCode: true }).map((item) => item.id)).toEqual([secondSession.id, session.id]);
  });

  it("orders hasCode session queries deterministically when openedAt timestamps tie", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const firstSession = await service.openSession({ service: "otp" });
    const secondSession = await service.openSession({ service: "otp" });

    const fixedIso = "2026-05-12T12:00:00.000Z";
    const managedSessions = (service as unknown as { managedSessions: Map<string, { openedAtIso: string }> }).managedSessions;
    managedSessions.get(firstSession.id)!.openedAtIso = fixedIso;
    managedSessions.get(secondSession.id)!.openedAtIso = fixedIso;

    await service.listSessionMessages(firstSession.id);
    service.observeSessionMessage({
      sessionId: secondSession.id,
      content: "manual code 123456",
      receivedAtIso: "2026-05-12T12:10:00.000Z",
    });

    expect(service.querySessions({ hasCode: true }).map((item) => item.id)).toEqual([secondSession.id, firstSession.id]);
  });

  it("rejects forged numberId values that were not issued by the current runtime", async () => {
    const provider = new SyntheticProvider();
    const service = new EasySmsService(createConfig(), [provider]);

    const forgedNumberId = encodeNumberId({
      providerKey: "onlinesim",
      sourceUrl: "https://attacker.example/number/123",
      phoneNumber: "+12025550000",
      countryCode: "+1",
      countryName: "United States",
    });

    await expect(service.getInbox({ providerKey: "onlinesim", numberId: forgedNumberId })).rejects.toThrow(
      "numberId was not issued by this EasySms runtime.",
    );

    await expect(service.openSession({ numberId: forgedNumberId })).rejects.toThrow(
      "numberId was not issued by this EasySms runtime.",
    );

    const listed = await service.listPublicNumbers({ providerKey: "onlinesim" });
    await expect(service.getInbox({
      providerKey: "onlinesim",
      numberId: listed.items[0]!.numberId,
    })).resolves.toMatchObject({
      providerKey: "onlinesim",
    });
  });

  it("prefers free synthetic activations before paid providers when no selector is provided", async () => {
    const service = new EasySmsService(createConfig(true), [new SyntheticProvider()]);

    const activation = await service.createActivation({ service: "otp" });
    expect(activation.providerKey).toBe("onlinesim");
    expect(activation.costTier).toBe("free");
  });
});
