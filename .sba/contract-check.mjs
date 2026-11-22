import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import { resolve } from "node:path";
import { canonicalJson, sha256Hex } from "./crypto-backup.mjs";
import { SbaActionError, requireCondition } from "./errors.mjs";

const IDENTIFIER_RE = /^[a-z][a-z0-9-]{1,62}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/;
const D1_UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compareVersions(left, right) {
  requireCondition(
    typeof left === "string" && VERSION_RE.test(left) && typeof right === "string" && VERSION_RE.test(right),
    "EASYSMS_SBA_VERSION_INVALID",
    { failedStep: "request-validate" },
  );
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1;
    }
  }
  return 0;
}

export function isValidHttpsOrigin(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.origin === value
      && !parsed.username
      && !parsed.password
      && !parsed.port;
  } catch {
    return false;
  }
}

export function loadLocalManifest(repoRoot) {
  const manifestPath = resolve(repoRoot, ".sba/manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function parseAndValidateRequest(rawText, manifest) {
  let request;
  try {
    request = JSON.parse(rawText);
  } catch {
    throw new SbaActionError("EASYSMS_SBA_REQUEST_JSON_INVALID", { failedStep: "request-validate" });
  }

  requireCondition(isPlainObject(request), "EASYSMS_SBA_REQUEST_INVALID", { failedStep: "request-validate" });
  const allowedActions = [
    "deploy",
    "update",
    "verify",
    "preview",
    "destroy-preview",
    ...(Object.hasOwn(manifest?.actions ?? {}, "repair") ? ["repair"] : []),
  ];
  requireCondition(
    request.schemaVersion === 3
      && IDENTIFIER_RE.test(String(request.taskId ?? ""))
      && allowedActions.includes(request.action)
      && REPO_RE.test(String(request.repository ?? ""))
      && SHA_RE.test(String(request.sourceSha ?? ""))
      && request.applicationId === manifest.id
      && request.applicationVersion === manifest.version
      && IDENTIFIER_RE.test(String(request.environment ?? ""))
      && isPlainObject(request.configuration)
      && JSON.stringify(request.configuration).length <= 32768,
    "EASYSMS_SBA_REQUEST_IDENTITY_INVALID",
    { failedStep: "request-validate" },
  );

  if (request.action === "deploy") {
    requireCondition(request.previous === null, "EASYSMS_SBA_PREVIOUS_INVALID", { failedStep: "request-validate" });
  } else {
    requireCondition(
      isPlainObject(request.previous)
        && SHA_RE.test(String(request.previous.sourceSha ?? ""))
        && VERSION_RE.test(String(request.previous.applicationVersion ?? "")),
      "EASYSMS_SBA_PREVIOUS_INVALID",
      { failedStep: "request-validate" },
    );
    const cmp = compareVersions(request.applicationVersion, request.previous.applicationVersion);
    if (request.action === "update" || request.action === "preview" || request.action === "repair") {
      requireCondition(
        cmp > 0 && request.sourceSha !== request.previous.sourceSha,
        "EASYSMS_SBA_RELEASE_PROGRESSION_INVALID",
        { failedStep: "request-validate" },
      );
    } else {
      requireCondition(
        cmp === 0 && request.sourceSha === request.previous.sourceSha,
        "EASYSMS_SBA_RELEASE_MATCH_REQUIRED",
        { failedStep: "request-validate" },
      );
    }
  }

  if (request.action === "preview") {
    requireCondition(
      isPlainObject(request.context)
        && isPlainObject(request.context.source)
        && Array.isArray(request.context.resources)
        && request.context.resources.length > 0
        && Array.isArray(request.context.urls),
      "EASYSMS_SBA_PREVIEW_CONTEXT_INVALID",
      { failedStep: "request-validate" },
    );
  } else if (request.action === "destroy-preview") {
    requireCondition(
      isPlainObject(request.context)
        && /^dc-[a-f0-9]{32}$/.test(String(request.context.instanceId ?? ""))
        && /^dc-[a-f0-9]{32}$/.test(String(request.context.previewTaskId ?? ""))
        && /^[a-f0-9]{64}$/.test(String(request.context.resultDigest ?? ""))
        && Array.isArray(request.context.resources)
        && request.context.resources.length > 0,
      "EASYSMS_SBA_DESTROY_CONTEXT_INVALID",
      { failedStep: "request-validate" },
    );
  } else if (request.action === "repair") {
    const repairEntry = Array.isArray(manifest?.repairs)
      ? manifest.repairs.find((row) => row?.id === request.context?.repairId)
      : null;
    requireCondition(
      isPlainObject(request.context)
        && IDENTIFIER_RE.test(String(request.context.repairId ?? ""))
        && /^dc-[a-f0-9]{32}$/.test(String(request.context.parentTaskId ?? ""))
        && request.context.parentTaskId !== request.taskId
        && Number.isSafeInteger(request.context.parentRunId)
        && request.context.parentRunId > 0
        && /^[a-f0-9]{64}$/.test(String(request.context.requestDigest ?? ""))
        && /^[a-f0-9]{64}$/.test(String(request.context.resultDigest ?? ""))
        && /^[A-Z][A-Z0-9_]{1,79}$/.test(String(request.context.errorCode ?? ""))
        && Boolean(repairEntry)
        && Array.isArray(repairEntry.fromErrorCodes)
        && repairEntry.fromErrorCodes.includes(request.context.errorCode)
        && !Object.hasOwn(request.context, "preview")
        && !Object.hasOwn(request.context, "cleanup"),
      "EASYSMS_SBA_REPAIR_CONTEXT_INVALID",
      { failedStep: "request-validate" },
    );
  }

  return request;
}

export function parseInstanceConfig(configuration, environment) {
  requireCondition(isPlainObject(configuration), "EASYSMS_SBA_CONFIG_INVALID", { failedStep: "config-validate" });
  const accountId = String(configuration.accountId ?? "");
  const workerName = String(configuration.workerName ?? "");
  const workerOrigin = String(configuration.workerOrigin ?? "");
  const databaseId = String(configuration.databaseId ?? "");
  const databaseName = String(configuration.databaseName ?? "");
  const backupBucketName = String(configuration.backupBucketName ?? "");

  requireCondition(
    ACCOUNT_ID_RE.test(accountId)
      && IDENTIFIER_RE.test(workerName)
      && isValidHttpsOrigin(workerOrigin)
      && D1_UUID_RE.test(databaseId)
      && databaseName.trim().length > 0
      && BUCKET_RE.test(backupBucketName),
    "EASYSMS_SBA_CONFIG_FIELDS_INVALID",
    { failedStep: "config-validate" },
  );

  const originUrl = new URL(workerOrigin);
  const isWorkersDev = originUrl.hostname.endsWith(".workers.dev");
  if (isWorkersDev) {
    const labels = originUrl.hostname.split(".");
    requireCondition(
      labels.length === 4 && labels[0] === workerName && labels[2] === "workers" && labels[3] === "dev",
      "EASYSMS_SBA_WORKERS_DEV_MISMATCH",
      { failedStep: "config-validate" },
    );
  } else {
    requireCondition(
      originUrl.hostname.split(".").length >= 3,
      "EASYSMS_SBA_CUSTOM_DOMAIN_INVALID",
      { failedStep: "config-validate" },
    );
  }

  const publicRuntimePayload = {
    service: isPlainObject(configuration.service) ? configuration.service : {},
    runtimeOptions: isPlainObject(configuration.runtimeOptions) ? configuration.runtimeOptions : null,
  };

  const inventory = [
    { key: "database", kind: "d1", accountId, remoteId: databaseId },
    { key: "backups", kind: "r2", accountId, remoteId: backupBucketName },
    { key: "worker", kind: "worker", accountId, remoteId: workerName },
    { key: "origin", kind: "domain", accountId, remoteId: workerOrigin },
  ];

  return {
    accountId,
    environment,
    workerName,
    workerOrigin,
    originHostname: originUrl.hostname,
    isWorkersDev,
    databaseId,
    databaseName,
    backupBucketName,
    publicRuntimePayload,
    inventory,
    inventoryDigest: sha256Hex(canonicalJson(inventory)),
  };
}

export function inspectCleanGitCheckout(repoRoot, request) {
  const gitEnv = {
    PATH: process.env.PATH || "",
    SYSTEMROOT: process.env.SYSTEMROOT || "",
    WINDIR: process.env.WINDIR || "",
    HOME: process.env.HOME || "",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : devNull,
  };

  const runGit = (args) => {
    try {
      return execFileSync("git", ["-c", "core.fsmonitor=false", "-C", repoRoot, ...args], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: gitEnv,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      throw new SbaActionError("EASYSMS_SBA_CHECKOUT_VERIFY_FAILED", { failedStep: "checkout-verify" });
    }
  };

  const head = runGit(["rev-parse", "HEAD"]);
  requireCondition(head === request.sourceSha, "EASYSMS_SBA_CHECKOUT_SHA_MISMATCH", {
    failedStep: "checkout-verify",
  });

  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignored=matching",
    "--ignore-submodules=none",
  ]);
  requireCondition(status === "", "EASYSMS_SBA_CHECKOUT_DIRTY", {
    failedStep: "checkout-verify",
  });

  const origin = runGit(["remote", "get-url", "origin"]);
  const expectedHttps = `https://github.com/${request.repository}`;
  requireCondition(
    origin === expectedHttps || origin === `${expectedHttps}.git`,
    "EASYSMS_SBA_CHECKOUT_ORIGIN_MISMATCH",
    { failedStep: "checkout-verify" },
  );
}

export async function writeAtomicResult(resultPath, payload) {
  const temporaryPath = `${resultPath}.${randomBytes(12).toString("hex")}.tmp`;
  const serialized = JSON.stringify(payload, null, 2);
  await writeFile(temporaryPath, serialized, { encoding: "utf8" });
  await rename(temporaryPath, resultPath);
}
