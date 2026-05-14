import { afterEach, describe, expect, it } from "vitest";

import { loadEasySmsConfig } from "../../src/runtime/config.js";

const originalConfigPath = process.env.EASY_SMS_CONFIG_PATH;

afterEach(() => {
  if (originalConfigPath === undefined) {
    delete process.env.EASY_SMS_CONFIG_PATH;
    return;
  }
  process.env.EASY_SMS_CONFIG_PATH = originalConfigPath;
});

describe("runtime config loading", () => {
  it("fails fast when the configured runtime file is missing", async () => {
    process.env.EASY_SMS_CONFIG_PATH = "Z:/definitely-missing/easy-sms-config.yaml";

    await expect(loadEasySmsConfig()).rejects.toThrow(
      "EasySms config not found at Z:/definitely-missing/easy-sms-config.yaml.",
    );
  });
});
