import { load } from "cheerio";
import { describe, expect, it, vi } from "vitest";

import {
  TempLikeProvider,
  resolveTempLikeDocumentFetcher,
} from "../../../src/providers/shared/temp-like-provider.js";

describe("TempLikeProvider pure HTTP fetcher", () => {
  it("uses plain html fetcher by default", async () => {
    const htmlDocument = {} as never;
    const htmlFetcher = vi.fn(async () => htmlDocument);

    const selected = resolveTempLikeDocumentFetcher({
      htmlFetcher,
    });

    const result = await selected("https://example.com", {} as never, "https://ref.example");
    expect(result).toBe(htmlDocument);
    expect(htmlFetcher).toHaveBeenCalledWith("https://example.com", expect.anything(), "https://ref.example");
  });

  it("supports an explicit custom HTTP documentFetcher override", async () => {
    const customFetcher = vi.fn(async () =>
      load('<a href="/us-phone/12025550199/">United States +12025550199</a>'),
    );

    const provider = new TempLikeProvider(
      {
        scraping: {
          maxNumbersPerProvider: 10,
          requestTimeoutMs: 15_000,
          userAgent: "Mozilla/5.0",
        },
      } as never,
      {
        descriptor: {
          key: "receive_sms_free_cc",
          displayName: "Example Temp Provider",
          homepageUrl: "https://example.com",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["list-public-numbers"],
          enabled: true,
          notes: [],
        },
        listUrl: "https://example.com/list",
        linkMatcher: /\/us-phone\/\d+\/$/i,
        documentFetcher: customFetcher,
      },
    );

    const items = await provider.listPublicNumbers({ limit: 5 });
    expect(customFetcher).toHaveBeenCalledWith("https://example.com/list", expect.anything(), "https://example.com");
    expect(items).toHaveLength(1);
    expect(items[0]?.phoneNumber).toBe("+12025550199");
  });

  it("strips Free prefix and Phone Number suffix when extracting countryName", async () => {
    const customFetcher = vi.fn(async () =>
      load('<a href="/Free-USA-Phone-Number/12543207594/">Free United States Phone Number +1 2543207594</a>'),
    );

    const provider = new TempLikeProvider(
      {
        scraping: {
          maxNumbersPerProvider: 10,
          requestTimeoutMs: 15_000,
          userAgent: "Mozilla/5.0",
        },
      } as never,
      {
        descriptor: {
          key: "receive_sms_free_cc",
          displayName: "Example Temp Provider",
          homepageUrl: "https://example.com",
          sourceType: "public-web-scrape",
          costTier: "free",
          capabilities: ["list-public-numbers"],
          enabled: true,
          notes: [],
        },
        listUrl: "https://example.com/list",
        linkMatcher: /\/Free-[A-Za-z-]+-Phone-Number\/\d+\/?$/i,
        documentFetcher: customFetcher,
      },
    );

    const items = await provider.listPublicNumbers({ limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      phoneNumber: "+1 2543207594",
      countryName: "United States",
      countryCode: "+1",
    });
  });
});
