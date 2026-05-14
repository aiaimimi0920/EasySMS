import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const assets = [
  {
    source: resolve(repoRoot, "src/providers/receive_sms_free_cc/session_helper.py"),
    target: resolve(repoRoot, "dist/src/providers/receive_sms_free_cc/session_helper.py"),
  },
  {
    source: resolve(repoRoot, "src/providers/receive_smss/session_helper.py"),
    target: resolve(repoRoot, "dist/src/providers/receive_smss/session_helper.py"),
  },
  {
    source: resolve(repoRoot, "src/providers/sms24/session_helper.py"),
    target: resolve(repoRoot, "dist/src/providers/sms24/session_helper.py"),
  },
  {
    source: resolve(repoRoot, "src/providers/smstome/session_helper.py"),
    target: resolve(repoRoot, "dist/src/providers/smstome/session_helper.py"),
  },
  {
    source: resolve(repoRoot, "src/providers/yunduanxin/session_helper.py"),
    target: resolve(repoRoot, "dist/src/providers/yunduanxin/session_helper.py"),
  },
];

for (const asset of assets) {
  if (!existsSync(asset.source)) {
    throw new Error(`Runtime asset is missing: ${asset.source}`);
  }

  mkdirSync(dirname(asset.target), { recursive: true });
  cpSync(asset.source, asset.target);
}
