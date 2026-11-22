import { SbaActionError, requireCondition } from "./errors.mjs";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
export const WORKER_COMPATIBILITY_DATE = "2025-01-15";

export function isUsableCredential(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 16_384
    && value !== "verification-not-applicable";
}

async function boundedFetch(fetchImpl, url, options = {}, step = "cloudflare-http", timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    throw new SbaActionError("EASYSMS_SBA_UPSTREAM_UNREACHABLE", {
      failedStep: step,
      uncertain: Boolean(options.method && options.method !== "GET" && options.method !== "HEAD"),
    });
  } finally {
    clearTimeout(timer);
  }
}

export class CloudflareApiClient {
  constructor(accountId, apiToken, fetchImpl = fetch, mutationTracker = { started: false }) {
    requireCondition(
      /^[a-f0-9]{32}$/.test(String(accountId ?? "")) && isUsableCredential(apiToken),
      "EASYSMS_SBA_CLOUDFLARE_CREDENTIALS_INVALID",
      { failedStep: "credentials-check" },
    );
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.fetchImpl = fetchImpl;
    this.mutationTracker = mutationTracker;
  }

  async requestJson(method, path, { body, headers = {}, step = "cloudflare-api", allow404Code = null, isWrite = false, workerDomainResponse = false } = {}) {
    if (isWrite) {
      this.mutationTracker.started = true;
    }
    const response = await boundedFetch(
      this.fetchImpl,
      `${CLOUDFLARE_API_BASE}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
          ...headers,
        },
        body,
      },
      step,
    );

    const rawText = await response.text();
    if (response.ok && method === "DELETE" && !rawText.trim()) {
      return null;
    }
    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new SbaActionError("EASYSMS_SBA_CLOUDFLARE_RESPONSE_INVALID", {
        failedStep: step,
        providerStatus: response.status,
        uncertain: isWrite,
      });
    }

    if (response.status === 404 && allow404Code !== null) {
      const code = parsed?.errors?.[0]?.code;
      if (parsed?.success === false && code === allow404Code) {
        return null;
      }
    }

    if (response.ok && workerDomainResponse && method === "PUT" && parsed && !Object.hasOwn(parsed, "success") && typeof parsed.id === "string" && typeof parsed.hostname === "string") {
      return parsed;
    }

    if (!response.ok || !parsed || parsed.success !== true) {
      const firstErrorCode = Number.isSafeInteger(parsed?.errors?.[0]?.code)
        ? parsed.errors[0].code
        : undefined;
      throw new SbaActionError("EASYSMS_SBA_CLOUDFLARE_API_REJECTED", {
        failedStep: step,
        providerStatus: response.status,
        providerCode: firstErrorCode,
        uncertain: isWrite,
      });
    }

    return parsed.result;
  }

  // --- D1 Operations ---
  async verifyD1Database(databaseId, expectedName) {
    const info = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/d1/database/${databaseId}`,
      { step: "d1-verify" },
    );
    requireCondition(
      info && info.uuid === databaseId && (!expectedName || info.name === expectedName),
      "EASYSMS_SBA_D1_IDENTITY_MISMATCH",
      { failedStep: "d1-verify" },
    );
    return info;
  }

