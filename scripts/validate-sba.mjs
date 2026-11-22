import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(scriptDir, "..");

const IDENTIFIER_RE = /^[a-z][a-z0-9-]{1,62}$/;
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const SECRET_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const RESERVED_ENV_RE = /^(?:GITHUB_|ACTIONS_|RUNNER_|SBA_|GIT_|NODE_|NPM_|PYTHON|DOTNET_)|^(?:PATH|PATHEXT|COMSPEC|SYSTEMROOT|SYSTEMDRIVE|WINDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|COMMONPROGRAMFILES|TEMP|TMP|TMPDIR|CI|LANG|LC_ALL|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|PSMODULEPATH|ENV|BASH_ENV)$/;
const FORBIDDEN_PUBLIC_KEY_RE = /token|password|secret|credential|privatekey|apikey|accesskey|authorization|connectionstring/i;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`SBA validation failed: ${message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(obj, required, optional = [], label = "object") {
  assert(isPlainObject(obj), `${label} must be a plain object`);
  for (const key of required) {
    assert(Object.hasOwn(obj, key), `${label} missing required key '${key}'`);
  }
  for (const key of Object.keys(obj)) {
    assert(required.includes(key) || optional.includes(key), `${label} has unexpected key '${key}'`);
  }
}

function validatePublicValue(value, depth = 0) {
  assert(depth <= 8, "public value exceeds max depth 8");
  if (Array.isArray(value)) {
    assert(value.length <= 100, "public array exceeds max length 100");
    for (const item of value) {
      validatePublicValue(item, depth + 1);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      assert(KEY_RE.test(k) && !["__proto__", "prototype", "constructor"].includes(k), `invalid public key '${k}'`);
      assert(!FORBIDDEN_PUBLIC_KEY_RE.test(k.replaceAll("_", "")), `public key '${k}' contains sensitive keyword`);
      validatePublicValue(v, depth + 1);
    }
    return;
  }
  assert(
    value === null
      || typeof value === "boolean"
      || (typeof value === "number" && Number.isFinite(value))
      || (typeof value === "string" && value.length <= 8192),
    "invalid primitive in public defaults",
  );
}

export async function validateEasySmsSba(directory = repoRoot) {
  const manifest = JSON.parse(await readFile(resolve(directory, ".sba/manifest.json"), "utf8"));
  const declaration = JSON.parse(await readFile(resolve(directory, ".sba/deployment.json"), "utf8"));

  assertExactKeys(
    manifest,
    ["schemaVersion", "id", "name", "version", "entrypoint", "runtime", "actions", "secrets"],
    ["repairs"],
    "manifest",
  );
  assert(manifest.schemaVersion === 3, "manifest.schemaVersion must be 3");
  assert(IDENTIFIER_RE.test(manifest.id), "manifest.id invalid");
  assert(typeof manifest.name === "string" && manifest.name.trim().length > 0 && manifest.name.length <= 100, "manifest.name invalid");
  assert(VERSION_RE.test(manifest.version), "manifest.version must be stable x.y.z");
  assert(/^[a-zA-Z0-9_-]+\.(?:ps1|mjs)$/.test(manifest.entrypoint), "manifest.entrypoint invalid");

  assertExactKeys(manifest.runtime, ["runner", "powershell", "python", "node"], [], "manifest.runtime");
  const validLinux = manifest.runtime.runner === "ubuntu-24.04"
    && manifest.runtime.powershell === "7.6.9"
    && manifest.runtime.python === "3.12"
    && manifest.runtime.node === "22";
  const validWindows = manifest.runtime.runner === "windows-2025"
    && manifest.runtime.powershell === "5.1"
    && manifest.runtime.python === "3.12"
    && manifest.runtime.node === "22";
  assert(validLinux || validWindows, "manifest.runtime must match an exact SpringBok runtime tuple");

  const requiredActions = ["deploy", "update", "verify", "preview", "destroy-preview"];
  assertExactKeys(manifest.actions, requiredActions, ["repair"], "manifest.actions");
  for (const action of Object.keys(manifest.actions)) {
    assertExactKeys(manifest.actions[action], ["timeoutSeconds"], [], `manifest.actions.${action}`);
    const t = manifest.actions[action].timeoutSeconds;
    assert(Number.isInteger(t) && t >= 1 && t <= 3600, `invalid timeoutSeconds for ${action}`);
  }

  assert(Array.isArray(manifest.secrets) && manifest.secrets.length > 0 && manifest.secrets.length <= 20, "manifest.secrets invalid");
  assert(new Set(manifest.secrets).size === manifest.secrets.length, "manifest.secrets must be unique");
  for (const secret of manifest.secrets) {
    assert(SECRET_RE.test(secret) && !RESERVED_ENV_RE.test(secret), `invalid or reserved secret '${secret}'`);
  }

  assertExactKeys(
    declaration,
    ["schemaVersion", "target", "accountPath", "accountMode", "accounts", "defaults", "fields", "resources", "targets"],
    ["administrator", "github", "applicationSecrets"],
    "deployment",
  );
  assert(declaration.schemaVersion === 2, "deployment.schemaVersion must be 2");
  assert(declaration.target === "cloudflare-workers", "deployment.target must be cloudflare-workers");
  assert(declaration.accountMode === "single" && Array.isArray(declaration.accounts) && declaration.accounts.length === 1, "single account required");
  validatePublicValue(declaration.defaults);

  const declaredSecrets = [
    ...declaration.accounts.map((a) => a.secret),
    ...(declaration.administrator ? [declaration.administrator.secret] : []),
    ...(declaration.github ? [declaration.github.secret] : []),
    ...(declaration.applicationSecrets ?? []),
  ];
  assert(
    JSON.stringify([...declaredSecrets].sort()) === JSON.stringify([...manifest.secrets].sort()),
    "deployment secrets and manifest.secrets must match exactly",
  );

  const paths = [
    ...declaration.accounts.map((a) => a.path),
    ...declaration.fields.map((f) => f.path),
    ...declaration.resources.flatMap((r) => (r.namePath ? [r.idPath, r.namePath] : [r.idPath])),
  ];
  const dotted = paths.map((p) => p.join("."));
  for (let i = 0; i < dotted.length; i += 1) {
    for (let j = 0; j < dotted.length; j += 1) {
      if (i !== j) {
        assert(
          dotted[i] !== dotted[j]
            && !dotted[i].startsWith(`${dotted[j]}.`)
            && !dotted[j].startsWith(`${dotted[i]}.`),
          `overlapping paths '${dotted[i]}' and '${dotted[j]}'`,
        );
      }
    }
  }

  for (const target of declaration.targets) {
    const field = declaration.fields.find((f) => f.path.join(".") === target.path.join("."));
    assert(field && field.type === "text" && field.required === true, `target '${target.kind}' must reference required text field`);
    assert(typeof field.template === "string" && field.template.includes("{instance}"), `target field '${field.path.join(".")}' must include {instance} for preview isolation`);
  }

  const sbaReal = await realpath(resolve(directory, ".sba"));
  const entryPath = resolve(sbaReal, manifest.entrypoint);
  const entryStat = await lstat(entryPath);
  const rel = relative(sbaReal, await realpath(entryPath));
  assert(
    entryStat.isFile() && !entryStat.isSymbolicLink() && !rel.startsWith("..") && !isAbsolute(rel),
    "entrypoint must be a regular file inside .sba",
  );

  return {
    application: manifest.id,
    version: manifest.version,
    manifestSchema: manifest.schemaVersion,
    deploymentSchema: declaration.schemaVersion,
    target: declaration.target,
    secretCount: manifest.secrets.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = await validateEasySmsSba(process.argv[2] ? resolve(process.argv[2]) : repoRoot);
  console.log(JSON.stringify(summary));
}
