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

class MultiNumberSyntheticProvider implements SmsProvider {
  readonly listLimits: number[] = [];

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

  public constructor(private readonly numbers: SmsPublicNumber[]) {}

  async listPublicNumbers(options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    this.listLimits.push(options.limit ?? 0);
    return this.numbers.slice(0, options.limit ?? this.numbers.length);
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    const matched = this.numbers.find((number) => number.numberId === numberId) ?? this.numbers[0]!;
    return {
      providerKey: matched.providerKey,
      providerDisplayName: matched.providerDisplayName,
      numberId,
      phoneNumber: matched.phoneNumber,
      sourceUrl: matched.sourceUrl,
      countryCode: matched.countryCode,
      countryName: matched.countryName,
      fetchedAtIso: "2026-05-12T12:00:00.000Z",
      messages: [],
    };
  }
}

class RecoveringSyntheticProvider implements SmsProvider {
  listCallCount = 0;

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

  public constructor(private readonly recoveredNumber: SmsPublicNumber) {}

  async listPublicNumbers(_options: ListPublicNumbersOptions): Promise<SmsPublicNumber[]> {
    this.listCallCount += 1;
    return this.listCallCount === 1 ? [] : [this.recoveredNumber];
  }

  async getInbox(numberId: string): Promise<SmsInboxSnapshot> {
    return {
      providerKey: this.recoveredNumber.providerKey,
      providerDisplayName: this.recoveredNumber.providerDisplayName,
      numberId,
      phoneNumber: this.recoveredNumber.phoneNumber,
      sourceUrl: this.recoveredNumber.sourceUrl,
      countryCode: this.recoveredNumber.countryCode,
      countryName: this.recoveredNumber.countryName,
      fetchedAtIso: "2026-05-12T12:00:00.000Z",
      messages: [],
    };
  }
}

