import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homepageHtml = `
  <a href="/en/numbers/18076957610">Canada +18076957610</a>
  <a href="/en/numbers/13089290262">United States +13089290262</a>
`;

const aliveInboxHtml = `
  <dl id="sms_msg">
    <dt class="mt-3"><div class="placeholder" data-created="2026-05-13T06:07:08.000000Z">&nbsp</div></dt>
    <dd class="shadow-sm bg-light rounded border-start border-info border-5">
      <label class="mb-1"><a href="/en/messages/leetcode" class="placeholder ms-1" title="SMS From LeetCode">From: LeetCode</a></label>
      <span class="placeholder text-break">尊敬的 LeetCode 用户，您的验证码为：594511，该验证码 5 分钟内有效，请勿泄漏于他人。</span>
    </dd>
  </dl>
`;

const deadInboxHtml = `
  <dl id="sms_msg">
    <dt class="mt-3"><div class="placeholder" data-created="2026-05-13T05:10:00.000000Z">&nbsp</div></dt>
    <dd class="shadow-sm bg-light rounded border-start border-info border-5">
      <label class="mb-1"><a href="/en/messages/instagram" class="placeholder ms-1" title="SMS From Instagram">From: Instagram</a></label>
      <span class="placeholder text-break">750 384 is your Instagram code. Don't share it.</span>
    </dd>
  </dl>
`;

vi.mock("../../../src/providers/sms24/session-helper.js", () => ({
  detectSms24AccessGateHtml: () => false,
  fetchSms24Html: async (url: string) => {
    if (url === "https://sms24.me/en/numbers") {
      return homepageHtml;
    }
    if (url === "https://sms24.me/en/numbers/18076957610") {
      return aliveInboxHtml;
    }
    if (url === "https://sms24.me/en/numbers/13089290262") {
      return deadInboxHtml;
    }
    throw new Error(`Unexpected sms24 fixture URL: ${url}`);
  },
}));

describe("SMS24 provider runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T06:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists only live public numbers from the directory document", async () => {
    const { Sms24Provider } = await import("../../../src/providers/sms24/index.js");

    const provider = new Sms24Provider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
    } as never);

    const items = await provider.listPublicNumbers({ limit: 5 });

    expect(items.map((item) => item.phoneNumber)).toEqual(["+18076957610"]);
    expect(items[0]?.latestActivityText).toBe("2026-05-13T06:07:08.000000Z");
  });

  it("parses inbox messages from dt/dd pairs", async () => {
    const { Sms24Provider } = await import("../../../src/providers/sms24/index.js");

    const provider = new Sms24Provider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
    } as never);

    const inbox = await provider.getInbox(
      "eyJwcm92aWRlcktleSI6InNtczI0Iiwic291cmNlVXJsIjoiaHR0cHM6Ly9zbXMyNC5tZS9lbi9udW1iZXJzLzE4MDc2OTU3NjEwIiwicGhvbmVOdW1iZXIiOiIrMTgwNzY5NTc2MTAiLCJjb3VudHJ5TmFtZSI6IkNhbmFkYSIsImNvdW50cnlDb2RlIjoiKzEifQ",
    );

    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]?.sender).toBe("LeetCode");
    expect(inbox.messages[0]?.content).toContain("594511");
    expect(inbox.messages[0]?.receivedAtIso).toBe("2026-05-13T06:07:08.000000Z");
  });
});
