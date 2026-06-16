import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { loadEasySmsRuntimeState, saveEasySmsRuntimeState } from "../../src/persistence/index.js";
import type { EasySmsRuntimeStateSnapshot } from "../../src/domain/models.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("runtime state persistence", () => {
  it("creates the state directory before loading an absent state file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "easy-sms-state-"));
    tempDirs.push(tempDir);
    const stateDir = join(tempDir, "nested", "state");
    const filePath = join(stateDir, "easy-sms-state.json");

    const state = await loadEasySmsRuntimeState({
      ...defaultEasySmsRuntimeConfig,
      persistence: {
        ...defaultEasySmsRuntimeConfig.persistence,
        enabled: true,
        filePath,
      },
    });

    await expect(access(stateDir)).resolves.toBeUndefined();
    expect(state).toBeUndefined();
  });

  it("quarantines a corrupt state file and starts with empty state", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "easy-sms-state-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "easy-sms-state.json");
    const corruptSource = '{"providers":[{"providerKey":"smstome","lastDetail":"truncated';
    await writeFile(filePath, corruptSource, "utf8");

    const state = await loadEasySmsRuntimeState({
      ...defaultEasySmsRuntimeConfig,
      persistence: {
        ...defaultEasySmsRuntimeConfig.persistence,
        enabled: true,
        filePath,
      },
    });

    expect(state).toBeUndefined();
    await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    const entries = await readdir(tempDir);
    const corruptEntry = entries.find((entry) => entry.startsWith("easy-sms-state.json.corrupt-"));
    expect(corruptEntry).toBeDefined();
    await expect(readFile(join(tempDir, corruptEntry as string), "utf8")).resolves.toBe(corruptSource);
  });

  it("saves state through a backup-preserving replacement", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "easy-sms-state-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "easy-sms-state.json");
    const originalState: EasySmsRuntimeStateSnapshot = {
      providers: [],
      routes: [],
      probeHistory: [],
      updatedAt: "2026-06-14T08:30:00.000Z",
    };
    const nextState: EasySmsRuntimeStateSnapshot = {
      providers: [],
      routes: [],
      probeHistory: [],
      nextSessionSequence: 2,
      updatedAt: "2026-06-17T04:00:00.000Z",
    };
    await writeFile(filePath, JSON.stringify(originalState), "utf8");

    await saveEasySmsRuntimeState({
      ...defaultEasySmsRuntimeConfig,
      persistence: {
        ...defaultEasySmsRuntimeConfig.persistence,
        enabled: true,
        filePath,
      },
    }, nextState);

    await expect(readFile(`${filePath}.bak`, "utf8")).resolves.toBe(JSON.stringify(originalState));
    await expect(readFile(filePath, "utf8").then((source) => JSON.parse(source))).resolves.toMatchObject({
      nextSessionSequence: 2,
      updatedAt: "2026-06-17T04:00:00.000Z",
    });
    const entries = await readdir(tempDir);
    expect(entries.some((entry) => entry.includes(".tmp-"))).toBe(false);
  });
});
