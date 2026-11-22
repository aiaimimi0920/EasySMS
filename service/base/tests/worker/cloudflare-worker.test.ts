import { describe, expect, it } from "vitest";

import type { D1DatabaseLike, D1PreparedStatementLike } from "../../src/persistence/d1-store.js";
import { createEasySmsWorker, type EasySmsWorkerEnv } from "../../src/worker/index.js";

interface StoredStateRow {
  slot: string;
  revision: number;
  schema_version: number;
  payload_json: string;
  sha256: string;
  updated_at: string;
}

class InMemoryD1Database implements D1DatabaseLike {
  readonly stateRows = new Map<string, StoredStateRow>();
  readonly metaRows = new Map<string, { key: string; value: string; updated_at: string }>();

  prepare(query: string): D1PreparedStatementLike {
    const normalized = query.replace(/\s+/g, " ").trim();
    let boundValues: unknown[] = [];

    const statement: D1PreparedStatementLike = {
      bind(...values: unknown[]) {
        boundValues = values;
        return statement;
      },
      async first<T>() {
        if (normalized.startsWith("SELECT revision, schema_version, payload_json, sha256, updated_at FROM easysms_runtime_state")) {
          const slot = String(boundValues[0] ?? "");
          return (self.stateRows.get(slot) as T | undefined) ?? null;
        }
        if (normalized.startsWith("SELECT revision FROM easysms_runtime_state")) {
          const slot = String(boundValues[0] ?? "");
          const row = self.stateRows.get(slot);
          return (row ? ({ revision: row.revision } as T) : null);
        }
        return null;
      },
      async run() {
        if (normalized.startsWith("CREATE TABLE IF NOT EXISTS")) {
          return { success: true };
        }
        if (normalized.startsWith("INSERT INTO easysms_runtime_state")) {
          const [slot, schemaVersion, payloadJson, sha256, updatedAt] = boundValues;
          const slotKey = String(slot);
          const existing = self.stateRows.get(slotKey);
          self.stateRows.set(slotKey, {
            slot: slotKey,
            revision: existing ? existing.revision + 1 : 1,
            schema_version: Number(schemaVersion),
            payload_json: String(payloadJson),
            sha256: String(sha256),
            updated_at: String(updatedAt),
          });
          return { success: true };
        }
        return { success: true };
      },
      async all<T>() {
        return { results: [] as T[] };
      },
    };

    const self = this;
    return statement;
  }
}

function createBaseEnv(db: D1DatabaseLike, overrides: Partial<EasySmsWorkerEnv> = {}): EasySmsWorkerEnv {
  return {
    STATE_DB: db,
    EASYSMS_API_KEY: "cf-worker-secret-key",
    EASYSMS_HEROSMS_API_KEY: "hero-paid-key",
    SBA_APPLICATION_ID: "easysms",
    SBA_RELEASE_VERSION: "1.0.0",
    SBA_RELEASE_SHA: "a".repeat(40),
    SBA_ENVIRONMENT: "prod",
    SBA_PURPOSE: "production",
    EASYSMS_CONFIG_JSON: JSON.stringify({
      service: {
        strategyModeId: "aggregate-latest",
        heroSmsEnabled: true,
      },
      runtimeOptions: null,
    }),
    ...overrides,
  };
}

