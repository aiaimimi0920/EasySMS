import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import type { EasySmsRuntimeConfig } from "../domain/models.js";
import { mergeEasySmsConfig } from "./from-config.js";

export function resolveConfigPath(): string {
  return process.env.EASY_SMS_CONFIG_PATH ?? "/etc/easy-sms/config.yaml";
}

export async function loadEasySmsConfig(): Promise<EasySmsRuntimeConfig> {
  const configPath = resolveConfigPath();

  try {
    const source = await readFile(configPath, "utf8");
    return mergeEasySmsConfig(parse(source));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `EasySms config not found at ${configPath}. Set EASY_SMS_CONFIG_PATH or mount /etc/easy-sms/config.yaml.`,
      );
    }

    throw error;
  }
}
