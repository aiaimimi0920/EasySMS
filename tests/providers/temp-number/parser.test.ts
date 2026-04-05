import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import {
  parseTempNumberCountryCatalog,
  parseTempNumberDirectoryCards,
  parseTempNumberInboxMessages,
  TempNumberProvider,
} from "../../../src/providers/temp_number/index.js";
import { defaultEasySmsRuntimeConfig } from "../../../src/defaults/index.js";

describe("Temp Number parsers", () => {
  const provider = new TempNumberProvider(defaultEasySmsRuntimeConfig);

  it("parses mixed global and country-scoped number cards", () => {
    const $ = load(`
      <section>
        <article class="number-card">
          <header class="number-card__top">
            <span class="number-card__country-name">Netherlands</span>
            <time class="number-card__date">10 hours ago</time>
          </header>
          <div class="number-card__body">
            <span class="number-card__number">3197058046691</span>
          </div>
          <div class="number-card__footer">
            <span class="number-card__msgs">No messages yet</span>
            <a class="number-card__link" href="https://temp-number.com/temporary-numbers/Netherlands/3197058046691">View Inbox</a>
          </div>
        </article>
        <div class="country-box number-card">
          <div class="ribbon-green">NEW</div>
          <div class="add_time-top">2 days ago</div>
          <a href="https://temp-number.com/temporary-numbers/United-Kingdom/447455939509" class="country-link">
            <h4 class="card-title">+447455939509</h4>
          </a>
        </div>
      </section>
    `);

    const items = parseTempNumberDirectoryCards($, provider.descriptor);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      providerKey: "temp_number",
      countryName: "Netherlands",
      countryCode: "+31",
      phoneNumber: "+3197058046691",
    });
    expect(items[1]).toMatchObject({
      providerKey: "temp_number",
      countryName: "United Kingdom",
      countryCode: "+44",
      phoneNumber: "+447455939509",
    });
  });

  it("parses country catalog links and inbox messages", () => {
    const catalog = load(`
      <div>
        <a href="https://temp-number.com/countries/united-kingdom">Trending United Kingdom +44 2511 numbers</a>
        <a href="https://temp-number.com/countries/netherlands">Netherlands +31</a>
      </div>
    `);
    const countries = parseTempNumberCountryCatalog(catalog);

    expect(countries).toEqual([
      {
        countryCode: "+44",
        countryName: "United Kingdom",
        sourceUrl: "https://temp-number.com/countries/united-kingdom",
      },
      {
        countryCode: "+31",
        countryName: "Netherlands",
        sourceUrl: "https://temp-number.com/countries/netherlands",
      },
    ]);

    const inbox = load(`
      <section aria-label="SMS messages">
        <article class="msg-card msg-card--otp">
          <div class="msg-from">business TikTok</div>
          <time class="msg-time">2 days ago</time>
          <div class="msg-body">[TikTok] 644988 is your verification code.</div>
        </article>
        <article class="msg-card">
          <div class="msg-from">phone 4xxxx3544</div>
          <time class="msg-time">2 days ago</time>
          <div class="msg-body">Your WhatsApp code: 261-992</div>
        </article>
      </section>
    `);
    const messages = parseTempNumberInboxMessages(
      inbox,
      "https://temp-number.com/temporary-numbers/United-Kingdom/447455939509",
      "+447455939509",
    );

    expect(messages).toEqual([
      {
        id: "+447455939509-0",
        sender: "TikTok",
        receivedAtText: "2 days ago",
        content: "[TikTok] 644988 is your verification code.",
        sourceUrl: "https://temp-number.com/temporary-numbers/United-Kingdom/447455939509",
      },
      {
        id: "+447455939509-1",
        sender: "4xxxx3544",
        receivedAtText: "2 days ago",
        content: "Your WhatsApp code: 261-992",
        sourceUrl: "https://temp-number.com/temporary-numbers/United-Kingdom/447455939509",
      },
    ]);
  });
});
