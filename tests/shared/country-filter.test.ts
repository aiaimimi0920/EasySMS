import { describe, expect, it } from "vitest";

import { inferCountryCode, matchesCountryFilter } from "../../src/shared/index.js";

describe("country helpers", () => {
  it("maps Chinese country names to dial codes", () => {
    expect(inferCountryCode("瑞典")).toBe("+46");
    expect(inferCountryCode("葡萄牙")).toBe("+351");
    expect(inferCountryCode("菲律宾")).toBe("+63");
  });

  it("matches translated country names through dial-code fallback", () => {
    expect(matchesCountryFilter("+46", "Sweden", undefined, "瑞典")).toBe(true);
    expect(matchesCountryFilter("+351", "Portugal", undefined, "葡萄牙")).toBe(true);
    expect(matchesCountryFilter("+63", "Philippines", undefined, "菲律宾")).toBe(true);
    expect(matchesCountryFilter("+49", "Germany", undefined, "瑞典")).toBe(false);
  });
});