function createPublicNumber(phoneNumber: string, sourceIndex: number): SmsPublicNumber {
  return {
    providerKey: "onlinesim",
    providerDisplayName: "OnlineSIM Free Numbers",
    numberId: encodeNumberId({
      providerKey: "onlinesim",
      sourceUrl: `https://example.com/number/${sourceIndex}`,
      phoneNumber,
      countryCode: "+1",
      countryName: "United States",
    }),
    sourceUrl: `https://example.com/number/${sourceIndex}`,
    phoneNumber,
    countryCode: "+1",
    countryName: "United States",
  };
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

  it("does not reopen synthetic sessions on public numbers rejected by a prior outcome", async () => {
    const rejectedNumber = createPublicNumber("+12025550123", 1);
    const usableNumber = createPublicNumber("+12025550124", 2);
    const provider = new MultiNumberSyntheticProvider([rejectedNumber, usableNumber]);
    const service = new EasySmsService(createConfig(), [provider]);

    const firstSession = await service.openSession({ service: "otp" });
    expect(firstSession.phoneNumber).toBe(rejectedNumber.phoneNumber);

    service.reportSessionOutcome({
      sessionId: firstSession.id,
      success: false,
      failureReason: "provider_rejected_phone",
      detail: "blacklisted_phone_number",
    });

    const listed = await service.listPublicNumbers({ providerKey: "onlinesim", limit: 2 });
    expect(listed.items.map((item) => item.phoneNumber)).toEqual([usableNumber.phoneNumber]);

    const secondSession = await service.openSession({ service: "otp" });
    expect(secondSession.phoneNumber).toBe(usableNumber.phoneNumber);
    expect(secondSession.numberId).toBe(usableNumber.numberId);
    expect(provider.listLimits.some((limit) => limit > 1)).toBe(true);
  });

  it("does not reacquire public numbers whose local synthetic lease is already at capacity", async () => {
    const firstNumber = createPublicNumber("+12025550123", 1);
    const secondNumber = createPublicNumber("+12025550124", 2);
    const provider = new MultiNumberSyntheticProvider([firstNumber, secondNumber]);
    const service = new EasySmsService(createConfig(), [provider]);

    const firstSession = await service.openSession({ service: "otp" });
    expect(firstSession.phoneNumber).toBe(firstNumber.phoneNumber);

    const secondSession = await service.openSession({ service: "otp" });
    expect(secondSession.phoneNumber).toBe(secondNumber.phoneNumber);
    expect(secondSession.numberId).toBe(secondNumber.numberId);
  });

  it("releases capacity for stale synthetic public-number leases", async () => {
    const firstNumber = createPublicNumber("+12025550123", 1);
    const secondNumber = createPublicNumber("+12025550124", 2);
    const provider = new MultiNumberSyntheticProvider([firstNumber, secondNumber]);
    const service = new EasySmsService(createConfig(), [provider]);

    const firstSession = await service.openSession({ service: "otp" });
    expect(firstSession.phoneNumber).toBe(firstNumber.phoneNumber);

    const staleOpenedAtIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const staleExpiresAtIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const leases = (service as unknown as {
      syntheticActivationLeasesByKey: Map<string, { openedAtIso: string; leaseExpiresAtIso?: string }>;
    }).syntheticActivationLeasesByKey;
    for (const lease of leases.values()) {
      lease.openedAtIso = staleOpenedAtIso;
      lease.leaseExpiresAtIso = staleExpiresAtIso;
    }

    const secondSession = await service.openSession({ service: "otp" });
    expect(secondSession.phoneNumber).toBe(firstNumber.phoneNumber);
    expect(secondSession.numberId).toBe(firstNumber.numberId);
  });

  it("does not reject public numbers forever after stale phone-scoped outcomes", async () => {
    const rejectedNumber = createPublicNumber("+12025550123", 1);
    const usableNumber = createPublicNumber("+12025550124", 2);
    const provider = new MultiNumberSyntheticProvider([rejectedNumber, usableNumber]);
    const service = new EasySmsService(createConfig(), [provider]);

    const firstSession = await service.openSession({ service: "otp", maxBindingsPerPhone: 2 });
    expect(firstSession.phoneNumber).toBe(rejectedNumber.phoneNumber);

    service.reportSessionOutcome({
      sessionId: firstSession.id,
      success: false,
      failureReason: "provider_rejected_phone",
      detail: "blacklisted_phone_number",
    });

    const staleIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const managedSessions = (service as unknown as {
      managedSessions: Map<string, { lastReportedOutcome?: { recordedAtIso?: string; observedAt?: string } }>;
    }).managedSessions;
    const managedSession = managedSessions.get(firstSession.id);
    if (managedSession?.lastReportedOutcome) {
      managedSession.lastReportedOutcome.recordedAtIso = staleIso;
      managedSession.lastReportedOutcome.observedAt = staleIso;
    }

    const listed = await service.listPublicNumbers({ providerKey: "onlinesim", limit: 2 });
    expect(listed.items.map((item) => item.phoneNumber)).toEqual([
      rejectedNumber.phoneNumber,
      usableNumber.phoneNumber,
    ]);
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

    const session = await service.openSession({ service: "otp", maxBindingsPerPhone: 2 });

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

    const firstSession = await service.openSession({ service: "otp", maxBindingsPerPhone: 2 });
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

  it("retries providers whose previous public number listing was empty", async () => {
    const provider = new RecoveringSyntheticProvider(createPublicNumber("+12025550125", 3));
    const service = new EasySmsService(createConfig(), [provider]);

    const initialList = await service.listPublicNumbers({ providerKey: "onlinesim", limit: 5 });
    expect(initialList.items).toEqual([]);
    expect(service.listProviderHealth()[0]?.healthState).toBe("empty");

    const session = await service.openSession({ service: "otp" });

    expect(session.providerKey).toBe("onlinesim");
    expect(session.phoneNumber).toBe("+12025550125");
    expect(provider.listCallCount).toBeGreaterThanOrEqual(2);
  });
});
