import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { EasySmsRuntimeConfig, EasySmsRuntimeStateSnapshot } from "../domain/models.js";

export interface EasySmsStateStoreDescriptor {
  driver: string;
  filePath: string;
}

export function describeStateStore(config: EasySmsRuntimeConfig): EasySmsStateStoreDescriptor {
  return {
    driver: config.persistence.driver,
    filePath: config.persistence.filePath,
  };
}

export async function loadEasySmsRuntimeState(
  config: EasySmsRuntimeConfig,
): Promise<EasySmsRuntimeStateSnapshot | undefined> {
  if (!config.persistence.enabled || config.persistence.driver !== "file") {
    return undefined;
  }

  try {
    await mkdir(dirname(config.persistence.filePath), { recursive: true });
    const source = await readFile(config.persistence.filePath, "utf8");
    return JSON.parse(source) as EasySmsRuntimeStateSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export async function saveEasySmsRuntimeState(
  config: EasySmsRuntimeConfig,
  snapshot: EasySmsRuntimeStateSnapshot,
): Promise<void> {
  if (!config.persistence.enabled || config.persistence.driver !== "file") {
    return;
  }

  await mkdir(dirname(config.persistence.filePath), { recursive: true });
  await writeFile(config.persistence.filePath, JSON.stringify(snapshot, null, 2), "utf8");
}
