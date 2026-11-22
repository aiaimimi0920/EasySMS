import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256Hex } from "../../.sba/crypto-backup.mjs";
import { runSpringBokEntrypoint } from "../../.sba/springbok.mjs";
import { validateEasySmsSba } from "../../scripts/validate-sba.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const ACCOUNT_ID = "11111111111111111111111111111111";
const PROD_DB_ID = "22222222-2222-2222-2222-222222222222";
const PREVIEW_DB_ID = "33333333-3333-3333-3333-333333333333";
const PROD_BUCKET = "easysms-prod-backups";
const PREVIEW_BUCKET = "easysms-test-abc123-backups";
const SUBDOMAIN = "acctsub";
const SHA_V1 = "a".repeat(40);
const SHA_V2 = "b".repeat(40);
const INSTANCE_ID = "dc-" + "1".repeat(32);
const PREVIEW_TASK_ID = "dc-" + "2".repeat(32);

function createSecretsEnv(overrides = {}) {
  return {
    EASYSMS_CLOUDFLARE_API_TOKEN: "cf-token-secret-value",
    EASYSMS_API_KEY: "easysms-bearer-secret-key",
    EASYSMS_BACKUP_PASSPHRASE: "easysms-backup-passphrase-value",
    EASYSMS_HEROSMS_API_KEY: "hero-paid-secret",
    EASYSMS_ONLINESIM_API_KEY: "disabled",
    EASYSMS_SMSTOME_EMAIL: "disabled",
    EASYSMS_SMSTOME_PASSWORD: "disabled",
    EASYSMS_RECEIVESMSS_USERNAME: "disabled",
    EASYSMS_RECEIVESMSS_PASSWORD: "disabled",
    EASYSMS_RECEIVESMSFREECC_EMAIL: "disabled",
    EASYSMS_RECEIVESMSFREECC_PASSWORD: "disabled",
    ...overrides,
  };
}

function buildConfig({ envName, dbId, dbName, bucketName, customOrigin = null }) {
  const workerName = `easysms-${envName}`;
  return {
    accountId: ACCOUNT_ID,
    workerName,
    workerOrigin: customOrigin ?? `https://${workerName}.${SUBDOMAIN}.workers.dev`,
    databaseId: dbId,
    databaseName: dbName,
    backupBucketName: bucketName,
    service: {
      strategyModeId: "aggregate-latest",
      strictProviderMode: false,
      enabledProviders: ["onlinesim", "smstome", "receive_smss", "receive_sms_free_cc", "sms24", "yunduanxin"],
      heroSmsEnabled: true,
      heroSmsDefaultService: "dr",
      heroSmsDefaultCountry: 16,
      heroSmsSelectionMode: "balanced",
      keepRecentCount: 100,
    },
    runtimeOptions: null,
  };
}

class FakeCloudflareState {
  constructor(workerModule) {
    this.workerModule = workerModule;
    this.databases = new Map();
    this.buckets = new Map();
    this.workers = new Map();
    this.failNextWorkerUpload = false;
  }

  createDatabase(uuid, name) {
    this.databases.set(uuid, {
      uuid,
      name,
      tables: new Set(),
      metaRows: new Map(),
      stateRows: new Map(),
    });
  }

  createPrivateBucket(name) {
    this.buckets.set(name, {
      name,
      creation_date: "2026-11-22T00:00:00.000Z",
      managedEnabled: false,
      customDomains: [],
      objects: new Map(),
    });
  }

