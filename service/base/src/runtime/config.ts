import { readFile } from "node:fs/promises";
import { posix, win32 } from "node:path";

import { parse } from "yaml";

import type { EasySmsRuntimeConfig } from "../domain/models.js";
import { mergeEasySmsConfig } from "./from-config.js";

export function resolveConfigPath(): string {
  return process.env.EASY_SMS_CONFIG_PATH ?? "/etc/easy-sms/config.yaml";
}

function isAbsolutePath(filePath: string): boolean {
  return posix.isAbsolute(filePath) || win32.isAbsolute(filePath);
}

function joinPathForBase(basePath: string, filePath: string): string {
  if (basePath.includes("\\") || /^[A-Za-z]:/.test(basePath)) {
    return win32.join(basePath, filePath);
  }

  return posix.join(basePath, filePath);
}

function resolvePersistenceFilePath(config: EasySmsRuntimeConfig): EasySmsRuntimeConfig {
  const filePath = config.persistence.filePath;
  const stateDir = process.env.EASY_SMS_STATE_DIR?.trim();
  if (!stateDir || isAbsolutePath(filePath)) {
    return config;
  }

  return {
    ...config,
    persistence: {
      ...config.persistence,
      filePath: joinPathForBase(stateDir, filePath),
    },
  };
}

export async function loadEasySmsConfig(): Promise<EasySmsRuntimeConfig> {
  const configPath = resolveConfigPath();

  try {
    const source = await readFile(configPath, "utf8");
    return resolvePersistenceFilePath(mergeEasySmsConfig(parse(source)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `EasySms config not found at ${configPath}. Set EASY_SMS_CONFIG_PATH or mount /etc/easy-sms/config.yaml.`,
      );
    }

    throw error;
  }
}
