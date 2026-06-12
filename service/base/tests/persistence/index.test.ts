import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultEasySmsRuntimeConfig } from "../../src/defaults/index.js";
import { loadEasySmsRuntimeState } from "../../src/persistence/index.js";

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
});
