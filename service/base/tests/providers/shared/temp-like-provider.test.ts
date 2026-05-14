import { describe, expect, it, vi } from "vitest";

import { resolveTempLikeDocumentFetcher } from "../../../src/providers/shared/temp-like-provider.js";

describe("TempLikeProvider fetch mode", () => {
  it("uses browser-native-ua fetcher when requested", () => {
    const browserDocument = {} as never;
    const htmlFetcher = vi.fn(async () => ({} as never));
    const browserFetcher = vi.fn(async () => browserDocument);

    const selected = resolveTempLikeDocumentFetcher("browser-native-ua", {
      htmlFetcher,
      browserNativeUaFetcher: browserFetcher,
    });

    return selected("https://example.com", {} as never, "https://ref.example").then((result) => {
      expect(result).toBe(browserDocument);
      expect(browserFetcher).toHaveBeenCalledWith("https://example.com", expect.anything());
      expect(htmlFetcher).not.toHaveBeenCalled();
    });
  });

  it("uses plain html fetcher by default", () => {
    const htmlDocument = {} as never;
    const htmlFetcher = vi.fn(async () => htmlDocument);
    const browserFetcher = vi.fn(async () => ({} as never));

    const selected = resolveTempLikeDocumentFetcher(undefined, {
      htmlFetcher,
      browserNativeUaFetcher: browserFetcher,
    });

    return selected("https://example.com", {} as never, "https://ref.example").then((result) => {
      expect(result).toBe(htmlDocument);
      expect(htmlFetcher).toHaveBeenCalledWith("https://example.com", expect.anything(), "https://ref.example");
      expect(browserFetcher).not.toHaveBeenCalled();
    });
  });
});
