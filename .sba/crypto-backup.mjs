import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { requireCondition } from "./errors.mjs";

const BACKUP_AAD_CONTEXT = "easysms-sba-d1-backup-v1";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",") + "}";
}

export function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function deriveKey(passphrase, salt) {
  requireCondition(
    typeof passphrase === "string" && passphrase.length > 0 && passphrase !== "verification-not-applicable",
    "EASYSMS_SBA_BACKUP_CREDENTIAL_INVALID",
    { failedStep: "backup-encrypt" },
  );
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(passphrase, "utf8"), salt, Buffer.from(BACKUP_AAD_CONTEXT, "utf8"), 32),
  );
}

export function sealEncryptedBackup(snapshotPayload, passphrase, metadata = {}) {
  const plaintext = canonicalJson(snapshotPayload);
  const plaintextSha256 = sha256Hex(plaintext);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const aad = canonicalJson({ context: BACKUP_AAD_CONTEXT, ...metadata, plaintextSha256 });

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    envelope: {
      schemaVersion: 1,
      algorithm: "AES-256-GCM-HKDF-SHA256",
      metadata,
      plaintextSha256,
      saltB64: salt.toString("base64"),
      ivB64: iv.toString("base64"),
      authTagB64: authTag.toString("base64"),
      ciphertextB64: ciphertext.toString("base64"),
    },
    plaintextSha256,
  };
}

export function openEncryptedBackup(envelope, passphrase) {
  requireCondition(
    envelope
      && typeof envelope === "object"
      && envelope.schemaVersion === 1
      && envelope.algorithm === "AES-256-GCM-HKDF-SHA256"
      && typeof envelope.plaintextSha256 === "string"
      && /^[a-f0-9]{64}$/.test(envelope.plaintextSha256)
      && typeof envelope.saltB64 === "string"
      && typeof envelope.ivB64 === "string"
      && typeof envelope.authTagB64 === "string"
      && typeof envelope.ciphertextB64 === "string",
    "EASYSMS_SBA_BACKUP_ENVELOPE_INVALID",
    { failedStep: "backup-verify" },
  );

  const salt = Buffer.from(envelope.saltB64, "base64");
  const iv = Buffer.from(envelope.ivB64, "base64");
  const authTag = Buffer.from(envelope.authTagB64, "base64");
  const ciphertext = Buffer.from(envelope.ciphertextB64, "base64");
  const key = deriveKey(passphrase, salt);
  const aad = canonicalJson({
    context: BACKUP_AAD_CONTEXT,
    ...(envelope.metadata && typeof envelope.metadata === "object" ? envelope.metadata : {}),
    plaintextSha256: envelope.plaintextSha256,
  });

  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("EASYSMS_SBA_BACKUP_DECRYPT_FAILED");
  }

  requireCondition(
    sha256Hex(plaintext) === envelope.plaintextSha256,
    "EASYSMS_SBA_BACKUP_DIGEST_MISMATCH",
    { failedStep: "backup-verify" },
  );

  return {
    payload: JSON.parse(plaintext),
    plaintextSha256: envelope.plaintextSha256,
  };
}
