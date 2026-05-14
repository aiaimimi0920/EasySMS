import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homepageHtml = `
  <a href="/country/united-kingdom">United Kingdom +44</a>
  <a href="/country/finland">Finland +358</a>
`;

const countryHtml = `
  <article class="cp-phone-card">
    <a class="cp-phone-card__number" href="/united-kingdom/phone/447575396027/sms/16039">+447575396027</a>
    <span class="cp-phone-card__meta">Added 10 hours ago</span>
    <a class="cp-phone-card__btn" href="/united-kingdom/phone/447575396027/sms/16039">View Messages</a>
  </article>
  <article class="cp-phone-card">
    <a class="cp-phone-card__number" href="/united-kingdom/phone/447575395780/sms/16038">+447575395780</a>
    <span class="cp-phone-card__meta">Added 10 hours ago</span>
    <a class="cp-phone-card__btn" href="/united-kingdom/phone/447575395780/sms/16038">View Messages</a>
  </article>
`;

const liveInboxHtml = `
  <table class="mp-table">
    <tbody>
      <tr><td>447934556XXX</td><td>3 minutes ago</td><td>Your code is 0719</td></tr>
      <tr><td>AnsXXX</td><td>9 minutes ago</td><td>[LeetCode力扣]您的注册验证码为：469021，该验证码 5 分钟内有效，请勿泄漏于他人。</td></tr>
    </tbody>
  </table>
`;

const deadInboxHtml = `
  <table class="mp-table">
    <tbody>
      <tr><td>FACEBXXX</td><td>58 minutes ago</td><td>983120 is your confirmation code. For your security, do not share this code.</td></tr>
    </tbody>
  </table>
`;

vi.mock("../../../src/providers/smstome/session-helper.js", () => ({
  isSmsToMeAccessGateHtml: () => false,
  resolveSmsToMeAuthConfig: () => ({ email: "vmjcv666@gmail.com", password: "Qq365210!@#$%^" }),
  fetchSmsToMeHtml: async (url: string) => {
    if (url === "https://smstome.com") {
      return homepageHtml;
    }
    if (url === "https://smstome.com/country/united-kingdom") {
      return countryHtml;
    }
    if (url === "https://smstome.com/united-kingdom/phone/447575396027/sms/16039") {
      return liveInboxHtml;
    }
    if (url === "https://smstome.com/united-kingdom/phone/447575395780/sms/16038") {
      return deadInboxHtml;
    }
    throw new Error(`Unexpected smstome fixture URL: ${url}`);
  },
}));

describe("SMSToMe provider runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T06:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists only live public numbers from logged-in country pages", async () => {
    const { SmsToMeProvider } = await import("../../../src/providers/smstome/index.js");

    const provider = new SmsToMeProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
      providers: {
        smsToMe: {
          email: "vmjcv666@gmail.com",
          password: "Qq365210!@#$%^",
        },
      },
    } as never);

    const items = await provider.listPublicNumbers({ countryCode: "+44", limit: 5 });

    expect(items.map((item) => item.phoneNumber)).toEqual(["+447575396027"]);
    expect(items[0]?.latestActivityText).toBe("3 minutes ago");
  });

  it("parses inbox rows from the message table", async () => {
    const { SmsToMeProvider } = await import("../../../src/providers/smstome/index.js");

    const provider = new SmsToMeProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
      providers: {
        smsToMe: {
          email: "vmjcv666@gmail.com",
          password: "Qq365210!@#$%^",
        },
      },
    } as never);

    const inbox = await provider.getInbox(
      "eyJwcm92aWRlcktleSI6InNtc3RvbWUiLCJzb3VyY2VVcmwiOiJodHRwczovL3Ntc3RvbWUuY29tL3VuaXRlZC1raW5nZG9tL3Bob25lLzQ0NzU3NTM5NjAyNy9zbXMvMTYwMzkiLCJwaG9uZU51bWJlciI6Iis0NDc1NzUzOTYwMjciLCJjb3VudHJ5TmFtZSI6IlVuaXRlZCBLaW5nZG9tIiwiY291bnRyeUNvZGUiOiIrNDQifQ",
    );

    expect(inbox.messages).toHaveLength(2);
    expect(inbox.messages[0]?.sender).toBe("447934556XXX");
    expect(inbox.messages[0]?.receivedAtText).toBe("3 minutes ago");
    expect(inbox.messages[1]?.content).toContain("469021");
  });
});
