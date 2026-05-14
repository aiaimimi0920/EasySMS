import { describe, expect, it } from "vitest";

import type { SmsInboxMessage, SmsPublicNumber } from "../../../src/domain/models.js";
import {
  filterSms24LiveNumbers,
  hasRecentSms24VerificationActivity,
  isSms24VerificationLikeMessage,
} from "../../../src/providers/sms24/index.js";

describe("SMS24 liveness", () => {
  it("detects verification-like messages", () => {
    expect(isSms24VerificationLikeMessage({
      content: "尊敬的 LeetCode 用户，您的验证码为：594511，该验证码 5 分钟内有效，请勿泄漏于他人。",
    })).toBe(true);

    expect(isSms24VerificationLikeMessage({
      content: "750 384 is your Instagram code. Don't share it.",
    })).toBe(true);

    expect(isSms24VerificationLikeMessage({
      content: "Welcome to the service. Thanks for joining us.",
    })).toBe(false);
  });

  it("treats numbers as dead when the latest verification SMS is older than 30 minutes", () => {
    const now = new Date("2026-05-13T06:30:00.000Z");
    const messages: SmsInboxMessage[] = [
      {
        id: "1",
        sender: "Marketing",
        receivedAtIso: "2026-05-13T06:25:00.000Z",
        content: "Welcome to the service. Thanks for joining us.",
        sourceUrl: "https://sms24.me/en/numbers/18076957610",
      },
      {
        id: "2",
        sender: "Instagram",
        receivedAtIso: "2026-05-13T05:58:00.000Z",
        content: "750 384 is your Instagram code. Don't share it.",
        sourceUrl: "https://sms24.me/en/numbers/18076957610",
      },
    ];

    expect(hasRecentSms24VerificationActivity(messages, now)).toBe(false);
  });

  it("filters directory numbers to only those with recent verification activity", async () => {
    const now = new Date("2026-05-13T06:30:00.000Z");
    const candidates: SmsPublicNumber[] = [
      {
        providerKey: "sms24",
        providerDisplayName: "SMS24.me",
        numberId: "alive",
        sourceUrl: "https://sms24.me/en/numbers/18076957610",
        phoneNumber: "+18076957610",
        countryName: "Canada",
        countryCode: "+1",
      },
      {
        providerKey: "sms24",
        providerDisplayName: "SMS24.me",
        numberId: "dead",
        sourceUrl: "https://sms24.me/en/numbers/13089290262",
        phoneNumber: "+13089290262",
        countryName: "United States",
        countryCode: "+1",
      },
    ];

    const inboxById: Record<string, SmsInboxMessage[]> = {
      alive: [
        {
          id: "alive-1",
          sender: "LeetCode",
          receivedAtIso: "2026-05-13T06:07:08.000Z",
          content: "尊敬的 LeetCode 用户，您的验证码为：594511，该验证码 5 分钟内有效，请勿泄漏于他人。",
          sourceUrl: "https://sms24.me/en/numbers/18076957610",
        },
      ],
      dead: [
        {
          id: "dead-1",
          sender: "Instagram",
          receivedAtIso: "2026-05-13T05:10:00.000Z",
          content: "750 384 is your Instagram code. Don't share it.",
          sourceUrl: "https://sms24.me/en/numbers/13089290262",
        },
      ],
    };

    const filtered = await filterSms24LiveNumbers(
      candidates,
      async (numberId) => ({
        providerKey: "sms24",
        providerDisplayName: "SMS24.me",
        numberId,
        phoneNumber: candidates.find((item) => item.numberId === numberId)?.phoneNumber ?? "",
        sourceUrl: candidates.find((item) => item.numberId === numberId)?.sourceUrl ?? "",
        fetchedAtIso: new Date().toISOString(),
        messages: inboxById[numberId] ?? [],
      }),
      10,
      now,
    );

    expect(filtered.map((item) => item.numberId)).toEqual(["alive"]);
    expect(filtered[0]?.latestActivityText).toBe("2026-05-13T06:07:08.000Z");
  });
});
