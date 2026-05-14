import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOnlineSimApiUrl,
  hasRecentOnlineSimVerificationActivity,
  isOnlineSimVerificationLikeMessage,
  parseOnlineSimRelativeAgeMs,
} from "../lib/onlinesim-userscript.mjs";

test("buildOnlineSimApiUrl appends apikey when configured", () => {
  assert.equal(
    buildOnlineSimApiUrl("https://onlinesim.io/api/getFreeList?lang=en", "demo-key"),
    "https://onlinesim.io/api/getFreeList?lang=en&apikey=demo-key",
  );
  assert.equal(
    buildOnlineSimApiUrl("https://onlinesim.io/api/getFreeList?lang=en", ""),
    "https://onlinesim.io/api/getFreeList?lang=en",
  );
});

test("isOnlineSimVerificationLikeMessage recognizes OTP-like content", () => {
  assert.equal(isOnlineSimVerificationLikeMessage({ text: "469021" }), true);
  assert.equal(isOnlineSimVerificationLikeMessage({ text: "Your code is 123456" }), true);
  assert.equal(isOnlineSimVerificationLikeMessage({ text: "welcome aboard" }), false);
});

test("parseOnlineSimRelativeAgeMs parses russian relative ages", () => {
  assert.equal(parseOnlineSimRelativeAgeMs("3 минут назад"), 3 * 60_000);
  assert.equal(parseOnlineSimRelativeAgeMs("1 час назад"), 60 * 60_000);
  assert.equal(parseOnlineSimRelativeAgeMs("2 дн назад"), 2 * 24 * 60 * 60_000);
});

test("hasRecentOnlineSimVerificationActivity enforces the 20-minute rule", () => {
  assert.equal(hasRecentOnlineSimVerificationActivity({
    number: { updated_at: "2026-05-13 12:00:00" },
    messages: {
      data: [
        { text: "Your code is 123456", created_at: "2026-05-13 11:45:00" },
      ],
    },
  }), true);

  assert.equal(hasRecentOnlineSimVerificationActivity({
    number: { updated_at: "2026-05-13 12:00:00" },
    messages: {
      data: [
        { text: "Your code is 123456", created_at: "2026-05-13 11:20:00" },
      ],
    },
  }), false);
});
