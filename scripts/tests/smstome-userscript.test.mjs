import test from "node:test";
import assert from "node:assert/strict";

import {
  extractSmsToMeLoginChallenge,
  hasRecentSmsToMeVerificationActivity,
  isSmsToMeAccessGateHtml,
  isSmsToMeVerificationLikeMessage,
  parseSmsToMeRelativeAgeMs,
} from "../lib/smstome-userscript.mjs";

test("extractSmsToMeLoginChallenge parses hidden fields and solves inline math captcha", () => {
  assert.deepEqual(extractSmsToMeLoginChallenge(`
    <form method="POST" action="/sign-in">
      <input type="hidden" name="_token" value="token-123">
      <input type="hidden" name="csrf_v" value="MiArIDY=">
      <label for="captchaInput">What is 2 + 6?</label>
    </form>
  `), {
    csrfToken: "token-123",
    csrfV: "MiArIDY=",
    captchaPrompt: "What is 2 + 6?",
    captchaAnswer: "8",
  });
});

test("isSmsToMeAccessGateHtml detects the logged-out gate page", () => {
  assert.equal(
    isSmsToMeAccessGateHtml('<p class="mp-locked__msg">Please log in to view messages for this number.</p>'),
    true,
  );
  assert.equal(
    isSmsToMeAccessGateHtml("<table class='mp-table'><tbody><tr><td>AnsXXX</td></tr></tbody></table>"),
    false,
  );
});

test("isSmsToMeVerificationLikeMessage recognizes OTP-like content", () => {
  assert.equal(
    isSmsToMeVerificationLikeMessage({ content: "[LeetCode力扣]您的注册验证码为：469021" }),
    true,
  );
  assert.equal(
    isSmsToMeVerificationLikeMessage({ content: "983120 is your confirmation code. For your security, do not share this code." }),
    true,
  );
  assert.equal(
    isSmsToMeVerificationLikeMessage({ content: "Welcome to our service" }),
    false,
  );
});

test("parseSmsToMeRelativeAgeMs parses english relative ages", () => {
  assert.equal(parseSmsToMeRelativeAgeMs("3 minutes ago"), 3 * 60_000);
  assert.equal(parseSmsToMeRelativeAgeMs("1 hour ago"), 60 * 60_000);
  assert.equal(parseSmsToMeRelativeAgeMs("2 days ago"), 2 * 24 * 60 * 60_000);
  assert.equal(parseSmsToMeRelativeAgeMs("just now"), 0);
});

test("hasRecentSmsToMeVerificationActivity enforces the 30-minute rule", () => {
  assert.equal(hasRecentSmsToMeVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "3 minutes ago" },
    { content: "Welcome to our service", receivedAtText: "1 minute ago" },
  ]), true);

  assert.equal(hasRecentSmsToMeVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "58 minutes ago" },
  ]), false);
});
