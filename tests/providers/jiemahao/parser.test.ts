import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../../src/defaults/index.js";
import {
  detectJiemahaoGateMessage,
  JiemahaoProvider,
  parseJiemahaoCountryCatalog,
  parseJiemahaoCountryPageNumbers,
} from "../../../src/providers/jiemahao/index.js";

describe("Jiemahao parsers", () => {
  const provider = new JiemahaoProvider(defaultEasySmsRuntimeConfig);

  it("parses country catalog links from the homepage", () => {
    const $ = load(`
      <div class="home-cathumbs">
        <a href="https://jiemahao.com/us/"><img alt="美国电话号码"><h4>美国号码</h4></a>
        <a href="https://jiemahao.com/gb/"><img alt="英国电话号码"><h4>英国号码</h4></a>
        <a href="https://jiemahao.com/ph/"><img alt="菲律宾电话号码"><h4>菲律宾号码</h4></a>
      </div>
    `);

    expect(parseJiemahaoCountryCatalog($)).toEqual([
      {
        countryCode: "+1",
        countryName: "United States",
        sourceUrl: "https://jiemahao.com/us/",
      },
      {
        countryCode: "+44",
        countryName: "United Kingdom",
        sourceUrl: "https://jiemahao.com/gb/",
      },
      {
        countryCode: "+63",
        countryName: "Philippines",
        sourceUrl: "https://jiemahao.com/ph/",
      },
    ]);
  });

  it("parses number cards and detects the turnstile inbox gate", () => {
    const numbers = load(`
      <ul>
        <li>
          <a href="https://jiemahao.com/sms/?phone=105" class="article-title center">+1 5703929888</a>
          <p><span class="tit">2 分钟前</span></p>
        </li>
        <li>
          <a href="https://jiemahao.com/sms/?phone=104" class="article-title center">+1 5074796888</a>
          <p><span class="tit">8 分钟前</span></p>
        </li>
      </ul>
    `);

    expect(
      parseJiemahaoCountryPageNumbers(numbers, provider.descriptor, "United States", "+1"),
    ).toEqual([
      expect.objectContaining({
        providerKey: "jiemahao",
        phoneNumber: "+15703929888",
        countryName: "United States",
        countryCode: "+1",
        latestActivityText: "2 分钟前",
      }),
      expect.objectContaining({
        providerKey: "jiemahao",
        phoneNumber: "+15074796888",
        countryName: "United States",
        countryCode: "+1",
        latestActivityText: "8 分钟前",
      }),
    ]);

    const gate = load(`
      <div>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
        <form><p class="cf-turnstile"></p><button>查看短信</button></form>
      </div>
    `);

    expect(detectJiemahaoGateMessage(gate)).toContain("Turnstile verification");
  });
});
