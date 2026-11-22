import { describe, expect, it } from "vitest";

import {
  buildReceiveSmsFreeCcLoginPayload,
  fetchReceiveSmsFreeCcHtml,
  isReceiveSmsFreeCcAccessGateHtml,
} from "../../../src/providers/receive_sms_free_cc/session-helper.js";

describe("Receive-SMS-Free.cc Web HTTP session helper", () => {
  it("builds the ajax login payload with the pure-TS md5-hashed password expected by the site", () => {
    expect(buildReceiveSmsFreeCcLoginPayload("user@example.test", "example-password")).toEqual({
      mail: "user@example.test",
      password: "cc4436eff149ba9761aaac07b36360ea",
    });
  });

  it("detects the HTML access gate used when SMS content is not available", () => {
    expect(isReceiveSmsFreeCcAccessGateHtml(
      "<p>Unfortunately, Due To Security Concerns, Virtual Numbers Are Required To register Or login In Before Accessing The Content.</p>",
    )).toBe(true);

    expect(isReceiveSmsFreeCcAccessGateHtml(
      "<div class=\"sms-item\"><p class=\"sms-content\">[LeetCode力扣]您的注册验证码为：601210，该验证码 5 分钟内有效，请勿泄漏于他人。</p></div>",
    )).toBe(false);
  });

  it("performs cookie-jar login bootstrap before fetching protected directory pages", async () => {
    const requests: Array<{ url: string; method: string; cookie: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method ?? "GET",
        cookie: headers.get("cookie"),
      });

      if (url === "https://receive-sms-free.cc/auth/login") {
        return new Response("<html>login</html>", {
          status: 200,
          headers: { "set-cookie": "PHPSESSID=boot-123; Path=/" },
        });
      }
      if (url === "https://receive-sms-free.cc/ajax/login") {
        return new Response(JSON.stringify({ status: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "member_token=auth-456; Path=/",
          },
        });
      }
      return new Response("<html><body>receive-sms-free directory</body></html>", { status: 200 });
    };

    const html = await fetchReceiveSmsFreeCcHtml(
      "https://receive-sms-free.cc/regions/",
      { scraping: { requestTimeoutMs: 15_000, userAgent: "Mozilla/5.0" } } as never,
      { email: "user@example.test", password: "example-password" },
      fetchImpl,
    );

    expect(html).toContain("receive-sms-free directory");
    expect(requests.map((item) => item.url)).toEqual([
      "https://receive-sms-free.cc/auth/login",
      "https://receive-sms-free.cc/ajax/login",
      "https://receive-sms-free.cc/regions/",
    ]);
    expect(requests[2]?.cookie).toContain("PHPSESSID=boot-123");
    expect(requests[2]?.cookie).toContain("member_token=auth-456");
  });
});
