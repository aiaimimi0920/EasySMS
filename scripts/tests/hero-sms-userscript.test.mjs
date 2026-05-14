import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHeroSmsLeaseSummary,
  isHeroSmsCancelableNow,
} from "../lib/hero-sms-userscript.mjs";

test("isHeroSmsCancelableNow becomes true after the refundable window", () => {
  const current = {
    providerKey: "hero_sms",
    refundableCancelAvailableAtIso: "2026-05-13T10:02:00.000Z",
  };
  assert.equal(isHeroSmsCancelableNow(current, Date.parse("2026-05-13T10:01:59.000Z")), false);
  assert.equal(isHeroSmsCancelableNow(current, Date.parse("2026-05-13T10:02:00.000Z")), true);
});

test("buildHeroSmsLeaseSummary formats the paid lease fields", () => {
  const current = {
    providerKey: "hero_sms",
    assignmentIndex: 2,
    maxBindingsPerPhone: 3,
    businessKey: "openai-bind",
    activationCost: 0.02,
    refundableCancelAvailableAtIso: "2026-05-13T10:02:00.000Z",
    leaseExpiresAtIso: "2026-05-13T10:20:00.000Z",
  };

  const summary = buildHeroSmsLeaseSummary(current, Date.parse("2026-05-13T10:03:00.000Z"));
  assert.deepEqual(summary, [
    "租约席位 2/3",
    "业务键 openai-bind",
    "费用 0.02",
    "已到可退款取消窗口",
    "租约到期 2026-05-13T10:20:00.000Z",
  ]);
});
