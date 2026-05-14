import { describe, expect, it } from "vitest";

import {
  extractSmsToMeLoginChallenge,
  getSmsToMeImpersonationProfiles,
  isSmsToMeAccessGateHtml,
} from "../../../src/providers/smstome/session-helper.js";

describe("SMSToMe HTTP session helper", () => {
  it("extracts the login csrf fields and solves the inline math captcha", () => {
    expect(extractSmsToMeLoginChallenge(`
      <form method="POST" action="/sign-in">
        <input type="hidden" name="_token" value="token-123">
        <input type="hidden" name="csrf_v" value="MiArIDY=">
        <label for="captchaInput">What is 2 + 6?</label>
      </form>
    `)).toEqual({
      csrfToken: "token-123",
      csrfV: "MiArIDY=",
      captchaPrompt: "What is 2 + 6?",
      captchaAnswer: "8",
    });
  });

  it("detects the locked html gate used when number content is hidden", () => {
    expect(isSmsToMeAccessGateHtml(
      '<p class="mp-locked__msg">Please log in to view messages for this number.</p>',
    )).toBe(true);

    expect(isSmsToMeAccessGateHtml(
      '<table class="mp-table"><tbody><tr><td>AnsXXX</td><td>9 minutes ago</td><td>[LeetCode力扣]您的注册验证码为：469021</td></tr></tbody></table>',
    )).toBe(false);
  });

  it("prefers the proven impersonation fallback profiles before newer blocked ones", () => {
    expect(getSmsToMeImpersonationProfiles()).toEqual([
      "chrome101",
      "edge101",
      "chrome99",
      "chrome136",
    ]);
  });
});
