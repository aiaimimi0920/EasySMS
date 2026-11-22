import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalManifest, parseAndValidateRequest, writeAtomicResult } from "./contract-check.mjs";
import { SbaActionError } from "./errors.mjs";
import { executeSbaAction } from "./lifecycle.mjs";

function parseCliArgs(argv) {
  let requestPath = "";
  let resultPath = "";
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if ((current === "-RequestPath" || current === "--request") && argv[index + 1]) {
      requestPath = argv[index + 1];
      index += 1;
    } else if ((current === "-ResultPath" || current === "--result") && argv[index + 1]) {
      resultPath = argv[index + 1];
      index += 1;
    }
  }
  if (!requestPath || !resultPath) {
    throw new SbaActionError("EASYSMS_SBA_CLI_ARGS_INVALID", { failedStep: "cli-parse" });
  }
  return { requestPath, resultPath };
}

export async function runSpringBokEntrypoint(argv = process.argv.slice(2), options = {}) {
  const sbaDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = options.repoRoot ?? resolve(sbaDir, "..");
  const startedAtMs = Date.now();
  const mutationTracker = { started: false };
  let resultPath = "";
  let request = null;

  try {
    const parsedArgs = parseCliArgs(argv);
    resultPath = parsedArgs.resultPath;
    const manifest = loadLocalManifest(repoRoot);
    const rawRequest = await readFile(parsedArgs.requestPath, "utf8");
    request = parseAndValidateRequest(rawRequest, manifest);

    const outcome = await executeSbaAction({
      request,
      repoRoot,
      env: options.env ?? process.env,
      fetchImpl: options.fetchImpl ?? fetch,
      mutationTracker,
      skipGitCheck: Boolean(options.skipGitCheck),
      bundleBuilder: options.bundleBuilder,
      propagationDelayMs: options.propagationDelayMs,
    });

    const resultPayload = {
      schemaVersion: request.schemaVersion,
      taskId: request.taskId,
      action: request.action,
      sourceSha: request.sourceSha,
      applicationVersion: request.applicationVersion,
      status: "succeeded",
      checks: outcome.checks,
      ...(outcome.lifecycle ? { lifecycle: outcome.lifecycle } : {}),
    };
    await writeAtomicResult(resultPath, resultPayload);
    return 0;
  } catch (error) {
    if (resultPath && request) {
      const sbaError = error instanceof SbaActionError
        ? error
        : new SbaActionError("EASYSMS_SBA_UNEXPECTED_ERROR", {
            failedStep: "execute",
            uncertain: mutationTracker.started,
          });
      const status = mutationTracker.started || sbaError.uncertain ? "unknown" : "failed";
      const stepSuffix = sbaError.failedStep
        ? `__${sbaError.failedStep.toUpperCase().replace(/-/g, "_")}`
        : "";
      const candidateCode = `${sbaError.errorCode}${stepSuffix}`;
      const errorCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(candidateCode)
        ? candidateCode
        : sbaError.errorCode;

      await writeAtomicResult(resultPath, {
        schemaVersion: request.schemaVersion,
        taskId: request.taskId,
        action: request.action,
        sourceSha: request.sourceSha,
        applicationVersion: request.applicationVersion,
        status,
        checks: [],
        errorCode,
      });
    }
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const exitCode = await runSpringBokEntrypoint();
  process.exitCode = exitCode;
}
