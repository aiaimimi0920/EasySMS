import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchJsonValue } = vi.hoisted(() => ({
  fetchJsonValue: vi.fn(),
}));

vi.mock("../../../src/shared/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/shared/index.js")>(
    "../../../src/shared/index.js",
  );
  return {
    ...actual,
    fetchJsonValue,
  };
});

import { defaultEasySmsRuntimeConfig } from "../../../src/defaults/index.js";
import {
  OnlineSimProvider,
  hasRecentOnlineSimVerificationActivity,
  isOnlineSimVerificationLikeMessage,
} from "../../../src/providers/onlinesim/index.js";

describe("OnlineSIM liveness filter", () => {
  beforeEach(() => {
    fetchJsonValue.mockReset();
  });

  it("treats bare digit OTP messages as verification-like but ignores generic spam", () => {
    expect(isOnlineSimVerificationLikeMessage({ text: "1‍0‍6‍‍5‍9‍‍0‍" })).toBe(true);
    expect(isOnlineSimVerificationLikeMessage({ text: "Your verification code is 123456" })).toBe(true);
    expect(isOnlineSimVerificationLikeMessage({ text: "Jacob System Notification: accepted successfully" })).toBe(
      false,
    );
  });

  it("uses the latest verification-like message age, not just any fresh message", () => {
    expect(
      hasRecentOnlineSimVerificationActivity({
        number: {
          updated_at: "2026-05-12 19:32:14",
        },
        messages: {
          data: [
            {
              id: 1,
              text: "generic spam 123456789",
              created_at: "2026-05-12 19:32:14",
              data_humans: "1 минуту назад",
            },
            {
              id: 2,
              text: "[LeetCode力扣]您的注册验证码为：906421",
              created_at: "2026-05-12 19:00:24",
              data_humans: "32 минуты назад",
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      hasRecentOnlineSimVerificationActivity({
        number: {
          updated_at: "2026-05-12 19:32:14",
        },
        messages: {
          data: [
            {
              id: 5,
              text: "Your verification code is 123456",
              created_at: "2026-05-12 10:30:24",
              data_humans: "9 часов назад",
            },
          ],
        },
      }),
    ).toBe(false);

    expect(
      hasRecentOnlineSimVerificationActivity({
        number: {
          updated_at: "2026-05-12 19:32:14",
        },
        messages: {
          data: [
            {
              id: 3,
              text: "generic spam 123456789",
              created_at: "2026-05-12 19:32:14",
              data_humans: "1 минуту назад",
            },
            {
              id: 4,
              text: "[LeetCode力扣]您的注册验证码为：906421",
              created_at: "2026-05-12 19:30:24",
              data_humans: "3 минуты назад",
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("lists only fresh country-primary numbers for onlinesim", async () => {
    fetchJsonValue.mockImplementation(async (url: string) => {
      if (url.includes("api/getFreeList")) {
        return {
          response: 1,
          countries: [
            { country: 44, country_text: "Britain", country_original: "United Kingdom" },
            { country: 34, country_text: "Spain", country_original: "Spain" },
          ],
        };
      }

      if (url.includes("/countries/germany?page=1")) {
        return {
          response: 1,
          counties: [
            { country: 44, name: "united_kingdom", online: true },
            { country: 34, name: "spain", online: true },
          ],
          number: { full_number: "4915511267525", updated_at: "2026-05-12 19:32:14" },
          messages: { data: [] },
        };
      }

      if (url.includes("/countries/united_kingdom?page=1")) {
        return {
          response: 1,
          number: {
            full_number: "447308892741",
            updated_at: "2026-05-12 19:32:14",
            data_humans: "1 минуту назад",
          },
          messages: {
            data: [
              {
                id: 101,
                text: "Your verification code is 123456",
                created_at: "2026-05-12 19:30:24",
                data_humans: "3 минуты назад",
              },
            ],
          },
        };
      }

      if (url.includes("/countries/spain?page=1")) {
        return {
          response: 1,
          number: {
            full_number: "34690124664",
            updated_at: "2026-05-12 19:32:14",
            data_humans: "1 минуту назад",
          },
          messages: {
            data: [
              {
                id: 201,
                text: "Jacob System Notification: accepted successfully",
                created_at: "2026-05-12 19:32:14",
                data_humans: "1 минуту назад",
              },
              {
                id: 202,
                text: "[LeetCode力扣]您的注册验证码为：906421",
                created_at: "2026-05-12 19:00:24",
                data_humans: "32 минуты назад",
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const provider = new OnlineSimProvider(structuredClone(defaultEasySmsRuntimeConfig));
    const items = await provider.listPublicNumbers({ limit: 10 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      providerKey: "onlinesim",
      phoneNumber: "+447308892741",
      countryName: "Britain",
      countryCode: "+44",
      latestActivityText: "3 минуты назад",
    });
  });
});
