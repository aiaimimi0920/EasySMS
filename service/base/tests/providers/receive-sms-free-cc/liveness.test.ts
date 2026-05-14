import { describe, expect, it } from "vitest";

import type { SmsInboxMessage, SmsPublicNumber } from "../../../src/domain/models.js";
import {
  filterReceiveSmsFreeCcLiveNumbers,
  hasRecentReceiveSmsFreeCcVerificationActivity,
  isReceiveSmsFreeCcVerificationLikeMessage,
  parseReceiveSmsFreeCcRelativeAgeMs,
} from "../../../src/providers/receive_sms_free_cc/index.js";

describe("Receive-SMS-Free.cc liveness", () => {
  it("detects verification-like messages", () => {
    expect(isReceiveSmsFreeCcVerificationLikeMessage({
      content: "【LeetCode力扣】您的验证码为 811434，5 分钟内有效。",
    })).toBe(true);

    expect(isReceiveSmsFreeCcVerificationLikeMessage({
      content: "Your verification code is: 739467.",
    })).toBe(true);

    expect(isReceiveSmsFreeCcVerificationLikeMessage({
      content: "We're connecting you directly with the person delivering your order.",
    })).toBe(false);
  });

  it("parses english relative ages used by the site", () => {
    expect(parseReceiveSmsFreeCcRelativeAgeMs("43 sec ago")).toBe(43_000);
    expect(parseReceiveSmsFreeCcRelativeAgeMs("6 min ago")).toBe(6 * 60_000);
    expect(parseReceiveSmsFreeCcRelativeAgeMs("2 hours ago")).toBe(2 * 60 * 60_000);
    expect(parseReceiveSmsFreeCcRelativeAgeMs("3 month ago")).toBe(3 * 30 * 24 * 60 * 60_000);
  });

  it("treats numbers as dead when the latest verification-like SMS is older than 30 minutes", () => {
    const messages: SmsInboxMessage[] = [
      {
        id: "1",
        sender: "marketing",
        receivedAtText: "2 min ago",
        content: "We're connecting you directly with the person delivering your order.",
        sourceUrl: "https://example.com",
      },
      {
        id: "2",
        sender: "service",
        receivedAtText: "31 min ago",
        content: "Your verification code is: 123456.",
        sourceUrl: "https://example.com",
      },
    ];

    expect(hasRecentReceiveSmsFreeCcVerificationActivity(messages)).toBe(false);
  });

  it("filters directory numbers to only those with recent verification-like activity", async () => {
    const candidates: SmsPublicNumber[] = [
      {
        providerKey: "receive_sms_free_cc",
        providerDisplayName: "Receive-SMS-Free.cc",
        numberId: "alive",
        sourceUrl: "https://example.com/alive",
        phoneNumber: "+16465180948",
        countryName: "United States",
        countryCode: "+1",
        latestActivityText: "23 min ago",
      },
      {
        providerKey: "receive_sms_free_cc",
        providerDisplayName: "Receive-SMS-Free.cc",
        numberId: "dead",
        sourceUrl: "https://example.com/dead",
        phoneNumber: "+19492649628",
        countryName: "United States",
        countryCode: "+1",
        latestActivityText: "3 month ago",
      },
    ];

    const inboxById: Record<string, SmsInboxMessage[]> = {
      alive: [
        {
          id: "alive-1",
          sender: "LeetCode",
          receivedAtText: "43 sec ago",
          content: "【LeetCode力扣】您的验证码为 811434，5 分钟内有效。",
          sourceUrl: "https://example.com/alive",
        },
      ],
      dead: [
        {
          id: "dead-1",
          sender: "outlook",
          receivedAtText: "3 month ago",
          content: "Use 736670 to verify stepcox1999@outlook.com using Chrome 148 on Windows 10",
          sourceUrl: "https://example.com/dead",
        },
      ],
    };

    const filtered = await filterReceiveSmsFreeCcLiveNumbers(
      candidates,
      async (numberId) => ({
        providerKey: "receive_sms_free_cc",
        providerDisplayName: "Receive-SMS-Free.cc",
        numberId,
        phoneNumber: candidates.find((item) => item.numberId === numberId)?.phoneNumber ?? "",
        sourceUrl: candidates.find((item) => item.numberId === numberId)?.sourceUrl ?? "",
        fetchedAtIso: new Date().toISOString(),
        messages: inboxById[numberId] ?? [],
      }),
    );

    expect(filtered.map((item) => item.numberId)).toEqual(["alive"]);
    expect(filtered[0]?.latestActivityText).toBe("43 sec ago");
  });
});
