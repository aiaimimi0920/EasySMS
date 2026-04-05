import { readFile } from "node:fs/promises";

import { parse } from "yaml";

import { defaultEasySmsRuntimeConfig } from "../defaults/index.js";
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
      return defaultEasySmsRuntimeConfig;
    }

    throw error;
  }
}
