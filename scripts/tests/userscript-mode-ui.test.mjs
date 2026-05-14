import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUserscriptModeUiModel,
  isPaidProviderKey,
} from "../lib/userscript-mode-ui.mjs";

test("isPaidProviderKey recognizes hero_sms as paid", () => {
  assert.equal(isPaidProviderKey("hero_sms"), true);
  assert.equal(isPaidProviderKey("onlinesim"), false);
});

test("buildUserscriptModeUiModel marks explicit hero_sms as paid", () => {
  const model = buildUserscriptModeUiModel(
    { providerMode: "explicit", explicitProviderKey: "hero_sms" },
    { providerKey: "hero_sms" },
  );
  assert.deepEqual(model, {
    providerMode: "explicit",
    currentProviderKey: "hero_sms",
    modeLabel: "EXPLICIT",
    modeTone: "warn",
    tierLabel: "PAID",
    tierTone: "paid",
    paid: true,
    warningText: "当前正在使用付费 provider，请留意成本、租约和退款窗口。",
  });
});

test("buildUserscriptModeUiModel keeps auto free providers calm", () => {
  const model = buildUserscriptModeUiModel(
    { providerMode: "auto", explicitProviderKey: "onlinesim" },
    { providerKey: "onlinesim" },
  );
  assert.equal(model.modeLabel, "AUTO");
  assert.equal(model.tierLabel, "FREE");
  assert.equal(model.warningText, "");
});
