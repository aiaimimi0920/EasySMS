import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CloudflareApiClient,
  WORKER_COMPATIBILITY_DATE,
  isUsableCredential,
  verifyPublicAndProtectedOrigin,
} from "./cloudflare-api.mjs";
import { inspectCleanGitCheckout, parseInstanceConfig } from "./contract-check.mjs";
import { canonicalJson, openEncryptedBackup, sealEncryptedBackup, sha256Hex } from "./crypto-backup.mjs";
import { requireCondition } from "./errors.mjs";
import { buildIsolatedWorkerBundle } from "./worker-build.mjs";

const DISABLED_SECRET_SENTINELS = new Set(["", "disabled", "none", "null", "verification-not-applicable"]);
const PREVIEW_RECORD_OBJECT_KEY = "preview/provenance.enc.json";

function normalizeOptionalAppSecret(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || DISABLED_SECRET_SENTINELS.has(trimmed.toLowerCase())) {
    return "";
  }
  return trimmed;
}

function loadMigrationStatements(repoRoot) {
  const sqlPath = resolve(repoRoot, "service/base/migrations/0001_initial.sql");
  const raw = readFileSync(sqlPath, "utf8");
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildWorkerMetadata({
  config,
  request,
  purpose,
  secrets,
}) {
  const apiKey = normalizeOptionalAppSecret(secrets.EASYSMS_API_KEY);
  requireCondition(
    apiKey.length >= 8 && !/\s/.test(apiKey),
    "EASYSMS_SBA_API_KEY_INVALID",
    { failedStep: "credentials-check" },
  );

  const isPreview = purpose === "preview";
  const bindings = [
    { type: "d1", name: "STATE_DB", id: config.databaseId },
    { type: "r2_bucket", name: "BACKUP_STORE", bucket_name: config.backupBucketName },
    { type: "plain_text", name: "SBA_APPLICATION_ID", text: "easysms" },
    { type: "plain_text", name: "SBA_RELEASE_VERSION", text: request.applicationVersion },
    { type: "plain_text", name: "SBA_RELEASE_SHA", text: request.sourceSha },
    { type: "plain_text", name: "SBA_ENVIRONMENT", text: request.environment },
    { type: "plain_text", name: "SBA_PURPOSE", text: purpose },
    { type: "plain_text", name: "EASYSMS_PREVIEW_ISOLATED", text: isPreview ? "1" : "0" },
    { type: "plain_text", name: "EASYSMS_CONFIG_JSON", text: JSON.stringify(config.publicRuntimePayload) },
    { type: "secret_text", name: "EASYSMS_API_KEY", text: apiKey },
  ];

  const optionalUpstreamSecrets = isPreview
    ? []
    : [
        "EASYSMS_HEROSMS_API_KEY",
        "EASYSMS_ONLINESIM_API_KEY",
        "EASYSMS_SMSTOME_EMAIL",
        "EASYSMS_SMSTOME_PASSWORD",
        "EASYSMS_RECEIVESMSS_USERNAME",
        "EASYSMS_RECEIVESMSS_PASSWORD",
        "EASYSMS_RECEIVESMSFREECC_EMAIL",
        "EASYSMS_RECEIVESMSFREECC_PASSWORD",
      ];

  for (const secretName of optionalUpstreamSecrets) {
    const val = normalizeOptionalAppSecret(secrets[secretName]);
    if (val) {
      bindings.push({ type: "secret_text", name: secretName, text: val });
    }
  }

  return {
    main_module: "worker.mjs",
    compatibility_date: WORKER_COMPATIBILITY_DATE,
    observability: { enabled: true },
    tags: [
      `easysms-sba:${config.inventoryDigest}`,
      `easysms-sha:${request.sourceSha}`,
      `easysms-version:${request.applicationVersion}`,
      `easysms-purpose:${purpose}`,
    ],
    bindings,
  };
}

async function bindWorkerIngress(cf, config, { allowExistingSameWorker = false } = {}) {
  if (config.isWorkersDev) {
    await cf.enableAndVerifyWorkersDevSubdomain(config.workerName);
  } else {
    await cf.bindAndVerifyCustomDomain(config.workerName, config.originHostname, {
      allowExistingSameWorker,
    });
  }
}

export async function executeSbaAction({
  request,
  repoRoot,
  env = process.env,
  fetchImpl = fetch,
  mutationTracker = { started: false },
  skipGitCheck = false,
  bundleBuilder = buildIsolatedWorkerBundle,
  propagationDelayMs = 2_000,
}) {
  if (!skipGitCheck) {
    inspectCleanGitCheckout(repoRoot, request);
  }

  const config = parseInstanceConfig(request.configuration, request.environment);
  const checks = [];
  const addCheck = (id, passed = true) => {
    checks.push({ id, passed });
  };

  if (request.action === "verify") {
    await verifyPublicAndProtectedOrigin({
      origin: config.workerOrigin,
      expectedRelease: {
        applicationId: "easysms",
        applicationVersion: request.applicationVersion,
        sourceSha: request.sourceSha,
        environment: request.environment,
        purpose: "production",
      },
      apiKey: env.EASYSMS_API_KEY,
      expectPreviewIsolation: false,
      fetchImpl,
      maxAttempts: 6,
      propagationDelayMs,
    });
    addCheck("release-verified", true);
    addCheck("health-verified", true);
    addCheck("openapi-verified", true);
    addCheck("auth-boundary-verified", true);
    return { checks };
  }

  const cf = new CloudflareApiClient(
    config.accountId,
    env.EASYSMS_CLOUDFLARE_API_TOKEN,
    fetchImpl,
    mutationTracker,
  );
  const backupPassphrase = String(env.EASYSMS_BACKUP_PASSPHRASE ?? "");
  requireCondition(
    isUsableCredential(backupPassphrase),
    "EASYSMS_SBA_BACKUP_CREDENTIAL_INVALID",
    { failedStep: "credentials-check" },
  );

  if (request.action === "deploy") {
    await cf.verifyD1Database(config.databaseId, config.databaseName);
    await cf.verifyPrivateR2Bucket(config.backupBucketName);

    const existingMeta = await cf.readD1Meta(config.databaseId);
    requireCondition(existingMeta === null, "EASYSMS_SBA_DEPLOY_TARGET_NOT_PRISTINE", {
      failedStep: "preflight-check",
    });
    const existingWorker = await cf.getWorkerSettingsOrAbsent(config.workerName);
    requireCondition(existingWorker === null, "EASYSMS_SBA_WORKER_ALREADY_EXISTS", {
      failedStep: "preflight-check",
    });
    addCheck("preflight-verified", true);

    const metadata = buildWorkerMetadata({
      config,
      request,
      purpose: "production",
      secrets: env,
    });
    const bundleBuffer = await bundleBuilder(repoRoot);

    await cf.applyD1Schema(config.databaseId, loadMigrationStatements(repoRoot));
    await cf.writeD1Meta(config.databaseId, {
      application_id: "easysms",
      release_version: request.applicationVersion,
      release_sha: request.sourceSha,
      environment: request.environment,
      purpose: "production",
      inventory_digest: config.inventoryDigest,
    });
    addCheck("schema-initialized", true);

    await cf.uploadWorkerAndVerify(config.workerName, metadata, bundleBuffer);
    addCheck("worker-published", true);

    await bindWorkerIngress(cf, config, { allowExistingSameWorker: false });
    addCheck("ingress-verified", true);

    await verifyPublicAndProtectedOrigin({
      origin: config.workerOrigin,
      expectedRelease: {
        applicationId: "easysms",
        applicationVersion: request.applicationVersion,
        sourceSha: request.sourceSha,
        environment: request.environment,
        purpose: "production",
      },
      apiKey: env.EASYSMS_API_KEY,
      fetchImpl,
      propagationDelayMs,
    });
    addCheck("release-verified", true);
    addCheck("auth-enforced", true);
    addCheck("service-ready", true);
    return { checks };
  }

  if (request.action === "update") {
    await cf.verifyD1Database(config.databaseId, config.databaseName);
    await cf.verifyPrivateR2Bucket(config.backupBucketName);

    const currentMeta = await cf.readD1Meta(config.databaseId);
    requireCondition(
      currentMeta
        && currentMeta.application_id === "easysms"
        && currentMeta.release_version === request.previous.applicationVersion
        && currentMeta.release_sha === request.previous.sourceSha
        && currentMeta.environment === request.environment
        && currentMeta.purpose === "production",
      "EASYSMS_SBA_UPDATE_BASELINE_MISMATCH",
      { failedStep: "preflight-check" },
    );

    const existingWorker = await cf.getWorkerSettingsOrAbsent(config.workerName);
    requireCondition(
      existingWorker
        && Array.isArray(existingWorker.tags)
        && existingWorker.tags.includes(`easysms-sha:${request.previous.sourceSha}`)
        && existingWorker.tags.includes(`easysms-version:${request.previous.applicationVersion}`),
      "EASYSMS_SBA_UPDATE_WORKER_DRIFT",
      { failedStep: "preflight-check" },
    );
    addCheck("preflight-verified", true);

    const metadata = buildWorkerMetadata({
      config,
      request,
      purpose: "production",
      secrets: env,
    });
    const bundleBuffer = await bundleBuilder(repoRoot);

    const preSnapshot = await cf.exportD1Snapshot(config.databaseId);
    const stateDigestBefore = sha256Hex(canonicalJson(preSnapshot.stateRows));
    const sealed = sealEncryptedBackup(preSnapshot, backupPassphrase, {
      taskId: request.taskId,
      environment: request.environment,
      previousVersion: request.previous.applicationVersion,
      previousSha: request.previous.sourceSha,
      targetVersion: request.applicationVersion,
      targetSha: request.sourceSha,
    });
    const backupKey = `backups/${request.taskId}-${Date.now()}.enc.json`;
    await cf.putR2ObjectText(config.backupBucketName, backupKey, JSON.stringify(sealed.envelope));

    const readBackText = await cf.getR2ObjectText(config.backupBucketName, backupKey);
    const verifiedBackup = openEncryptedBackup(JSON.parse(readBackText), backupPassphrase);
    requireCondition(
      sha256Hex(canonicalJson(verifiedBackup.payload.stateRows)) === stateDigestBefore,
      "EASYSMS_SBA_BACKUP_READBACK_MISMATCH",
      { failedStep: "backup-verify", uncertain: true },
    );
    addCheck("backup-created", true);

    await cf.applyD1Schema(config.databaseId, loadMigrationStatements(repoRoot));
    await cf.writeD1Meta(config.databaseId, {
      application_id: "easysms",
      release_version: request.applicationVersion,
      release_sha: request.sourceSha,
      environment: request.environment,
      purpose: "production",
      inventory_digest: config.inventoryDigest,
    });
    addCheck("schema-migrated", true);

    await cf.uploadWorkerAndVerify(config.workerName, metadata, bundleBuffer);
    addCheck("worker-published", true);

    await bindWorkerIngress(cf, config, { allowExistingSameWorker: true });
    addCheck("ingress-verified", true);

    const postSnapshot = await cf.exportD1Snapshot(config.databaseId);
    const stateDigestAfter = sha256Hex(canonicalJson(postSnapshot.stateRows));
    requireCondition(
      stateDigestAfter === stateDigestBefore,
      "EASYSMS_SBA_DATA_PRESERVATION_FAILED",
      { failedStep: "data-verify", uncertain: true },
    );
    addCheck("data-preserved", true);

    await verifyPublicAndProtectedOrigin({
      origin: config.workerOrigin,
      expectedRelease: {
        applicationId: "easysms",
        applicationVersion: request.applicationVersion,
        sourceSha: request.sourceSha,
        environment: request.environment,
        purpose: "production",
      },
      apiKey: env.EASYSMS_API_KEY,
      fetchImpl,
      propagationDelayMs,
    });
    addCheck("release-verified", true);
    addCheck("auth-enforced", true);
    addCheck("service-ready", true);
    return { checks };
  }

  if (request.action === "preview") {
    const sourceContext = request.context.source;
    const sourceConfig = parseInstanceConfig(sourceContext.configuration, sourceContext.environment);
    requireCondition(
      sourceConfig.accountId === config.accountId
        && sourceConfig.environment !== config.environment
        && sourceConfig.databaseId !== config.databaseId
        && sourceConfig.backupBucketName !== config.backupBucketName
        && sourceConfig.workerName !== config.workerName
        && sourceConfig.workerOrigin !== config.workerOrigin,
      "EASYSMS_SBA_PREVIEW_ISOLATION_INVALID",
      { failedStep: "preflight-check" },
    );

    await cf.verifyD1Database(sourceConfig.databaseId, sourceConfig.databaseName);
    await cf.verifyD1Database(config.databaseId, config.databaseName);
    await cf.verifyPrivateR2Bucket(config.backupBucketName);

    const sourceMetaBaseline = await cf.readD1Meta(sourceConfig.databaseId);
    requireCondition(
      sourceMetaBaseline
        && sourceMetaBaseline.release_version === request.previous.applicationVersion
        && sourceMetaBaseline.release_sha === request.previous.sourceSha,
      "EASYSMS_SBA_PREVIEW_SOURCE_MISMATCH",
      { failedStep: "preflight-check" },
    );
    const previewExistingMeta = await cf.readD1Meta(config.databaseId);
    requireCondition(previewExistingMeta === null, "EASYSMS_SBA_PREVIEW_TARGET_NOT_PRISTINE", {
      failedStep: "preflight-check",
    });

    const sourceSnapshotBaseline = await cf.exportD1Snapshot(sourceConfig.databaseId);
    const sourceDigestBaseline = sha256Hex(canonicalJson(sourceSnapshotBaseline));
    addCheck("preflight-verified", true);

    const metadata = buildWorkerMetadata({
      config,
      request,
      purpose: "preview",
      secrets: env,
    });
    const bundleBuffer = await bundleBuilder(repoRoot);

    const snapshotCreatedAt = Date.now();
    const snapshotId = sha256Hex(canonicalJson(sourceSnapshotBaseline.stateRows));
    const provenanceRecord = {
      schemaVersion: 1,
      instanceId: request.taskId,
      sourceInstanceId: sourceContext.instanceId,
      previewTaskId: request.taskId,
      release: {
        applicationVersion: request.applicationVersion,
        sourceSha: request.sourceSha,
      },
      source: {
        instanceId: sourceContext.instanceId,
        taskId: sourceContext.taskId,
        environment: sourceContext.environment,
        configuration: sourceContext.configuration,
      },
      snapshot: {
        id: snapshotId,
        createdAt: snapshotCreatedAt,
      },
    };
    const sealedProvenance = sealEncryptedBackup(provenanceRecord, backupPassphrase, {
      purpose: "preview-provenance",
      previewTaskId: request.taskId,
      instanceId: request.taskId,
    });
    await cf.putR2ObjectText(config.backupBucketName, PREVIEW_RECORD_OBJECT_KEY, JSON.stringify(sealedProvenance.envelope));

    await cf.applyD1Schema(config.databaseId, loadMigrationStatements(repoRoot));
    await cf.importD1RuntimeStateRows(config.databaseId, sourceSnapshotBaseline.stateRows);
    await cf.writeD1Meta(config.databaseId, {
      application_id: "easysms",
      release_version: request.applicationVersion,
      release_sha: request.sourceSha,
      environment: request.environment,
      purpose: "preview",
      source_instance_id: sourceContext.instanceId,
      preview_task_id: request.taskId,
      inventory_digest: config.inventoryDigest,
    });

    const copiedSnapshot = await cf.exportD1Snapshot(config.databaseId);
    requireCondition(
      sha256Hex(canonicalJson(copiedSnapshot.stateRows)) === snapshotId,
      "EASYSMS_SBA_PREVIEW_SNAPSHOT_MISMATCH",
      { failedStep: "snapshot-verify", uncertain: true },
    );
    addCheck("snapshot-copied", true);
    addCheck("migration-verified", true);

    await cf.uploadWorkerAndVerify(config.workerName, metadata, bundleBuffer);
    addCheck("worker-published", true);

    await bindWorkerIngress(cf, config, { allowExistingSameWorker: false });
    addCheck("ingress-verified", true);

    await verifyPublicAndProtectedOrigin({
      origin: config.workerOrigin,
      expectedRelease: {
        applicationId: "easysms",
        applicationVersion: request.applicationVersion,
        sourceSha: request.sourceSha,
        environment: request.environment,
        purpose: "preview",
      },
      apiKey: env.EASYSMS_API_KEY,
      expectPreviewIsolation: true,
      fetchImpl,
      propagationDelayMs,
    });
    addCheck("release-verified", true);
    addCheck("side-effects-isolated", true);

    const sourceSnapshotAfter = await cf.exportD1Snapshot(sourceConfig.databaseId);
    requireCondition(
      sha256Hex(canonicalJson(sourceSnapshotAfter)) === sourceDigestBaseline,
      "EASYSMS_SBA_PREVIEW_MUTATED_SOURCE",
      { failedStep: "source-verify", uncertain: true },
    );
    addCheck("source-unchanged", true);

    return {
      checks,
      lifecycle: {
        resources: request.context.resources.map((row) => ({
          key: row.key,
          status: "created",
        })),
        urls: [...request.context.urls],
        snapshot: {
          id: snapshotId,
          createdAt: snapshotCreatedAt,
        },
      },
    };
  }

  if (request.action === "destroy-preview") {
    const rawProvenance = await cf.getR2ObjectText(config.backupBucketName, PREVIEW_RECORD_OBJECT_KEY, {
      allow404: false,
    });
    const openedProvenance = openEncryptedBackup(JSON.parse(rawProvenance), backupPassphrase).payload;
    requireCondition(
      openedProvenance?.schemaVersion === 1
        && openedProvenance?.previewTaskId === request.context.previewTaskId
        && openedProvenance?.instanceId === request.context.instanceId
        && openedProvenance?.release?.applicationVersion === request.applicationVersion
        && openedProvenance?.release?.sourceSha === request.sourceSha,
      "EASYSMS_SBA_PREVIEW_PROVENANCE_MISMATCH",
      { failedStep: "preflight-check" },
    );

    const sourceConfig = parseInstanceConfig(
      openedProvenance.source.configuration,
      openedProvenance.source.environment,
    );
    requireCondition(
      sourceConfig.databaseId !== config.databaseId
        && sourceConfig.backupBucketName !== config.backupBucketName
        && sourceConfig.workerName !== config.workerName,
      "EASYSMS_SBA_DESTROY_SOURCE_OVERLAP",
      { failedStep: "preflight-check" },
    );

    const sourceSnapshotBefore = await cf.exportD1Snapshot(sourceConfig.databaseId);
    const sourceDigestBefore = sha256Hex(canonicalJson(sourceSnapshotBefore));
    addCheck("preview-authority-verified", true);

    if (!config.isWorkersDev) {
      await cf.unbindCustomDomainIfPresent(config.originHostname, config.workerName);
    }
    await cf.deleteWorkerAndVerifyAbsent(config.workerName);
    await cf.deleteD1DatabaseAndVerifyAbsent(config.databaseId);
    await cf.emptyAndDeleteR2Bucket(config.backupBucketName);
    addCheck("preview-removed", true);

    const sourceSnapshotAfter = await cf.exportD1Snapshot(sourceConfig.databaseId);
    requireCondition(
      sha256Hex(canonicalJson(sourceSnapshotAfter)) === sourceDigestBefore,
      "EASYSMS_SBA_DESTROY_MUTATED_SOURCE",
      { failedStep: "source-verify", uncertain: true },
    );
    addCheck("source-unchanged", true);

    return {
      checks,
      lifecycle: {
        resources: request.context.resources.map((row) => ({
          key: row.key,
          status: "removed",
        })),
      },
    };
  }

  requireCondition(false, "EASYSMS_SBA_UNSUPPORTED_ACTION", { failedStep: "action-dispatch" });
}
