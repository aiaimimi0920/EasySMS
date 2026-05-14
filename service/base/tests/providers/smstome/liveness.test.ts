import { describe, expect, it } from "vitest";

import type { SmsInboxMessage, SmsPublicNumber } from "../../../src/domain/models.js";
import {
  filterSmsToMeLiveNumbers,
  hasRecentSmsToMeVerificationActivity,
  isSmsToMeVerificationLikeMessage,
  parseSmsToMeRelativeAgeMs,
} from "../../../src/providers/smstome/index.js";

describe("SMSToMe liveness", () => {
  it("detects verification-like messages", () => {
    expect(isSmsToMeVerificationLikeMessage({
      content: "Your Lovart verification code is: 706444",
    })).toBe(true);

    expect(isSmsToMeVerificationLikeMessage({
      content: "[LeetCode力扣]您的注册验证码为：469021，该验证码 5 分钟内有效，请勿泄漏于他人。",
    })).toBe(true);

    expect(isSmsToMeVerificationLikeMessage({
      content: "Welcome to the service. Thanks for joining us.",
    })).toBe(false);
  });

  it("parses english relative ages", () => {
    expect(parseSmsToMeRelativeAgeMs("3 minutes ago")).toBe(3 * 60_000);
    expect(parseSmsToMeRelativeAgeMs("1 hour ago")).toBe(60 * 60_000);
    expect(parseSmsToMeRelativeAgeMs("2 days ago")).toBe(2 * 24 * 60 * 60_000);
    expect(parseSmsToMeRelativeAgeMs("just now")).toBe(0);
  });

  it("treats numbers as dead when the latest verification sms is older than 30 minutes", () => {
    const messages: SmsInboxMessage[] = [
      {
        id: "1",
        sender: "Marketing",
        receivedAtText: "5 minutes ago",
        content: "Welcome to the service. Thanks for joining us.",
        sourceUrl: "https://smstome.com/united-kingdom/phone/447575396027/sms/16039",
      },
      {
        id: "2",
        sender: "Facebook",
        receivedAtText: "58 minutes ago",
        content: "983120 is your confirmation code. For your security, do not share this code.",
        sourceUrl: "https://smstome.com/united-kingdom/phone/447575396027/sms/16039",
      },
    ];

    expect(hasRecentSmsToMeVerificationActivity(messages)).toBe(false);
  });

  it("filters directory numbers to only those with recent verification activity", async () => {
    const candidates: SmsPublicNumber[] = [
      {
        providerKey: "smstome",
        providerDisplayName: "SMSToMe",
        numberId: "alive",
        sourceUrl: "https://smstome.com/united-kingdom/phone/447575396027/sms/16039",
        phoneNumber: "+447575396027",
        countryName: "United Kingdom",
        countryCode: "+44",
        latestActivityText: "Added 10 hours ago",
      },
      {
        providerKey: "smstome",
        providerDisplayName: "SMSToMe",
        numberId: "dead",
        sourceUrl: "https://smstome.com/united-kingdom/phone/447575395780/sms/16038",
        phoneNumber: "+447575395780",
        countryName: "United Kingdom",
        countryCode: "+44",
        latestActivityText: "Added 10 hours ago",
      },
    ];

    const inboxById: Record<string, SmsInboxMessage[]> = {
      alive: [
        {
          id: "alive-1",
          sender: "AnsXXX",
          receivedAtText: "9 minutes ago",
          content: "[LeetCode力扣]您的注册验证码为：469021，该验证码 5 分钟内有效，请勿泄漏于他人。",
          sourceUrl: "https://smstome.com/united-kingdom/phone/447575396027/sms/16039",
        },
      ],
      dead: [
        {
          id: "dead-1",
          sender: "Facebook",
          receivedAtText: "58 minutes ago",
          content: "983120 is your confirmation code. For your security, do not share this code.",
          sourceUrl: "https://smstome.com/united-kingdom/phone/447575395780/sms/16038",
        },
      ],
    };

    const filtered = await filterSmsToMeLiveNumbers(
      candidates,
      async (numberId) => ({
        providerKey: "smstome",
        providerDisplayName: "SMSToMe",
        numberId,
        phoneNumber: candidates.find((item) => item.numberId === numberId)?.phoneNumber ?? "",
        sourceUrl: candidates.find((item) => item.numberId === numberId)?.sourceUrl ?? "",
        fetchedAtIso: new Date().toISOString(),
        messages: inboxById[numberId] ?? [],
      }),
      10,
    );

    expect(filtered.map((item) => item.numberId)).toEqual(["alive"]);
    expect(filtered[0]?.latestActivityText).toBe("9 minutes ago");
  });
});
