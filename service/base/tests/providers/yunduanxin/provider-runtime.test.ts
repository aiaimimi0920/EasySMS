import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const homepageHtml = `
  <div class="number-boxes-item d-flex flex-column">
    <div class="row">
      <div class="col-12">
        <h4 class="number-boxes-item-number">+1 6465180948</h4>
        <h5 class="number-boxes-item-country">美国</h5>
      </div>
    </div>
    <div class="row mt-auto">
      <div class="col-12">
        <a class="number-boxes-item-button button blue stroke rounded" href="/info/16465180948/">接收短信</a>
      </div>
    </div>
  </div>
  <div class="number-boxes-item d-flex flex-column">
    <div class="row">
      <div class="col-12">
        <h4 class="number-boxes-item-number">+1 6125626619</h4>
        <h5 class="number-boxes-item-country">美国</h5>
      </div>
    </div>
    <div class="row mt-auto">
      <div class="col-12">
        <a class="number-boxes-item-button button blue stroke rounded" href="/info/16125626619/">接收短信</a>
      </div>
    </div>
  </div>
`;

const liveInboxHtml = `
  <div class="row border-bottom table-hover">
    <div class="col-xs-12 col-md-2">
      <div class="mobile_hide">Samsung</div>
      <div class="mobile_show message_head">From Samsung (24分钟前)</div>
    </div>
    <div class="col-xs-0 col-md-2 mobile_hide">24分钟前</div>
    <div class="col-xs-12 col-md-8" style="color:#666464;">Account: 217337 is your Samsung account verification code.</div>
  </div>
`;

const deadInboxHtml = `
  <div class="row border-bottom table-hover">
    <div class="col-xs-12 col-md-2">
      <div class="mobile_hide">Google</div>
      <div class="mobile_show message_head">From Google (3月前)</div>
    </div>
    <div class="col-xs-0 col-md-2 mobile_hide">3月前</div>
    <div class="col-xs-12 col-md-8" style="color:#666464;">G-507920 is your Google verification code. Don't share your code with anyone.</div>
  </div>
`;

vi.mock("../../../src/providers/yunduanxin/session-helper.js", () => ({
  detectYunDuanXinAccessGateHtml: () => false,
  fetchYunDuanXinHtml: async (url: string) => {
    if (url === "https://yunduanxin.net") {
      return homepageHtml;
    }
    if (url === "https://yunduanxin.net/info/16465180948/") {
      return liveInboxHtml;
    }
    if (url === "https://yunduanxin.net/info/16125626619/") {
      return deadInboxHtml;
    }
    throw new Error(`Unexpected yunduanxin fixture URL: ${url}`);
  },
}));

describe("YunDuanXin provider runtime wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T06:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists only live public numbers from the homepage document", async () => {
    const { YunDuanXinProvider } = await import("../../../src/providers/yunduanxin/index.js");

    const provider = new YunDuanXinProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
    } as never);

    const items = await provider.listPublicNumbers({ limit: 5 });

    expect(items.map((item) => item.phoneNumber)).toEqual(["+1 6465180948"]);
    expect(items[0]?.latestActivityText).toBe("24分钟前");
  });

  it("parses inbox messages from row.border-bottom.table-hover blocks", async () => {
    const { YunDuanXinProvider } = await import("../../../src/providers/yunduanxin/index.js");

    const provider = new YunDuanXinProvider({
      scraping: {
        requestTimeoutMs: 15_000,
        maxNumbersPerProvider: 20,
        userAgent: "Mozilla/5.0",
      },
    } as never);

    const inbox = await provider.getInbox(
      "eyJwcm92aWRlcktleSI6Inl1bmR1YW54aW4iLCJzb3VyY2VVcmwiOiJodHRwczovL3l1bmR1YW54aW4ubmV0L2luZm8vMTY0NjUxODA5NDgvIiwicGhvbmVOdW1iZXIiOiIrMSA2NDY1MTgwOTQ4IiwiY291bnRyeU5hbWUiOiLnvo7lm70iLCJjb3VudHJ5Q29kZSI6IisxIn0",
    );

    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]?.sender).toBe("Samsung");
    expect(inbox.messages[0]?.receivedAtText).toBe("24分钟前");
    expect(inbox.messages[0]?.content).toContain("217337");
  });
});