  createD1Binding(databaseId) {
    const db = this.databases.get(databaseId);
    return {
      prepare: (query) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        let bound = [];
        const stmt = {
          bind: (...vals) => {
            bound = vals;
            return stmt;
          },
          first: async () => {
            if (normalized.startsWith("SELECT revision, schema_version, payload_json, sha256, updated_at FROM easysms_runtime_state")) {
              return db.stateRows.get(String(bound[0])) ?? null;
            }
            if (normalized.startsWith("SELECT revision FROM easysms_runtime_state")) {
              const row = db.stateRows.get(String(bound[0]));
              return row ? { revision: row.revision } : null;
            }
            return null;
          },
          run: async () => {
            if (normalized.startsWith("CREATE TABLE IF NOT EXISTS easysms_meta")) {
              db.tables.add("easysms_meta");
            } else if (normalized.startsWith("CREATE TABLE IF NOT EXISTS easysms_runtime_state")) {
              db.tables.add("easysms_runtime_state");
            } else if (normalized.startsWith("INSERT INTO easysms_runtime_state")) {
              const [slot, schemaVersion, payloadJson, sha256, updatedAt] = bound;
              const existing = db.stateRows.get(String(slot));
              db.stateRows.set(String(slot), {
                slot: String(slot),
                revision: existing ? existing.revision + 1 : 1,
                schema_version: Number(schemaVersion),
                payload_json: String(payloadJson),
                sha256: String(sha256),
                updated_at: String(updatedAt),
              });
            }
            return { success: true };
          },
          all: async () => ({ results: [] }),
        };
        return stmt;
      },
    };
  }

  buildFetch() {
    return async (input, init = {}) => {
      const url = new URL(String(input));
      const method = (init.method || "GET").toUpperCase();

      // Route live Worker origin requests into the actual bundled EasySms Worker!
      if (url.hostname.endsWith(`.${SUBDOMAIN}.workers.dev`)) {
        const workerName = url.hostname.slice(0, url.hostname.length - `.${SUBDOMAIN}.workers.dev`.length);
        const deployed = this.workers.get(workerName);
        if (!deployed || !deployed.subdomainEnabled) {
          return new Response("Worker not routed", { status: 404 });
        }
        const env = {};
        for (const binding of deployed.metadata.bindings) {
          if (binding.type === "plain_text" || binding.type === "secret_text") {
            env[binding.name] = binding.text;
          } else if (binding.type === "d1") {
            env[binding.name] = this.createD1Binding(binding.id);
          }
        }
        const workerInstance = this.workerModule.createEasySmsWorker();
        return workerInstance.fetch(new Request(url.toString(), init), env);
      }

      // Route Cloudflare REST API v4 requests
      if (url.origin !== "https://api.cloudflare.com") {
        return new Response("Unexpected host", { status: 502 });
      }

      const path = url.pathname.replace(/^\/client\/v4/, "");
      const okJson = (result) =>
        new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const errJson = (status, code) =>
        new Response(JSON.stringify({ success: false, errors: [{ code, message: "err" }], result: null }), {
          status,
          headers: { "Content-Type": "application/json" },
        });

      // D1 endpoints
      const d1Match = path.match(/^\/accounts\/([^/]+)\/d1\/database\/([^/]+)(?:\/(query))?$/);
      if (d1Match) {
        const dbId = d1Match[2];
        const sub = d1Match[3];
        const db = this.databases.get(dbId);
        if (!db) {
          return errJson(404, 7404);
        }
        if (!sub && method === "GET") {
          return okJson({ uuid: db.uuid, name: db.name });
        }
        if (!sub && method === "DELETE") {
          this.databases.delete(dbId);
          return okJson({ deleted: true });
        }
        if (sub === "query" && method === "POST") {
          const { sql, params = [] } = JSON.parse(String(init.body));
          const norm = sql.replace(/\s+/g, " ").trim();
          if (norm.startsWith("CREATE TABLE IF NOT EXISTS easysms_meta")) {
            db.tables.add("easysms_meta");
            return okJson([{ success: true, results: [] }]);
          }
          if (norm.startsWith("CREATE TABLE IF NOT EXISTS easysms_runtime_state")) {
            db.tables.add("easysms_runtime_state");
            return okJson([{ success: true, results: [] }]);
          }
          if (norm.startsWith("SELECT name FROM sqlite_master")) {
            const rows = Array.from(db.tables).sort().map((name) => ({ name }));
            return okJson([{ success: true, results: rows }]);
          }
          if (norm.startsWith("SELECT key, value, updated_at FROM easysms_meta")) {
            const rows = Array.from(db.metaRows.values()).sort((a, b) => a.key.localeCompare(b.key));
            return okJson([{ success: true, results: rows }]);
          }
          if (norm.startsWith("INSERT INTO easysms_meta")) {
            const [key, value, updatedAt] = params;
            db.metaRows.set(String(key), { key: String(key), value: String(value), updated_at: String(updatedAt) });
            return okJson([{ success: true, results: [] }]);
          }
          if (norm.startsWith("SELECT slot, revision, schema_version, payload_json, sha256, updated_at FROM easysms_runtime_state")) {
            const rows = Array.from(db.stateRows.values()).sort((a, b) => a.slot.localeCompare(b.slot));
            return okJson([{ success: true, results: rows }]);
          }
          if (norm.startsWith("INSERT INTO easysms_runtime_state")) {
            const [slot, revision, schemaVersion, payloadJson, sha256, updatedAt] = params;
            db.stateRows.set(String(slot), {
              slot: String(slot),
              revision: Number(revision),
              schema_version: Number(schemaVersion),
              payload_json: String(payloadJson),
              sha256: String(sha256),
              updated_at: String(updatedAt),
            });
            return okJson([{ success: true, results: [] }]);
          }
          return errJson(400, 7500);
        }
      }

      // R2 endpoints
      if (path === `/accounts/${ACCOUNT_ID}/r2/buckets` && method === "GET") {
        const needle = url.searchParams.get("name_contains") || "";
        const buckets = Array.from(this.buckets.values())
          .filter((b) => b.name.includes(needle))
          .map((b) => ({ name: b.name, creation_date: b.creation_date }));
        return okJson({ buckets });
      }
      const r2SubMatch = path.match(/^\/accounts\/[^/]+\/r2\/buckets\/([^/]+)(?:\/(.*))?$/);
      if (r2SubMatch) {
        const bucketName = decodeURIComponent(r2SubMatch[1]);
        const rest = r2SubMatch[2] || "";
        const bucket = this.buckets.get(bucketName);
        if (!bucket) {
          return errJson(404, 10006);
        }
        if (rest === "" && method === "DELETE") {
          this.buckets.delete(bucketName);
          return okJson({});
        }
        if (rest === "domains/managed" && method === "GET") {
          return okJson({ enabled: bucket.managedEnabled });
        }
        if (rest === "domains/custom" && method === "GET") {
          return okJson({ domains: bucket.customDomains });
        }
        if (rest === "objects" && method === "GET") {
          const items = Array.from(bucket.objects.entries()).map(([key, val]) => ({
            key,
            size: Buffer.byteLength(val, "utf8"),
            etag: "0".repeat(32),
            last_modified: "2026-11-22T00:00:00.000Z",
          }));
          return okJson(items);
        }
        if (rest === "objects" && method === "DELETE") {
          const keys = JSON.parse(String(init.body));
          for (const key of keys) {
            bucket.objects.delete(key);
          }
          return okJson(keys.map((key) => ({ key })));
        }
        if (rest.startsWith("objects/")) {
          const objectKey = decodeURIComponent(rest.slice("objects/".length));
          if (method === "PUT") {
            bucket.objects.set(objectKey, String(init.body));
            return okJson({ key: objectKey });
          }
          if (method === "GET") {
            if (!bucket.objects.has(objectKey)) {
              return new Response("Not found", { status: 404 });
            }
            return new Response(bucket.objects.get(objectKey), { status: 200 });
          }
        }
      }

      // Worker endpoints
      if (path === `/accounts/${ACCOUNT_ID}/workers/scripts` && method === "GET") {
        return okJson(Array.from(this.workers.keys()).map((id) => ({ id })));
      }
      const workerMatch = path.match(/^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)(?:\/(settings|subdomain))?$/);
      if (workerMatch) {
        const workerName = workerMatch[1];
        const sub = workerMatch[2] || "";
        if (sub === "settings" && method === "GET") {
          const existing = this.workers.get(workerName);
          if (!existing) {
            return errJson(404, 10007);
          }
          const sanitizedBindings = existing.metadata.bindings.map((b) =>
            b.type === "secret_text" ? { name: b.name, type: "secret_text" } : { ...b },
          );
          return okJson({
            compatibility_date: existing.metadata.compatibility_date,
            tags: existing.metadata.tags,
            observability: existing.metadata.observability,
            bindings: sanitizedBindings,
          });
        }
        if (sub === "" && method === "PUT") {
          if (this.failNextWorkerUpload) {
            this.failNextWorkerUpload = false;
            return new Response("Gateway Timeout", { status: 504 });
          }
          const formData = init.body;
          const metadataBlob = formData.get("metadata");
          const metadata = JSON.parse(await metadataBlob.text());
          const existing = this.workers.get(workerName);
          this.workers.set(workerName, {
            id: workerName,
            metadata,
            subdomainEnabled: existing?.subdomainEnabled ?? false,
          });
          return okJson({ id: workerName, etag: sha256Hex(JSON.stringify(metadata)) });
        }
        if (sub === "" && method === "DELETE") {
          this.workers.delete(workerName);
          return okJson({ id: workerName });
        }
        if (sub === "subdomain" && method === "POST") {
          const existing = this.workers.get(workerName);
          existing.subdomainEnabled = true;
          return okJson({ enabled: true, previews_enabled: false });
        }
        if (sub === "subdomain" && method === "GET") {
          const existing = this.workers.get(workerName);
          return okJson({ enabled: Boolean(existing?.subdomainEnabled), previews_enabled: false });
        }
      }

      return errJson(404, 9999);
    };
  }
}

