import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import type { ProviderDescriptor } from "../../../src/domain/models.js";
import {
  parseReceiveSmsCoCountryCatalog,
  parseReceiveSmsCoInboxMessages,
  parseReceiveSmsCoNumberCards,
} from "../../../src/providers/receivesms_co/index.js";

const descriptor: ProviderDescriptor = {
  key: "receivesms_co",
  displayName: "ReceiveSMS.co",
  homepageUrl: "https://www.receivesms.co/",
  sourceType: "public-web-scrape",
  capabilities: ["list-public-numbers", "read-public-inbox"],
  enabled: true,
  countryHints: [],
  notes: [],
};

describe("ReceiveSMS.co parsers", () => {
  it("parses country catalog cards", () => {
    const $ = load(`
      <a class="card card-link" href="/us-phone-numbers/us/">
        United States
        <span>Active numbers: 155</span>
      </a>
      <a class="card card-link" href="/british-phone-numbers/gb/">
        United Kingdom
        <span>Active numbers: 31</span>
      </a>
    `);

    const items = parseReceiveSmsCoCountryCatalog($);

    expect(items).toHaveLength(2);
    expect(items[0]?.countryName).toBe("United States");
    expect(items[1]?.iso2).toBe("gb");
  });

  it("parses active number cards", () => {
    const $ = load(`
      <a class="card card-link" href="/us-phone-number/21676/">
        <div class="row">
          <img class="flag" alt="US" title="US">
          <strong>+1 205-809-1390</strong>
        </div>
      </a>
    `);
    const countries = new Map([
      ["us", { iso2: "us", countryName: "United States", countryCode: "+1", sourceUrl: "https://www.receivesms.co/us-phone-numbers/us/" }],
    ]);

    const items = parseReceiveSmsCoNumberCards($, descriptor, countries);

    expect(items).toHaveLength(1);
    expect(items[0]?.phoneNumber).toBe("+12058091390");
    expect(items[0]?.countryName).toBe("United States");
  });

  it("parses inbox entries", () => {
    const $ = load(`
      <article class="entry-card type--default">
        <div class="entry-head">
          <div class="entry-left"><a class="from-link">18333655610</a></div>
          <div class="entry-right"><span class="muted">2 months ago</span></div>
        </div>
        <div class="entry-body"><div class="sms">Your verification code is 5901, please do not share it with others.</div></div>
      </article>
    `);

    const messages = parseReceiveSmsCoInboxMessages(
      $,
      "https://www.receivesms.co/us-phone-number/21676/",
      "+12058091390",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.sender).toBe("18333655610");
    expect(messages[0]?.receivedAtText).toBe("2 months ago");
    expect(messages[0]?.content).toContain("5901");
  });
});
