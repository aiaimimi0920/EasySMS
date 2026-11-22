import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SbaActionError, requireCondition } from "./errors.mjs";

export async function buildIsolatedWorkerBundle(repoRoot) {
  const sourceServiceBase = resolve(repoRoot, "service/base");
  requireCondition(existsSync(sourceServiceBase), "EASYSMS_SBA_SOURCE_MISSING", {
    failedStep: "worker-build",
  });

  const tempRoot = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "easysms-sba-build-"));
  try {
    const localEsbuildPath = resolve(sourceServiceBase, "node_modules/esbuild/lib/main.js");
    const outfile = join(tempRoot, "worker.mjs");

    if (existsSync(localEsbuildPath)) {
      execFileSync(
        process.execPath,
        [resolve(sourceServiceBase, "scripts/build-worker.mjs"), "--outfile", outfile],
        {
          cwd: sourceServiceBase,
          stdio: "ignore",
          timeout: 120_000,
          windowsHide: true,
        },
      );
    } else {
      const isolatedCopy = join(tempRoot, "service-base");
      cpSync(sourceServiceBase, isolatedCopy, {
        recursive: true,
        filter: (src) => !src.includes("node_modules") && !src.includes("\\dist") && !src.includes("/dist"),
      });

      const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
      execFileSync(
        npmCommand,
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        {
          cwd: isolatedCopy,
          stdio: "ignore",
          timeout: 300_000,
          windowsHide: true,
        },
      );

      execFileSync(
        process.execPath,
        [join(isolatedCopy, "scripts/build-worker.mjs"), "--outfile", outfile],
        {
          cwd: isolatedCopy,
          stdio: "ignore",
          timeout: 120_000,
          windowsHide: true,
        },
      );
    }

    requireCondition(existsSync(outfile), "EASYSMS_SBA_BUNDLE_MISSING", {
      failedStep: "worker-build",
    });
    const bundleBuffer = readFileSync(outfile);
    requireCondition(
      bundleBuffer.byteLength > 0 && bundleBuffer.byteLength <= 3 * 1024 * 1024,
      "EASYSMS_SBA_BUNDLE_SIZE_INVALID",
      { failedStep: "worker-build" },
    );
    return bundleBuffer;
  } catch (error) {
    if (error instanceof SbaActionError) {
      throw error;
    }
    throw new SbaActionError("EASYSMS_SBA_BUNDLE_BUILD_FAILED", {
      failedStep: "worker-build",
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