  async queryD1(databaseId, sql, params = [], { isWrite = false, step = "d1-query" } = {}) {
    const result = await this.requestJson(
      "POST",
      `/accounts/${this.accountId}/d1/database/${databaseId}/query`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
        step,
        isWrite,
      },
    );
    requireCondition(
      Array.isArray(result) && result.length === 1 && result[0]?.success === true && Array.isArray(result[0]?.results),
      "EASYSMS_SBA_D1_QUERY_INVALID",
      { failedStep: step, uncertain: isWrite },
    );
    return result[0].results;
  }

  async applyD1Schema(databaseId, statements) {
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed) {
        continue;
      }
      await this.queryD1(databaseId, trimmed, [], { isWrite: true, step: "d1-migrate" });
    }
  }

  async listD1Tables(databaseId) {
    const rows = await this.queryD1(
      databaseId,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'easysms_%' ORDER BY name ASC",
      [],
      { isWrite: false, step: "d1-inspect" },
    );
    return rows.map((row) => String(row.name));
  }

  async readD1Meta(databaseId) {
    const tables = await this.listD1Tables(databaseId);
    if (!tables.includes("easysms_meta")) {
      return null;
    }
    const rows = await this.queryD1(
      databaseId,
      "SELECT key, value, updated_at FROM easysms_meta ORDER BY key ASC",
      [],
      { isWrite: false, step: "d1-meta-read" },
    );
    return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
  }

  async writeD1Meta(databaseId, entries) {
    const nowIso = new Date().toISOString();
    for (const [key, value] of Object.entries(entries)) {
      await this.queryD1(
        databaseId,
        `INSERT INTO easysms_meta (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, String(value), nowIso],
        { isWrite: true, step: "d1-meta-write" },
      );
    }
  }

  async exportD1Snapshot(databaseId) {
    const tables = await this.listD1Tables(databaseId);
    const metaRows = tables.includes("easysms_meta")
      ? await this.queryD1(
          databaseId,
          "SELECT key, value, updated_at FROM easysms_meta ORDER BY key ASC",
          [],
          { isWrite: false, step: "d1-export" },
        )
      : [];
    const stateRows = tables.includes("easysms_runtime_state")
      ? await this.queryD1(
          databaseId,
          "SELECT slot, revision, schema_version, payload_json, sha256, updated_at FROM easysms_runtime_state ORDER BY slot ASC",
          [],
          { isWrite: false, step: "d1-export" },
        )
      : [];
    return {
      schemaVersion: 1,
      metaRows,
      stateRows,
    };
  }

  async importD1RuntimeStateRows(databaseId, stateRows) {
    for (const row of stateRows) {
      await this.queryD1(
        databaseId,
        `INSERT INTO easysms_runtime_state (slot, revision, schema_version, payload_json, sha256, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slot) DO UPDATE SET
           revision = excluded.revision,
           schema_version = excluded.schema_version,
           payload_json = excluded.payload_json,
           sha256 = excluded.sha256,
           updated_at = excluded.updated_at`,
        [
          String(row.slot),
          Number(row.revision) || 1,
          Number(row.schema_version) || 1,
          String(row.payload_json),
          String(row.sha256),
          String(row.updated_at),
        ],
        { isWrite: true, step: "d1-import" },
      );
    }
  }

  async deleteD1DatabaseAndVerifyAbsent(databaseId) {
    await this.requestJson(
      "DELETE",
      `/accounts/${this.accountId}/d1/database/${databaseId}`,
      { step: "d1-delete", isWrite: true },
    );
    const absent = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/d1/database/${databaseId}`,
      { step: "d1-verify-absent", allow404Code: 7404 },
    );
    requireCondition(absent === null, "EASYSMS_SBA_D1_DELETE_UNCONFIRMED", {
      failedStep: "d1-verify-absent",
      uncertain: true,
    });
  }

  // --- R2 Operations ---
  async verifyPrivateR2Bucket(bucketName) {
    const listed = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/r2/buckets?per_page=1000&name_contains=${encodeURIComponent(bucketName)}`,
      { step: "r2-verify" },
    );
    const buckets = Array.isArray(listed?.buckets) ? listed.buckets : [];
    const matched = buckets.filter((item) => item?.name === bucketName);
    requireCondition(matched.length === 1, "EASYSMS_SBA_R2_BUCKET_MISSING", { failedStep: "r2-verify" });

    const managed = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
      { step: "r2-verify" },
    );
    requireCondition(managed?.enabled === false, "EASYSMS_SBA_R2_BUCKET_NOT_PRIVATE", {
      failedStep: "r2-verify",
    });

    const custom = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`,
      { step: "r2-verify" },
    );
    requireCondition(
      Array.isArray(custom?.domains) && custom.domains.length === 0,
      "EASYSMS_SBA_R2_BUCKET_HAS_CUSTOM_DOMAIN",
      { failedStep: "r2-verify" },
    );
    return matched[0];
  }

  async putR2ObjectText(bucketName, objectKey, contentText) {
    this.mutationTracker.started = true;
    const response = await boundedFetch(
      this.fetchImpl,
      `${CLOUDFLARE_API_BASE}/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: contentText,
      },
      "r2-put",
    );
    requireCondition(response.ok, "EASYSMS_SBA_R2_PUT_FAILED", {
      failedStep: "r2-put",
      providerStatus: response.status,
      uncertain: true,
    });
  }

  async getR2ObjectText(bucketName, objectKey, { allow404 = false } = {}) {
    const response = await boundedFetch(
      this.fetchImpl,
      `${CLOUDFLARE_API_BASE}/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(objectKey)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      },
      "r2-get",
    );
    if (allow404 && response.status === 404) {
      return null;
    }
    requireCondition(response.ok, "EASYSMS_SBA_R2_GET_FAILED", {
      failedStep: "r2-get",
      providerStatus: response.status,
    });
    return response.text();
  }

  async emptyAndDeleteR2Bucket(bucketName) {
    const listResult = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects?per_page=1000`,
      { step: "r2-list" },
    );
    const items = Array.isArray(listResult) ? listResult : [];
    const keys = items.map((item) => String(item.key));
    if (keys.length > 0) {
      await this.requestJson(
        "DELETE",
        `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects`,
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(keys),
          step: "r2-empty",
          isWrite: true,
        },
      );
      const afterEmpty = await this.requestJson(
        "GET",
        `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects?per_page=1000`,
        { step: "r2-verify-empty" },
      );
      requireCondition(
        Array.isArray(afterEmpty) && afterEmpty.length === 0,
        "EASYSMS_SBA_R2_EMPTY_UNCONFIRMED",
        { failedStep: "r2-verify-empty", uncertain: true },
      );
    }

    await this.requestJson(
      "DELETE",
      `/accounts/${this.accountId}/r2/buckets/${encodeURIComponent(bucketName)}`,
      { step: "r2-delete", isWrite: true },
    );

    const listedAfter = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/r2/buckets?per_page=1000&name_contains=${encodeURIComponent(bucketName)}`,
      { step: "r2-verify-absent" },
    );
    const remaining = (Array.isArray(listedAfter?.buckets) ? listedAfter.buckets : [])
      .filter((item) => item?.name === bucketName);
    requireCondition(remaining.length === 0, "EASYSMS_SBA_R2_DELETE_UNCONFIRMED", {
      failedStep: "r2-verify-absent",
      uncertain: true,
    });
  }

  // --- Worker & Domain Operations ---
  async getWorkerSettingsOrAbsent(workerName) {
    return this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/scripts/${workerName}/settings`,
      { step: "worker-inspect", allow404Code: 10007 },
    );
  }

  async uploadWorkerAndVerify(workerName, metadata, bundleBuffer) {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("worker.mjs", new Blob([bundleBuffer], { type: "application/javascript+module" }), "worker.mjs");

    const uploaded = await this.requestJson(
      "PUT",
      `/accounts/${this.accountId}/workers/scripts/${workerName}`,
      { body: form, step: "worker-upload", isWrite: true },
    );
    requireCondition(
      uploaded && uploaded.id === workerName && typeof uploaded.etag === "string" && uploaded.etag.length > 0,
      "EASYSMS_SBA_WORKER_UPLOAD_UNCONFIRMED",
      { failedStep: "worker-upload", uncertain: true },
    );

    const settings = await this.getWorkerSettingsOrAbsent(workerName);
    this.verifyWorkerSettings(settings, metadata);
    return uploaded;
  }

  verifyWorkerSettings(settings, expectedMetadata) {
    requireCondition(
      settings
        && settings.compatibility_date === expectedMetadata.compatibility_date
        && Array.isArray(settings.tags)
        && JSON.stringify([...settings.tags].sort()) === JSON.stringify([...expectedMetadata.tags].sort())
        && settings.observability?.enabled === true
        && Array.isArray(settings.bindings)
        && settings.bindings.length === expectedMetadata.bindings.length,
      "EASYSMS_SBA_WORKER_SETTINGS_MISMATCH",
      { failedStep: "worker-verify-settings" },
    );

    const actualByName = Object.fromEntries(settings.bindings.map((binding) => [binding.name, binding]));
    for (const expected of expectedMetadata.bindings) {
      const actual = actualByName[expected.name];
      requireCondition(
        actual && actual.type === expected.type,
        "EASYSMS_SBA_WORKER_BINDINGS_MISMATCH",
        { failedStep: "worker-verify-settings" },
      );
      if (expected.type === "d1") {
        requireCondition(actual.id === expected.id, "EASYSMS_SBA_WORKER_D1_BINDING_MISMATCH", {
          failedStep: "worker-verify-settings",
        });
      } else if (expected.type === "r2_bucket") {
        requireCondition(actual.bucket_name === expected.bucket_name, "EASYSMS_SBA_WORKER_R2_BINDING_MISMATCH", {
          failedStep: "worker-verify-settings",
        });
      } else if (expected.type === "plain_text") {
        requireCondition(actual.text === expected.text, "EASYSMS_SBA_WORKER_TEXT_BINDING_MISMATCH", {
          failedStep: "worker-verify-settings",
        });
      }
    }
  }

  async enableAndVerifyWorkersDevSubdomain(workerName) {
    const enabled = await this.requestJson(
      "POST",
      `/accounts/${this.accountId}/workers/scripts/${workerName}/subdomain`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, previews_enabled: false }),
        step: "worker-subdomain-enable",
        isWrite: true,
      },
    );
    requireCondition(
      enabled?.enabled === true && enabled?.previews_enabled === false,
      "EASYSMS_SBA_WORKER_SUBDOMAIN_UNCONFIRMED",
      { failedStep: "worker-subdomain-enable", uncertain: true },
    );

    const readBack = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/scripts/${workerName}/subdomain`,
      { step: "worker-subdomain-verify" },
    );
    requireCondition(
      readBack?.enabled === true && readBack?.previews_enabled === false,
      "EASYSMS_SBA_WORKER_SUBDOMAIN_MISMATCH",
      { failedStep: "worker-subdomain-verify", uncertain: true },
    );
  }

  async bindAndVerifyCustomDomain(
    workerName,
    hostname,
    { allowExistingSameWorker = false, maxVerifyAttempts = 24, verifyDelayMs = 3_000 } = {},
  ) {
    const zoneName = hostname.split(".").slice(1).join(".");
    const zones = await this.requestJson(
      "GET",
      `/zones?account.id=${this.accountId}&name=${encodeURIComponent(zoneName)}&per_page=50&page=1`,
      { step: "domain-zone-verify" },
    );
    requireCondition(
      Array.isArray(zones) && zones.length === 1 && zones[0]?.status === "active" && zones[0]?.account?.id === this.accountId,
      "EASYSMS_SBA_DOMAIN_ZONE_INVALID",
      { failedStep: "domain-zone-verify" },
    );
    const zoneId = zones[0].id;

    const existingRows = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
      { step: "domain-inspect", workerDomainResponse: true },
    );
    requireCondition(Array.isArray(existingRows), "EASYSMS_SBA_DOMAIN_CONFLICT", {
      failedStep: "domain-inspect",
    });
    const existing = existingRows.filter((item) => item?.hostname === hostname);
    requireCondition(existing.length <= 1, "EASYSMS_SBA_DOMAIN_CONFLICT", {
      failedStep: "domain-inspect",
    });

    if (existing.length === 1) {
      requireCondition(
        allowExistingSameWorker && existing[0].service === workerName && existing[0].zone_id === zoneId,
        "EASYSMS_SBA_DOMAIN_ALREADY_BOUND",
        { failedStep: "domain-inspect" },
      );
      return existing[0];
    }

    await this.requestJson(
      "PUT",
      `/accounts/${this.accountId}/workers/domains`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname,
          service: workerName,
          zone_id: zoneId,
          enabled: true,
          previews_enabled: false,
        }),
        step: "domain-bind",
        isWrite: true,
        workerDomainResponse: true,
      },
    );

    let verifiedMatch = null;
    const attempts = Math.max(1, Number(maxVerifyAttempts) || 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const verifiedRows = await this.requestJson(
        "GET",
        `/accounts/${this.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
        { step: "domain-verify", workerDomainResponse: true },
      );
      const matched = Array.isArray(verifiedRows)
        ? verifiedRows.filter((item) => item?.hostname === hostname)
        : null;
      if (
        Array.isArray(matched)
        && matched.length === 1
        && matched[0]?.service === workerName
        && matched[0]?.zone_id === zoneId
      ) {
        verifiedMatch = matched[0];
        break;
      }
      if (attempt < attempts - 1 && verifyDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, verifyDelayMs));
      }
    }

    requireCondition(verifiedMatch !== null, "EASYSMS_SBA_DOMAIN_VERIFY_FAILED", {
      failedStep: "domain-verify",
      uncertain: true,
    });
    return verifiedMatch;
  }

  async unbindCustomDomainIfPresent(hostname, expectedWorkerName) {
    const existingRows = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
      { step: "domain-unbind-inspect", workerDomainResponse: true },
    );
    const existing = Array.isArray(existingRows)
      ? existingRows.filter((item) => item?.hostname === hostname)
      : [];
    if (existing.length === 0) {
      return;
    }
    requireCondition(
      existing.length === 1 && existing[0]?.service === expectedWorkerName && typeof existing[0]?.id === "string",
      "EASYSMS_SBA_DOMAIN_OWNERSHIP_MISMATCH",
      { failedStep: "domain-unbind-inspect" },
    );
    await this.requestJson(
      "DELETE",
      `/accounts/${this.accountId}/workers/domains/${existing[0].id}`,
      { step: "domain-unbind", isWrite: true },
    );
    const afterRows = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
      { step: "domain-unbind-verify", workerDomainResponse: true },
    );
    const after = Array.isArray(afterRows)
      ? afterRows.filter((item) => item?.hostname === hostname)
      : null;
    requireCondition(Array.isArray(after) && after.length === 0, "EASYSMS_SBA_DOMAIN_UNBIND_UNCONFIRMED", {
      failedStep: "domain-unbind-verify",
      uncertain: true,
    });
  }

  async deleteWorkerAndVerifyAbsent(workerName) {
    await this.requestJson(
      "DELETE",
      `/accounts/${this.accountId}/workers/scripts/${workerName}`,
      { step: "worker-delete", isWrite: true },
    );
    const scripts = await this.requestJson(
      "GET",
      `/accounts/${this.accountId}/workers/scripts`,
      { step: "worker-verify-absent" },
    );
    requireCondition(
      Array.isArray(scripts) && !scripts.some((item) => item?.id === workerName),
      "EASYSMS_SBA_WORKER_DELETE_UNCONFIRMED",
      { failedStep: "worker-verify-absent", uncertain: true },
    );
  }
}

export async function verifyPublicAndProtectedOrigin({
  origin,
  expectedRelease,
  apiKey,
  expectPreviewIsolation = false,
  fetchImpl = fetch,
  maxAttempts = 36,
  propagationDelayMs = 5_000,
}) {
  let releaseMatched = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const releaseResp = await boundedFetch(
        fetchImpl,
        `${origin}/.well-known/easysms-release.json`,
        { method: "GET", headers: { "Cache-Control": "no-cache" } },
        "verify-release",
        15_000,
      );
      if (releaseResp.status === 200) {
        const payload = await releaseResp.json();
        if (
          payload?.schemaVersion === 1
          && payload?.applicationId === expectedRelease.applicationId
          && payload?.applicationVersion === expectedRelease.applicationVersion
          && payload?.sourceSha === expectedRelease.sourceSha
          && payload?.environment === expectedRelease.environment
          && payload?.purpose === expectedRelease.purpose
        ) {
          releaseMatched = true;
          break;
        }
      }
    } catch {
      // Allow read-only edge propagation delay
    }
    if (attempt < maxAttempts - 1 && propagationDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, propagationDelayMs));
    }
  }

  requireCondition(releaseMatched, "EASYSMS_SBA_PUBLIC_RELEASE_MISMATCH", {
    failedStep: "verify-release",
  });

  const healthResp = await boundedFetch(fetchImpl, `${origin}/healthz`, { method: "GET" }, "verify-healthz", 15_000);
  requireCondition(healthResp.status === 200, "EASYSMS_SBA_HEALTHZ_FAILED", {
    failedStep: "verify-healthz",
    providerStatus: healthResp.status,
  });
  const healthPayload = await healthResp.json();
  requireCondition(
    healthPayload?.status === "ok" && healthPayload?.service === "easy-sms",
    "EASYSMS_SBA_HEALTHZ_UNHEALTHY",
    { failedStep: "verify-healthz" },
  );

  const openApiResp = await boundedFetch(fetchImpl, `${origin}/openapi.json`, { method: "GET" }, "verify-openapi", 15_000);
  requireCondition(openApiResp.status === 200, "EASYSMS_SBA_OPENAPI_FAILED", {
    failedStep: "verify-openapi",
    providerStatus: openApiResp.status,
  });
  const openApiPayload = await openApiResp.json();
  requireCondition(openApiPayload?.openapi === "3.1.0", "EASYSMS_SBA_OPENAPI_INVALID", {
    failedStep: "verify-openapi",
  });

  const unauthResp = await boundedFetch(fetchImpl, `${origin}/sms/catalog`, { method: "GET" }, "verify-auth-boundary", 15_000);
  requireCondition(unauthResp.status === 401, "EASYSMS_SBA_AUTH_NOT_ENFORCED", {
    failedStep: "verify-auth-boundary",
    providerStatus: unauthResp.status,
  });

  if (isUsableCredential(apiKey)) {
    const authHeaders = { Authorization: `Bearer ${apiKey}` };
    const catalogResp = await boundedFetch(
      fetchImpl,
      `${origin}/sms/catalog`,
      { method: "GET", headers: authHeaders },
      "verify-catalog",
      15_000,
    );
    requireCondition(catalogResp.status === 200, "EASYSMS_SBA_CATALOG_VERIFY_FAILED", {
      failedStep: "verify-catalog",
      providerStatus: catalogResp.status,
    });
    const catalogPayload = await catalogResp.json();
    requireCondition(Array.isArray(catalogPayload?.catalog?.providers), "EASYSMS_SBA_CATALOG_PAYLOAD_INVALID", {
      failedStep: "verify-catalog",
    });

    const statsResp = await boundedFetch(
      fetchImpl,
      `${origin}/sms/query/stats`,
      { method: "GET", headers: authHeaders },
      "verify-stats",
      15_000,
    );
    requireCondition(statsResp.status === 200, "EASYSMS_SBA_STATS_VERIFY_FAILED", {
      failedStep: "verify-stats",
      providerStatus: statsResp.status,
    });

    if (expectPreviewIsolation) {
      const blockedResp = await boundedFetch(
        fetchImpl,
        `${origin}/sms/activations`,
        {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ providerKey: "hero_sms", costTier: "paid", service: "dr", country: 16 }),
        },
        "verify-preview-isolation",
        15_000,
      );
      requireCondition(blockedResp.status === 403, "EASYSMS_SBA_PREVIEW_SIDE_EFFECT_NOT_ISOLATED", {
        failedStep: "verify-preview-isolation",
        providerStatus: blockedResp.status,
      });
    }
  }
}
