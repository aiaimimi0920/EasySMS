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
import { OnlineSimProvider, buildOnlineSimApiUrl } from "../../../src/providers/onlinesim/index.js";

describe("OnlineSIM authenticated API usage", () => {
  beforeEach(() => {
    fetchJsonValue.mockReset();
  });

  it("adds apikey query parameter when configured", () => {
    expect(
      buildOnlineSimApiUrl(
        "https://onlinesim.io/api/getFreeList?lang=en",
        "demo-key",
      ),
    ).toBe("https://onlinesim.io/api/getFreeList?lang=en&apikey=demo-key");
  });

  it("leaves API URL unchanged when no apikey is configured", () => {
    expect(buildOnlineSimApiUrl("https://onlinesim.io/api/getFreeList?lang=en", undefined)).toBe(
      "https://onlinesim.io/api/getFreeList?lang=en",
    );
  });

  it("uses the configured apikey for both catalog and country snapshot requests", async () => {
    const seenUrls: string[] = [];
    fetchJsonValue.mockImplementation(async (url: string) => {
      seenUrls.push(url);

      if (url.includes("api/getFreeList")) {
        return {
          response: 1,
          countries: [
            { country: 44, country_text: "Britain", country_original: "United Kingdom" },
          ],
        };
      }

      if (url.includes("/countries/germany?page=1")) {
        return {
          response: 1,
          counties: [
            { country: 44, name: "united_kingdom", online: true },
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

      throw new Error(`Unexpected URL in test: ${url}`);
    });

    const provider = new OnlineSimProvider({
      ...structuredClone(defaultEasySmsRuntimeConfig),
      providers: {
        ...structuredClone(defaultEasySmsRuntimeConfig.providers),
        onlineSim: {
          apiKey: "demo-key",
        },
      },
    });

    const items = await provider.listPublicNumbers({ limit: 1 });
    expect(items).toHaveLength(1);

    const target = items[0];
    await provider.getInbox(target.numberId);

    expect(seenUrls).toContain("https://onlinesim.io/api/getFreeList?lang=en&apikey=demo-key");
    expect(seenUrls).toContain(
      "https://onlinesim.io/api/v1/free_numbers_content/countries/germany?page=1&apikey=demo-key",
    );
    expect(seenUrls).toContain(
      "https://onlinesim.io/api/v1/free_numbers_content/countries/united_kingdom?page=1&apikey=demo-key",
    );
  });
});
