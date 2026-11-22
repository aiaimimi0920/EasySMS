import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serviceBaseRoot = resolve(scriptDir, "..");

function parseOutfileArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--outfile" && argv[index + 1]) {
      return resolve(argv[index + 1]);
    }
  }
  return resolve(serviceBaseRoot, "dist/worker.mjs");
}

export async function buildEasySmsWorkerBundle(outfile = parseOutfileArg(process.argv.slice(2))) {
  mkdirSync(dirname(outfile), { recursive: true });

  await build({
    entryPoints: [resolve(serviceBaseRoot, "src/worker/index.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["worker", "browser", "module", "main"],
    conditions: ["workerd", "worker", "browser", "import"],
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "silent",
  });

  const sizeBytes = statSync(outfile).size;
  if (sizeBytes <= 0 || sizeBytes > 3 * 1024 * 1024) {
    throw new Error(`Worker bundle size out of bounds (${sizeBytes} bytes): ${outfile}`);
  }

  const content = readFileSync(outfile, "utf8");
  if (/\bfrom\s*["']node:|\brequire\(\s*["']node:/.test(content)) {
    throw new Error(`Worker bundle contains forbidden node: runtime imports: ${outfile}`);
  }

  return { outfile, sizeBytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const info = await buildEasySmsWorkerBundle();
  console.log(`Built Cloudflare Worker bundle: ${info.outfile} (${info.sizeBytes} bytes)`);
}
