import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function quarantineCorruptStateFile(filePath: string): Promise<void> {
  const corruptPath = `${filePath}.corrupt-${timestampForFileName()}-${process.pid}`;
  await rename(filePath, corruptPath);
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
    try {
      return JSON.parse(source) as EasySmsRuntimeStateSnapshot;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        await quarantineCorruptStateFile(config.persistence.filePath);
        return undefined;
      }

      throw parseError;
    }
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
  const filePath = config.persistence.filePath;
  const temporaryPath = `${filePath}.tmp-${timestampForFileName()}-${process.pid}`;
  const backupPath = `${filePath}.bak`;

  await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");

  try {
    await copyFile(filePath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  await rename(temporaryPath, filePath);
}
