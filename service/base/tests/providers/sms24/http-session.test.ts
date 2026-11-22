import { describe, expect, it } from "vitest";

import {
  detectSms24AccessGateHtml,
  fetchSms24Html,
  getSms24UserAgents,
} from "../../../src/providers/sms24/session-helper.js";

describe("SMS24 Web HTTP helper", () => {
  it("detects challenge HTML", () => {
    expect(detectSms24AccessGateHtml(
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>",
    )).toBe(true);

    expect(detectSms24AccessGateHtml(
      "<dl id=\"sms_msg\"><dt class=\"mt-3\"><div data-created=\"2026-05-13T06:07:08.000000Z\">&nbsp</div></dt></dl>",
    )).toBe(false);
  });

  it("exposes fallback browser user agents for pure Web fetch", () => {
    expect(getSms24UserAgents().length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the next user-agent profile when the first fetch fails", async () => {
    const seenUserAgents: string[] = [];
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenUserAgents.push(headers.get("user-agent") ?? "");
      if (seenUserAgents.length === 1) {
        return new Response("Upstream error", { status: 502 });
      }
      return new Response("<html><body>sms24 directory</body></html>", { status: 200 });
    };

    const html = await fetchSms24Html(
      "https://sms24.me/en/numbers",
      { scraping: { requestTimeoutMs: 10_000 } } as never,
      fetchImpl,
    );

    expect(html).toContain("sms24 directory");
    expect(seenUserAgents).toHaveLength(2);
    expect(seenUserAgents[0]).not.toBe(seenUserAgents[1]);
  });
});
