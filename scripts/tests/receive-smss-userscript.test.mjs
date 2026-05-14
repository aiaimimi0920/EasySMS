import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceiveSmssLoginPayload,
  detectReceiveSmssAccessGateHtml,
  hasRecentReceiveSmssVerificationActivity,
  isReceiveSmssVerificationLikeMessage,
  parseReceiveSmssRelativeAgeMs,
} from "../lib/receive-smss-userscript.mjs";

test("buildReceiveSmssLoginPayload mirrors the service/base login form", () => {
  assert.deepEqual(buildReceiveSmssLoginPayload(" vmjcv666 ", "secret"), {
    log: "vmjcv666",
    pwd: "secret",
    redirect_to: "/",
    instance: "",
    action: "login",
  });
});

test("detectReceiveSmssAccessGateHtml detects challenge pages", () => {
  assert.equal(detectReceiveSmssAccessGateHtml("Attention Required! | Cloudflare"), true);
  assert.equal(detectReceiveSmssAccessGateHtml("<html><body>normal inbox</body></html>"), false);
});

test("isReceiveSmssVerificationLikeMessage recognizes OTP-like messages", () => {
  assert.equal(isReceiveSmssVerificationLikeMessage({ content: "Your code is 0719" }), true);
  assert.equal(isReceiveSmssVerificationLikeMessage({ content: "Welcome to our service" }), false);
});

test("parseReceiveSmssRelativeAgeMs parses english relative ages", () => {
  assert.equal(parseReceiveSmssRelativeAgeMs("14 minutes ago"), 14 * 60_000);
  assert.equal(parseReceiveSmssRelativeAgeMs("1 hour ago"), 60 * 60_000);
  assert.equal(parseReceiveSmssRelativeAgeMs("2 days ago"), 2 * 24 * 60 * 60_000);
});

test("hasRecentReceiveSmssVerificationActivity enforces the 30-minute rule", () => {
  assert.equal(hasRecentReceiveSmssVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "14 minutes ago" },
  ]), true);

  assert.equal(hasRecentReceiveSmssVerificationActivity([
    { content: "Your code is 0719", receivedAtText: "2 hours ago" },
  ]), false);
});
