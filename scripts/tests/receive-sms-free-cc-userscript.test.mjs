import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceiveSmsFreeCcLoginPayload,
  hasRecentReceiveSmsFreeCcVerificationActivity,
  isReceiveSmsFreeCcAccessGateHtml,
  isReceiveSmsFreeCcVerificationLikeMessage,
  md5Hex,
  parseReceiveSmsFreeCcRelativeAgeMs,
} from "../lib/receive-sms-free-cc-userscript.mjs";

test("md5Hex matches the expected password hash", () => {
  assert.equal(md5Hex("Qq365210!@#$%^"), "c9c25f04839766d074fcfa35bf6c383b");
});

test("buildReceiveSmsFreeCcLoginPayload trims email and hashes password", () => {
  assert.deepEqual(buildReceiveSmsFreeCcLoginPayload(" user@example.com ", "secret"), {
    mail: "user@example.com",
    password: md5Hex("secret"),
  });
});

test("isReceiveSmsFreeCcAccessGateHtml detects the login wall", () => {
  assert.equal(
    isReceiveSmsFreeCcAccessGateHtml("Unfortunately, Due To Security Concerns, Virtual Numbers Are Required To register Or login In Before Accessing The Content."),
    true,
  );
  assert.equal(isReceiveSmsFreeCcAccessGateHtml("<div>normal inbox</div>"), false);
});

test("isReceiveSmsFreeCcVerificationLikeMessage recognizes OTP-like messages", () => {
  assert.equal(isReceiveSmsFreeCcVerificationLikeMessage({ content: "Your code is 0719" }), true);
  assert.equal(isReceiveSmsFreeCcVerificationLikeMessage({ content: "Welcome aboard" }), false);
});

test("parseReceiveSmsFreeCcRelativeAgeMs parses english relative ages", () => {
  assert.equal(parseReceiveSmsFreeCcRelativeAgeMs("14 minutes ago"), 14 * 60_000);
  assert.equal(parseReceiveSmsFreeCcRelativeAgeMs("1 hour ago"), 60 * 60 * 1000);
  assert.equal(parseReceiveSmsFreeCcRelativeAgeMs("2 days ago"), 2 * 24 * 60 * 60 * 1000);
});

test("hasRecentReceiveSmsFreeCcVerificationActivity enforces the 30-minute rule", () => {
  assert.equal(hasRecentReceiveSmsFreeCcVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "14 minutes ago" },
  ]), true);

  assert.equal(hasRecentReceiveSmsFreeCcVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "2 hours ago" },
  ]), false);
});
