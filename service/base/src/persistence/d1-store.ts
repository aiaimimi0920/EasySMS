import type { EasySmsRuntimeStateSnapshot } from "../domain/models.js";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  exec?(query: string): Promise<unknown>;
}

export interface EasySmsD1StoredState {
  revision: number;
  sha256: string;
  updatedAt: string;
  snapshot: EasySmsRuntimeStateSnapshot;
}

const RUNTIME_STATE_SLOT = "primary";
const RUNTIME_STATE_SCHEMA_VERSION = 1;
const initializedDbs = new WeakSet<D1DatabaseLike>();

export async function sha256HexWeb(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function ensureEasySmsD1Schema(db: D1DatabaseLike): Promise<void> {
  if (initializedDbs.has(db)) {
    return;
  }
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS easysms_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS easysms_runtime_state (slot TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  initializedDbs.add(db);
}

export async function peekEasySmsRuntimeStateRevisionFromD1(
  db: D1DatabaseLike,
): Promise<number | undefined> {
  await ensureEasySmsD1Schema(db);
  const row = await db.prepare(
    "SELECT revision FROM easysms_runtime_state WHERE slot = ?",
  )
    .bind(RUNTIME_STATE_SLOT)
    .first<{ revision: number }>();
  return row ? Number(row.revision) || 1 : undefined;
}

export async function loadEasySmsRuntimeStateFromD1(
  db: D1DatabaseLike,
): Promise<EasySmsD1StoredState | undefined> {
  await ensureEasySmsD1Schema(db);
  const row = await db.prepare(
    "SELECT revision, schema_version, payload_json, sha256, updated_at FROM easysms_runtime_state WHERE slot = ?",
  )
    .bind(RUNTIME_STATE_SLOT)
    .first<{
      revision: number;
      schema_version: number;
      payload_json: string;
      sha256: string;
      updated_at: string;
    }>();

  if (!row) {
    return undefined;
  }

  const computedHash = await sha256HexWeb(row.payload_json);
  if (computedHash !== row.sha256) {
    throw new Error("Persisted D1 runtime state failed SHA-256 integrity verification.");
  }

  const snapshot = JSON.parse(row.payload_json) as EasySmsRuntimeStateSnapshot;
  return {
    revision: Number(row.revision) || 1,
    sha256: row.sha256,
    updatedAt: row.updated_at,
    snapshot,
  };
}

export async function saveEasySmsRuntimeStateToD1(
  db: D1DatabaseLike,
  snapshot: EasySmsRuntimeStateSnapshot,
): Promise<{ revision: number; sha256: string; updatedAt: string }> {
  await ensureEasySmsD1Schema(db);
  const payloadJson = JSON.stringify(snapshot);
  const sha256 = await sha256HexWeb(payloadJson);
  const updatedAt = snapshot.updatedAt || new Date().toISOString();

  await db.prepare(
    `INSERT INTO easysms_runtime_state (slot, revision, schema_version, payload_json, sha256, updated_at)
     VALUES (?, 1, ?, ?, ?, ?)
     ON CONFLICT(slot) DO UPDATE SET
       revision = easysms_runtime_state.revision + 1,
       schema_version = excluded.schema_version,
       payload_json = excluded.payload_json,
       sha256 = excluded.sha256,
       updated_at = excluded.updated_at`,
  )
    .bind(RUNTIME_STATE_SLOT, RUNTIME_STATE_SCHEMA_VERSION, payloadJson, sha256, updatedAt)
    .run();

  const saved = await db.prepare(
    "SELECT revision FROM easysms_runtime_state WHERE slot = ?",
  )
    .bind(RUNTIME_STATE_SLOT)
    .first<{ revision: number }>();

  return {
    revision: Number(saved?.revision) || 1,
    sha256,
    updatedAt,
  };
}
