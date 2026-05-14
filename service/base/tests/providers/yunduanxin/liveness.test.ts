import { describe, expect, it } from "vitest";

import type { SmsInboxMessage, SmsPublicNumber } from "../../../src/domain/models.js";
import {
  filterYunDuanXinLiveNumbers,
  hasRecentYunDuanXinVerificationActivity,
  isYunDuanXinVerificationLikeMessage,
  parseYunDuanXinRelativeAgeMs,
} from "../../../src/providers/yunduanxin/index.js";

describe("YunDuanXin liveness", () => {
  it("detects verification-like messages", () => {
    expect(isYunDuanXinVerificationLikeMessage({
      content: "您的验证码为：594511，该验证码 5 分钟内有效，请勿泄漏于他人。",
    })).toBe(true);

    expect(isYunDuanXinVerificationLikeMessage({
      content: "Your Reddit verification code is: 716280YhbEQdX/OGn",
    })).toBe(true);

    expect(isYunDuanXinVerificationLikeMessage({
      content: "La-Z-Boy: Reply Y to subscribe to recurring automated personalized marketing alerts.",
    })).toBe(false);
  });

  it("parses Chinese relative ages used by the site", () => {
    expect(parseYunDuanXinRelativeAgeMs("24分钟前")).toBe(24 * 60_000);
    expect(parseYunDuanXinRelativeAgeMs("15小时前")).toBe(15 * 60 * 60_000);
    expect(parseYunDuanXinRelativeAgeMs("2天前")).toBe(2 * 24 * 60 * 60_000);
    expect(parseYunDuanXinRelativeAgeMs("3月前")).toBe(3 * 30 * 24 * 60 * 60_000);
  });

  it("treats numbers as dead when the latest verification SMS is older than 30 minutes", () => {
    const messages: SmsInboxMessage[] = [
      {
        id: "1",
        sender: "营销",
        receivedAtText: "5分钟前",
        content: "欢迎使用我们的服务。",
        sourceUrl: "https://yunduanxin.net/info/16125626619/",
      },
      {
        id: "2",
        sender: "Google",
        receivedAtText: "58分钟前",
        content: "G-507920 is your Google verification code. Don't share your code with anyone.",
        sourceUrl: "https://yunduanxin.net/info/16125626619/",
      },
    ];

    expect(hasRecentYunDuanXinVerificationActivity(messages)).toBe(false);
  });

  it("filters directory numbers to only those with recent verification activity", async () => {
    const candidates: SmsPublicNumber[] = [
      {
        providerKey: "yunduanxin",
        providerDisplayName: "云短信",
        numberId: "alive",
        sourceUrl: "https://yunduanxin.net/info/16465180948/",
        phoneNumber: "+16465180948",
        countryName: "美国",
        countryCode: "+1",
      },
      {
        providerKey: "yunduanxin",
        providerDisplayName: "云短信",
        numberId: "dead",
        sourceUrl: "https://yunduanxin.net/info/16125626619/",
        phoneNumber: "+16125626619",
        countryName: "美国",
        countryCode: "+1",
      },
    ];

    const inboxById: Record<string, SmsInboxMessage[]> = {
      alive: [
        {
          id: "alive-1",
          sender: "Samsung",
          receivedAtText: "24分钟前",
          content: "Account: 217337 is your Samsung account verification code.",
          sourceUrl: "https://yunduanxin.net/info/16465180948/",
        },
      ],
      dead: [
        {
          id: "dead-1",
          sender: "Google",
          receivedAtText: "3月前",
          content: "G-507920 is your Google verification code. Don't share your code with anyone.",
          sourceUrl: "https://yunduanxin.net/info/16125626619/",
        },
      ],
    };

    const filtered = await filterYunDuanXinLiveNumbers(
      candidates,
      async (numberId) => ({
        providerKey: "yunduanxin",
        providerDisplayName: "云短信",
        numberId,
        phoneNumber: candidates.find((item) => item.numberId === numberId)?.phoneNumber ?? "",
        sourceUrl: candidates.find((item) => item.numberId === numberId)?.sourceUrl ?? "",
        fetchedAtIso: new Date().toISOString(),
        messages: inboxById[numberId] ?? [],
      }),
      10,
    );

    expect(filtered.map((item) => item.numberId)).toEqual(["alive"]);
    expect(filtered[0]?.latestActivityText).toBe("24分钟前");
  });
});
