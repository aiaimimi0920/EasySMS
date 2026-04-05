import { describe, expect, it } from "vitest";

import {
  buildQuackrNumberUrl,
  getQuackrCountryMetadata,
  parseQuackrAddedAt,
} from "../../../src/providers/quackr/catalog.js";

describe("Quackr catalog", () => {
  it("maps locale metadata to stable country slugs", () => {
    expect(getQuackrCountryMetadata("uk")).toEqual({
      locale: "uk",
      countryName: "United Kingdom",
      countryCode: "+44",
      slug: "united-kingdom",
    });
    expect(buildQuackrNumberUrl("united-kingdom", "447700900123")).toBe(
      "https://quackr.io/temporary-numbers/united-kingdom/447700900123",
    );
  });

  it("normalizes both millisecond and second timestamps", () => {
    expect(parseQuackrAddedAt("1706812302000")).toBe(1706812302000);
    expect(parseQuackrAddedAt("1768487551")).toBe(1768487551000);
  });
});
