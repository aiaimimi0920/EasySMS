import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import type { ProviderDescriptor } from "../../../src/domain/models.js";
import {
  detectReceiveSmssBrowserGateMessage,
  parseReceiveSmssDirectoryCards,
  parseReceiveSmssInboxMessages,
} from "../../../src/providers/receive_smss/index.js";

const descriptor: ProviderDescriptor = {
  key: "receive_smss",
  displayName: "Receive SMSS",
  homepageUrl: "https://receive-smss.com/",
  sourceType: "public-web-scrape",
  capabilities: ["list-public-numbers", "read-public-inbox"],
  enabled: true,
  countryHints: [],
  notes: [],
};

describe("Receive-SMSS parsers", () => {
  it("parses public number cards from the homepage grid", () => {
    const $ = load(`
      <div class="number-boxes-item d-flex flex-column">
        <div class="number-boxes-itemm-number">+13802603245</div>
        <div class="number-boxes-item-country number-boxess-item-country">United States</div>
        <div class="row mt-auto">
          <a href="/sms/13802603245/" class="number-boxes1-item-button">Open</a>
        </div>
      </div>
      <div class="number-boxes-item d-flex flex-column">
        <div class="number-boxes-itemm-number">+447538299689</div>
        <div class="number-boxes-item-country number-boxess-item-country">United Kingdom</div>
        <div class="row mt-auto">
          <a href="/sms/447538299689/" class="number-boxes1-item-button">Open</a>
        </div>
      </div>
    `);

    const items = parseReceiveSmssDirectoryCards($, descriptor);

    expect(items).toHaveLength(2);
    expect(items[0]?.phoneNumber).toBe("+13802603245");
    expect(items[0]?.countryName).toBe("United States");
    expect(items[1]?.sourceUrl).toBe("https://receive-smss.com/sms/447538299689/");
  });

  it("parses inbox messages from message_details rows", () => {
    const $ = load(`
      <div class="row message_details">
        <div class="col-md-6 msgg"><label>Message</label><br><span>Your code is <b>154920</b></span></div>
        <div class="col-md-3 senderr"><label>Sender</label><br><a href="/receive-sms-from-447488353313/">447488353313</a></div>
        <div class="col-md-3 time"><label>Time</label><br>20 minutes ago</div>
      </div>
      <div class="row message_details">
        <div class="col-md-6 msgg"><label>Message</label><br><span>Uber code: <b>1790</b></span></div>
        <div class="col-md-3 senderr"><label>Sender</label><br><a href="/receive-sms-from-61491501530/">61491501530</a></div>
        <div class="col-md-3 time"><label>Time</label><br>21 minutes ago</div>
      </div>
    `);

    const messages = parseReceiveSmssInboxMessages(
      $,
      "https://receive-smss.com/sms/13802603245/",
      "+13802603245",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("Your code is 154920");
    expect(messages[0]?.sender).toBe("447488353313");
    expect(messages[1]?.receivedAtText).toBe("21 minutes ago");
  });

  it("detects Cloudflare challenge pages", () => {
    const $ = load(`
      <html>
        <head><title>Just a moment...</title></head>
        <body>正在进行安全验证</body>
      </html>
    `);

    expect(detectReceiveSmssBrowserGateMessage($)).toContain("Just a moment");
  });
});