describe("Cloudflare Worker runtime & D1 persistence", () => {
  it("enforces mandatory Bearer auth while serving healthz, openapi, and release manifest anonymously", async () => {
    const db = new InMemoryD1Database();
    const worker = createEasySmsWorker();
    const env = createBaseEnv(db);

    const releaseResp = await worker.fetch(
      new Request("https://easysms-prod.example.workers.dev/.well-known/easysms-release.json"),
      env,
    );
    expect(releaseResp.status).toBe(200);
    expect(await releaseResp.json()).toEqual({
      schemaVersion: 1,
      applicationId: "easysms",
      applicationVersion: "1.0.0",
      sourceSha: "a".repeat(40),
      environment: "prod",
      purpose: "production",
    });

    const healthResp = await worker.fetch(new Request("https://easysms-prod.example.workers.dev/healthz"), env);
    expect(healthResp.status).toBe(200);

    const openApiResp = await worker.fetch(new Request("https://easysms-prod.example.workers.dev/openapi.json"), env);
    expect(openApiResp.status).toBe(200);

    const unauthResp = await worker.fetch(new Request("https://easysms-prod.example.workers.dev/sms/catalog"), env);
    expect(unauthResp.status).toBe(401);

    const missingKeyResp = await worker.fetch(
      new Request("https://easysms-prod.example.workers.dev/sms/catalog"),
      createBaseEnv(db, { EASYSMS_API_KEY: "disabled" }),
    );
    expect(missingKeyResp.status).toBe(503);

    const authResp = await worker.fetch(
      new Request("https://easysms-prod.example.workers.dev/sms/catalog", {
        headers: { Authorization: "Bearer cf-worker-secret-key" },
      }),
      env,
    );
    expect(authResp.status).toBe(200);
    const catalogPayload = await authResp.json() as { catalog: { providers: Array<{ key: string }> } };
    expect(catalogPayload.catalog.providers.some((p) => p.key === "hero_sms")).toBe(true);
  });

  it("persists operational mutations to D1 and restores state across cold Worker isolate restarts", async () => {
    const db = new InMemoryD1Database();
    const env = createBaseEnv(db);

    const firstIsolate = createEasySmsWorker();
    const disableResp = await firstIsolate.fetch(
      new Request("https://easysms-prod.example.workers.dev/admin/providers/onlinesim/disable", {
        method: "POST",
        headers: {
          Authorization: "Bearer cf-worker-secret-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "maintenance_window",
          durationSeconds: 3600,
        }),
      }),
      env,
    );
    expect(disableResp.status).toBe(200);
    expect(db.stateRows.get("primary")?.revision).toBe(1);

    // Cold start a brand new Worker isolate backed by the same D1 database
    const secondIsolate = createEasySmsWorker();
    const healthResp = await secondIsolate.fetch(
      new Request("https://easysms-prod.example.workers.dev/providers/health?providerKey=onlinesim", {
        headers: { Authorization: "Bearer cf-worker-secret-key" },
      }),
      env,
    );
    expect(healthResp.status).toBe(200);
    const healthPayload = await healthResp.json() as {
      providers: Array<{ providerKey: string; status: string; temporarilyDisabledReason?: string }>;
    };
    expect(healthPayload.providers[0]).toMatchObject({
      providerKey: "onlinesim",
      status: "temporarily_disabled",
      temporarilyDisabledReason: "maintenance_window",
    });

    // Tamper with SHA-256 in D1 and ensure cold load fails closed
    const row = db.stateRows.get("primary")!;
    db.stateRows.set("primary", { ...row, sha256: "0".repeat(64) });
    const thirdIsolate = createEasySmsWorker();
    await expect(
      thirdIsolate.fetch(
        new Request("https://easysms-prod.example.workers.dev/sms/catalog", {
          headers: { Authorization: "Bearer cf-worker-secret-key" },
        }),
        env,
      ),
    ).rejects.toThrow("SHA-256 integrity");
  });

  it("isolates upstream activation and probe side effects when SBA_PURPOSE is preview", async () => {
    const db = new InMemoryD1Database();
    const previewEnv = createBaseEnv(db, {
      SBA_PURPOSE: "preview",
      SBA_ENVIRONMENT: "test-preview01",
    });
    const worker = createEasySmsWorker();

    const catalogResp = await worker.fetch(
      new Request("https://easysms-test.example.workers.dev/sms/catalog", {
        headers: { Authorization: "Bearer cf-worker-secret-key" },
      }),
      previewEnv,
    );
    expect(catalogResp.status).toBe(200);
    const catalogPayload = await catalogResp.json() as { catalog: { providers: Array<{ key: string }> } };
    // Paid hero_sms is stripped in preview mode
    expect(catalogPayload.catalog.providers.some((p) => p.key === "hero_sms")).toBe(false);

    const blockedActivation = await worker.fetch(
      new Request("https://easysms-test.example.workers.dev/sms/activations", {
        method: "POST",
        headers: {
          Authorization: "Bearer cf-worker-secret-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ providerKey: "hero_sms", service: "dr", country: 16 }),
      }),
      previewEnv,
    );
    expect(blockedActivation.status).toBe(403);

    const blockedProbe = await worker.fetch(
      new Request("https://easysms-test.example.workers.dev/providers/probe", {
        method: "POST",
        headers: { Authorization: "Bearer cf-worker-secret-key" },
      }),
      previewEnv,
    );
    expect(blockedProbe.status).toBe(403);
  });
});
