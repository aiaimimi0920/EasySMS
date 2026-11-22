import { describe, expect, it } from "vitest";

import {
  detectSmsToMeCaptchaChallenge,
  fetchSmsToMeHtml,
  isSmsToMeAccessGateHtml,
} from "../../../src/providers/smstome/session-helper.js";

describe("SMSToMe Web HTTP session helper", () => {
  it("detects the locked html gate used when number content is hidden", () => {
    expect(isSmsToMeAccessGateHtml(
      '<p class="mp-locked__msg">Please log in to view messages for this number.</p>',
    )).toBe(true);

    expect(isSmsToMeAccessGateHtml(
      '<table class="mp-table"><tbody><tr><td>AnsXXX</td><td>9 minutes ago</td><td>[LeetCode力扣]您的注册验证码为：469021</td></tr></tbody></table>',
    )).toBe(false);
  });

  it("detects captcha challenges on sign-in pages and fails closed without attempting to solve them", async () => {
    const captchaSignInHtml = `
      <form method="POST" action="/sign-in">
        <input type="hidden" name="_token" value="token-123">
        <label for="captchaInput">What is 2 + 6?</label>
      </form>
    `;
    expect(detectSmsToMeCaptchaChallenge(captchaSignInHtml)).toBe(true);

    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://smstome.com/sign-in") {
        return new Response(captchaSignInHtml, { status: 200 });
      }
      return new Response('<p class="mp-locked__msg">Please log in to view messages for this number.</p>', {
        status: 200,
      });
    };

    await expect(
      fetchSmsToMeHtml(
        "https://smstome.com/united-kingdom/phone/447575396027/sms/16039",
        { scraping: { requestTimeoutMs: 10_000, userAgent: "Mozilla/5.0" } } as never,
        { email: "user@example.test", password: "test-password" },
        fetchImpl,
      ),
    ).rejects.toThrow("captcha");
  });
});