async function runActionWithManifestVersion(tempDir, version, requestObj, options) {
  const tempRepo = join(tempDir, `repo-${version}-${Math.random().toString(16).slice(2, 8)}`);
  const manifest = JSON.parse(await readFile(resolve(repoRoot, ".sba/manifest.json"), "utf8"));
  manifest.version = version;

  const sbaTempDir = join(tempRepo, ".sba");
  const { existsSync, mkdirSync, cpSync } = await import("node:fs");
  mkdirSync(sbaTempDir, { recursive: true });
  await writeFile(join(sbaTempDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  mkdirSync(join(tempRepo, "service/base/migrations"), { recursive: true });
  cpSync(
    resolve(repoRoot, "service/base/migrations/0001_initial.sql"),
    join(tempRepo, "service/base/migrations/0001_initial.sql"),
  );

  const requestPath = join(tempRepo, "request.json");
  const resultPath = join(tempRepo, "result.json");
  await writeFile(requestPath, JSON.stringify(requestObj, null, 2), "utf8");

  const exitCode = await runSpringBokEntrypoint(
    ["-RequestPath", requestPath, "-ResultPath", resultPath],
    {
      repoRoot: tempRepo,
      skipGitCheck: true,
      bundleBuilder: async () => Buffer.from("export default {};", "utf8"),
      propagationDelayMs: 0,
      ...options,
    },
  );
  const result = JSON.parse(await readFile(resultPath, "utf8"));

  const springBokContractPath = "C:/Users/Public/Project/SpringBok/src/sba/contract.mjs";
  if (existsSync(springBokContractPath)) {
    const sbContract = await import(`file:///${springBokContractPath}`);
    const validatedReq = sbContract.validateRequest(requestObj, manifest);
    sbContract.validateResult(result, validatedReq);
  }

  return { exitCode, result };
}

test("EasySms .sba manifest v3 and deployment v2 pass offline contract validation", async () => {
  const summary = await validateEasySmsSba(repoRoot);
  assert.equal(summary.application, "easysms");
  assert.equal(summary.manifestSchema, 3);
  assert.equal(summary.deploymentSchema, 2);
  assert.equal(summary.target, "cloudflare-workers");
});

test("Full SBA v3 lifecycle: deploy -> verify (zero secrets) -> preview -> destroy-preview -> update (backup + data preservation)", async () => {
  const workerBundleUrl = new URL("../../service/base/dist/worker.mjs", import.meta.url).href;
  const workerModule = await import(workerBundleUrl);
  const fakeCf = new FakeCloudflareState(workerModule);
  fakeCf.createDatabase(PROD_DB_ID, "easysms-prod-state");
  fakeCf.createPrivateBucket(PROD_BUCKET);

  const tempDir = await mkdtemp(join(tmpdir(), "easysms-sba-test-"));
  try {
    const prodConfig = buildConfig({
      envName: "prod",
      dbId: PROD_DB_ID,
      dbName: "easysms-prod-state",
      bucketName: PROD_BUCKET,
    });
    const secretsEnv = createSecretsEnv();
    const fetchImpl = fakeCf.buildFetch();

    // 1. DEPLOY (1.0.0)
    const deployReq = {
      schemaVersion: 3,
      taskId: INSTANCE_ID,
      action: "deploy",
      repository: "owner/EasySms",
      sourceSha: SHA_V1,
      applicationId: "easysms",
      applicationVersion: "1.0.0",
      environment: "prod",
      configuration: prodConfig,
      previous: null,
    };
    const deployRun = await runActionWithManifestVersion(tempDir, "1.0.0", deployReq, {
      env: secretsEnv,
      fetchImpl,
    });
    assert.equal(deployRun.exitCode, 0, JSON.stringify(deployRun.result));
    assert.equal(deployRun.result.status, "succeeded");
    assert.ok(deployRun.result.checks.some((c) => c.id === "service-ready" && c.passed));

    // Mutate live Worker state so D1 has real persisted business data!
    const mutateResp = await fetchImpl(`${prodConfig.workerOrigin}/admin/providers/onlinesim/disable`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretsEnv.EASYSMS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "live_business_state", durationSeconds: 3600 }),
    });
    assert.equal(mutateResp.status, 200);
    assert.equal(fakeCf.databases.get(PROD_DB_ID).stateRows.size, 1);

    // 2. VERIFY (1.0.0) with placeholder secrets ("verification-not-applicable")
    const verifyEnv = Object.fromEntries(
      Object.keys(secretsEnv).map((k) => [k, "verification-not-applicable"]),
    );
    const verifyReq = {
      schemaVersion: 3,
      taskId: "dc-" + "3".repeat(32),
      action: "verify",
      repository: "owner/EasySms",
      sourceSha: SHA_V1,
      applicationId: "easysms",
      applicationVersion: "1.0.0",
      environment: "prod",
      configuration: prodConfig,
      previous: { sourceSha: SHA_V1, applicationVersion: "1.0.0" },
    };
    const verifyRun = await runActionWithManifestVersion(tempDir, "1.0.0", verifyReq, {
      env: verifyEnv,
      fetchImpl,
    });
    assert.equal(verifyRun.exitCode, 0);
    assert.equal(verifyRun.result.status, "succeeded");
    assert.ok(verifyRun.result.checks.some((c) => c.id === "auth-boundary-verified" && c.passed));

    // 3. PREVIEW (1.0.0 -> 1.1.0 in isolated test-abc123 environment)
    fakeCf.createDatabase(PREVIEW_DB_ID, "easysms-test-abc123-state");
    fakeCf.createPrivateBucket(PREVIEW_BUCKET);
    const previewConfig = buildConfig({
      envName: "test-abc123",
      dbId: PREVIEW_DB_ID,
      dbName: "easysms-test-abc123-state",
      bucketName: PREVIEW_BUCKET,
    });
    const previewResources = [
      { key: "resource-database", kind: "d1", accountId: ACCOUNT_ID, remoteId: PREVIEW_DB_ID, name: "easysms-test-abc123-state" },
      { key: "resource-backups", kind: "r2", accountId: ACCOUNT_ID, remoteId: PREVIEW_BUCKET, name: PREVIEW_BUCKET },
      { key: "target-0", kind: "worker", accountId: ACCOUNT_ID, remoteId: previewConfig.workerName, name: previewConfig.workerName },
      { key: "target-1", kind: "domain", accountId: ACCOUNT_ID, remoteId: previewConfig.workerOrigin, name: previewConfig.workerOrigin },
    ];
    const sourceResources = [
      { key: "resource-database", kind: "d1", accountId: ACCOUNT_ID, remoteId: PROD_DB_ID, name: "easysms-prod-state" },
      { key: "resource-backups", kind: "r2", accountId: ACCOUNT_ID, remoteId: PROD_BUCKET, name: PROD_BUCKET },
      { key: "target-0", kind: "worker", accountId: ACCOUNT_ID, remoteId: prodConfig.workerName, name: prodConfig.workerName },
      { key: "target-1", kind: "domain", accountId: ACCOUNT_ID, remoteId: prodConfig.workerOrigin, name: prodConfig.workerOrigin },
    ];

    const previewReq = {
      schemaVersion: 3,
      taskId: PREVIEW_TASK_ID,
      action: "preview",
      repository: "owner/EasySms",
      sourceSha: SHA_V2,
      applicationId: "easysms",
      applicationVersion: "1.1.0",
      environment: "test-abc123",
      configuration: previewConfig,
      previous: { sourceSha: SHA_V1, applicationVersion: "1.0.0" },
      context: {
        source: {
          instanceId: INSTANCE_ID,
          taskId: INSTANCE_ID,
          sourceSha: SHA_V1,
          applicationVersion: "1.0.0",
          environment: "prod",
          configuration: prodConfig,
          resources: sourceResources,
          resultDigest: "c".repeat(64),
        },
        resources: previewResources,
        urls: [previewConfig.workerOrigin],
      },
    };
    const previewRun = await runActionWithManifestVersion(tempDir, "1.1.0", previewReq, {
      env: secretsEnv,
      fetchImpl,
    });
    assert.equal(previewRun.exitCode, 0);
    assert.equal(previewRun.result.status, "succeeded");
    for (const requiredCheck of ["snapshot-copied", "migration-verified", "source-unchanged", "side-effects-isolated"]) {
      assert.ok(previewRun.result.checks.some((c) => c.id === requiredCheck && c.passed), `missing check ${requiredCheck}`);
    }
    assert.equal(previewRun.result.lifecycle.urls[0], previewConfig.workerOrigin);
    assert.match(previewRun.result.lifecycle.snapshot.id, /^[a-f0-9]{64}$/);

    // 4. DESTROY-PREVIEW (1.1.0)
    const destroyReq = {
      schemaVersion: 3,
      taskId: "dc-" + "4".repeat(32),
      action: "destroy-preview",
      repository: "owner/EasySms",
      sourceSha: SHA_V2,
      applicationId: "easysms",
      applicationVersion: "1.1.0",
      environment: "test-abc123",
      configuration: previewConfig,
      previous: { sourceSha: SHA_V2, applicationVersion: "1.1.0" },
      context: {
        instanceId: PREVIEW_TASK_ID,
        previewTaskId: PREVIEW_TASK_ID,
        resultDigest: "d".repeat(64),
        resources: previewResources,
      },
    };
    const destroyRun = await runActionWithManifestVersion(tempDir, "1.1.0", destroyReq, {
      env: secretsEnv,
      fetchImpl,
    });
    assert.equal(destroyRun.exitCode, 0);
    assert.equal(destroyRun.result.status, "succeeded");
    assert.equal(fakeCf.databases.has(PREVIEW_DB_ID), false);
    assert.equal(fakeCf.buckets.has(PREVIEW_BUCKET), false);
    assert.equal(fakeCf.workers.has(previewConfig.workerName), false);
    assert.ok(destroyRun.result.lifecycle.resources.every((r) => r.status === "removed"));

    // 5. UPDATE (1.0.0 -> 1.1.0 on production, preserving live D1 state & writing encrypted backup)
    const updateReq = {
      schemaVersion: 3,
      taskId: "dc-" + "5".repeat(32),
      action: "update",
      repository: "owner/EasySms",
      sourceSha: SHA_V2,
      applicationId: "easysms",
      applicationVersion: "1.1.0",
      environment: "prod",
      configuration: prodConfig,
      previous: { sourceSha: SHA_V1, applicationVersion: "1.0.0" },
    };
    const updateRun = await runActionWithManifestVersion(tempDir, "1.1.0", updateReq, {
      env: secretsEnv,
      fetchImpl,
    });
    assert.equal(updateRun.exitCode, 0);
    assert.equal(updateRun.result.status, "succeeded");
    assert.ok(updateRun.result.checks.some((c) => c.id === "backup-created" && c.passed));
    assert.ok(updateRun.result.checks.some((c) => c.id === "data-preserved" && c.passed));
    assert.equal(fakeCf.buckets.get(PROD_BUCKET).objects.size, 1);

    // Verify the live disabled state on `onlinesim` survived the 1.0.0 -> 1.1.0 update!
    const postUpdateHealth = await fetchImpl(`${prodConfig.workerOrigin}/providers/health?providerKey=onlinesim`, {
      headers: { Authorization: `Bearer ${secretsEnv.EASYSMS_API_KEY}` },
    });
    const postUpdateJson = await postUpdateHealth.json();
    assert.equal(postUpdateJson.providers[0].status, "temporarily_disabled");
    assert.equal(postUpdateJson.providers[0].temporarilyDisabledReason, "live_business_state");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Fail-closed vs unknown boundaries: pre-write failure returns failed; mid-write failure returns unknown without leaking secrets", async () => {
  const workerBundleUrl = new URL("../../service/base/dist/worker.mjs", import.meta.url).href;
  const workerModule = await import(workerBundleUrl);
  const fakeCf = new FakeCloudflareState(workerModule);
  fakeCf.createDatabase(PROD_DB_ID, "easysms-prod-state");
  fakeCf.createPrivateBucket(PROD_BUCKET);

  const tempDir = await mkdtemp(join(tmpdir(), "easysms-sba-fail-"));
  try {
    const prodConfig = buildConfig({
      envName: "prod",
      dbId: PROD_DB_ID,
      dbName: "easysms-prod-state",
      bucketName: PROD_BUCKET,
    });
    const secretsEnv = createSecretsEnv();
    const fetchImpl = fakeCf.buildFetch();

    // Pre-write failure: missing/disabled EASYSMS_API_KEY -> status: "failed"
    const badEnvRun = await runActionWithManifestVersion(
      tempDir,
      "1.0.0",
      {
        schemaVersion: 3,
        taskId: INSTANCE_ID,
        action: "deploy",
        repository: "owner/EasySms",
        sourceSha: SHA_V1,
        applicationId: "easysms",
        applicationVersion: "1.0.0",
        environment: "prod",
        configuration: prodConfig,
        previous: null,
      },
      {
        env: createSecretsEnv({ EASYSMS_API_KEY: "disabled" }),
        fetchImpl,
      },
    );
    assert.equal(badEnvRun.exitCode, 1);
    assert.equal(badEnvRun.result.status, "failed");
    assert.match(badEnvRun.result.errorCode, /^EASYSMS_SBA_API_KEY_INVALID/);
    assert.equal(Object.hasOwn(badEnvRun.result, "diagnostics"), false);
    assert.ok(!JSON.stringify(badEnvRun.result).includes(secretsEnv.EASYSMS_CLOUDFLARE_API_TOKEN));

    // Mid-write failure: Cloudflare 504 during Worker upload after D1 schema write -> status: "unknown"
    fakeCf.failNextWorkerUpload = true;
    const midWriteRun = await runActionWithManifestVersion(
      tempDir,
      "1.0.0",
      {
        schemaVersion: 3,
        taskId: INSTANCE_ID,
        action: "deploy",
        repository: "owner/EasySms",
        sourceSha: SHA_V1,
        applicationId: "easysms",
        applicationVersion: "1.0.0",
        environment: "prod",
        configuration: prodConfig,
        previous: null,
      },
      {
        env: secretsEnv,
        fetchImpl,
      },
    );
    assert.equal(midWriteRun.exitCode, 1);
    assert.equal(midWriteRun.result.status, "unknown");
    assert.match(midWriteRun.result.errorCode, /__WORKER_UPLOAD$/);
    assert.equal(Object.hasOwn(midWriteRun.result, "diagnostics"), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
