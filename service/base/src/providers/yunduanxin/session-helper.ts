import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EasySmsRuntimeConfig } from "../../domain/models.js";

const yunDuanXinPythonHelperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "session_helper.py",
);

const yunDuanXinAccessGatePattern =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|captcha|access denied/i;

export function detectYunDuanXinAccessGateHtml(html: string): boolean {
  return yunDuanXinAccessGatePattern.test(String(html ?? ""));
}

export async function fetchYunDuanXinHtml(
  url: string,
  config: EasySmsRuntimeConfig,
): Promise<string> {
  const commandCandidates = process.platform === "win32"
    ? [
        { command: "python", prefix: [] as string[] },
        { command: "python3", prefix: [] as string[] },
        { command: "py", prefix: ["-3"] },
      ]
    : [
        { command: "python3", prefix: [] as string[] },
        { command: "python", prefix: [] as string[] },
      ];

  const args = [
    yunDuanXinPythonHelperPath,
    "--url",
    url,
    "--timeout-seconds",
    String(Math.max(5, Math.ceil(config.scraping.requestTimeoutMs / 1000))),
  ];

  let lastError: Error | undefined;
  for (const candidate of commandCandidates) {
    try {
      const stdout = await new Promise<string>((resolveOutput, reject) => {
        execFile(
          candidate.command,
          [...candidate.prefix, ...args],
          {
            maxBuffer: 16 * 1024 * 1024,
            timeout: config.scraping.requestTimeoutMs,
            windowsHide: true,
          },
          (error, commandStdout, commandStderr) => {
            if (error) {
              const detail = commandStderr?.trim() || commandStdout?.trim() || error.message;
              reject(new Error(detail));
              return;
            }
            resolveOutput(commandStdout);
          },
        );
      });

      if (!stdout.trim()) {
        throw new Error(`yunduanxin helper returned an empty response for ${url}.`);
      }

      return stdout;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const normalized = lastError.message.toLowerCase();
      if (normalized.includes("not found") || normalized.includes("cannot find")) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Python runtime is unavailable for yunduanxin.");
}
