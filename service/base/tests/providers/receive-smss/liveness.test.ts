import { describe, expect, it } from "vitest";

import type { SmsInboxMessage, SmsPublicNumber } from "../../../src/domain/models.js";
import {
  filterReceiveSmssLiveNumbers,
  hasRecentReceiveSmssVerificationActivity,
  isReceiveSmssVerificationLikeMessage,
  parseReceiveSmssRelativeAgeMs,
} from "../../../src/providers/receive_smss/index.js";

describe("Receive-SMSS liveness", () => {
  it("detects verification-like messages", () => {
    expect(isReceiveSmssVerificationLikeMessage({
      content: "Your DENT code is: 842711",
    })).toBe(true);

    expect(isReceiveSmssVerificationLikeMessage({
      content: "[LeetCode力扣]您的注册验证码为：740209，该验证码 5 分钟内有效，请勿泄漏于他人。",
    })).toBe(true);

    expect(isReceiveSmssVerificationLikeMessage({
      content: "Dear Rider, welcome to Uber! Your Uber app is designed to make your booking experience smooth.",
    })).toBe(false);
  });

  it("parses english relative ages used by the site", () => {
    expect(parseReceiveSmssRelativeAgeMs("17 minutes ago")).toBe(17 * 60_000);
    expect(parseReceiveSmssRelativeAgeMs("1 hour ago")).toBe(60 * 60_000);
    expect(parseReceiveSmssRelativeAgeMs("2 days ago")).toBe(2 * 24 * 60 * 60_000);
    expect(parseReceiveSmssRelativeAgeMs("3 month ago")).toBe(3 * 30 * 24 * 60 * 60_000);
  });

  it("treats numbers as dead when the latest verification-like SMS is older than 30 minutes", () => {
    const messages: SmsInboxMessage[] = [
      {
        id: "1",
        sender: "marketing",
        receivedAtText: "5 minutes ago",
        content: "Dear Rider, welcome to Uber! Your Uber app is designed to make your booking experience smooth.",
        sourceUrl: "https://example.com",
      },
      {
        id: "2",
        sender: "sender",
        receivedAtText: "31 minutes ago",
        content: "Your DENT code is: 842711",
        sourceUrl: "https://example.com",
      },
    ];

    expect(hasRecentReceiveSmssVerificationActivity(messages)).toBe(false);
  });

  it("filters directory numbers to only those with recent verification-like activity", async () => {
    const candidates: SmsPublicNumber[] = [
      {
        providerKey: "receive_smss",
        providerDisplayName: "Receive SMSS",
        numberId: "alive",
        sourceUrl: "https://example.com/alive",
        phoneNumber: "+13802603245",
        countryName: "United States",
        countryCode: "+1",
      },
      {
        providerKey: "receive_smss",
        providerDisplayName: "Receive SMSS",
        numberId: "dead",
        sourceUrl: "https://example.com/dead",
        phoneNumber: "+13204457397",
        countryName: "Canada",
        countryCode: "+1",
      },
    ];

    const inboxById: Record<string, SmsInboxMessage[]> = {
      alive: [
        {
          id: "alive-1",
          sender: "Anster",
          receivedAtText: "29 minutes ago",
          content: "[LeetCode力扣]您的注册验证码为：740209，该验证码 5 分钟内有效，请勿泄漏于他人。",
          sourceUrl: "https://example.com/alive",
        },
      ],
      dead: [
        {
          id: "dead-1",
          sender: "Sender",
          receivedAtText: "58 minutes ago",
          content: "Your DENT code is: 842711",
          sourceUrl: "https://example.com/dead",
        },
      ],
    };

    const filtered = await filterReceiveSmssLiveNumbers(
      candidates,
      async (numberId) => ({
        providerKey: "receive_smss",
        providerDisplayName: "Receive SMSS",
        numberId,
        phoneNumber: candidates.find((item) => item.numberId === numberId)?.phoneNumber ?? "",
        sourceUrl: candidates.find((item) => item.numberId === numberId)?.sourceUrl ?? "",
        fetchedAtIso: new Date().toISOString(),
        messages: inboxById[numberId] ?? [],
      }),
      10,
    );

    expect(filtered.map((item) => item.numberId)).toEqual(["alive"]);
    expect(filtered[0]?.latestActivityText).toBe("29 minutes ago");
  });
});
