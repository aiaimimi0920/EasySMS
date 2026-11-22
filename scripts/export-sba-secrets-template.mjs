import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(scriptDir, "..");

const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, ".tmp/derived/sba-application-secrets.template.json");

const declaration = JSON.parse(await readFile(resolve(repoRoot, ".sba/deployment.json"), "utf8"));
const requiredSet = new Set(["EASYSMS_API_KEY", "EASYSMS_BACKUP_PASSPHRASE"]);

const template = Object.fromEntries(
  (declaration.applicationSecrets ?? []).map((name) => [
    name,
    requiredSet.has(name) ? `replace-with-${name.toLowerCase().replaceAll("_", "-")}` : "disabled",
  ]),
);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(template, null, 2) + "\n", "utf8");
console.log(`Wrote SpringBok applicationSecrets JSON template: ${outPath}`);
