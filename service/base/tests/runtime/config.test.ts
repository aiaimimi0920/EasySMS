import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadEasySmsConfig } from "../../src/runtime/config.js";

const originalConfigPath = process.env.EASY_SMS_CONFIG_PATH;
const originalStateDir = process.env.EASY_SMS_STATE_DIR;
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalConfigPath === undefined) {
    delete process.env.EASY_SMS_CONFIG_PATH;
  } else {
    process.env.EASY_SMS_CONFIG_PATH = originalConfigPath;
  }
  if (originalStateDir === undefined) {
    delete process.env.EASY_SMS_STATE_DIR;
  } else {
    process.env.EASY_SMS_STATE_DIR = originalStateDir;
  }

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("runtime config loading", () => {
  it("fails fast when the configured runtime file is missing", async () => {
    process.env.EASY_SMS_CONFIG_PATH = "Z:/definitely-missing/easy-sms-config.yaml";

    await expect(loadEasySmsConfig()).rejects.toThrow(
      "EasySms config not found at Z:/definitely-missing/easy-sms-config.yaml.",
    );
  });

  it("resolves relative persistence file paths inside EASY_SMS_STATE_DIR", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "easy-sms-config-"));
    tempDirs.push(tempDir);
    const configPath = join(tempDir, "config.yaml");
    await writeFile(
      configPath,
      [
        "persistence:",
        "  enabled: true",
        "  driver: file",
        "  intervalMs: 60000",
        "  filePath: state/easy-sms-state.json",
        "",
      ].join("\n"),
      "utf8",
    );
    process.env.EASY_SMS_CONFIG_PATH = configPath;
    process.env.EASY_SMS_STATE_DIR = "/var/lib/easy-sms";

    const config = await loadEasySmsConfig();

    expect(config.persistence.filePath).toBe("/var/lib/easy-sms/state/easy-sms-state.json");
  });
});
