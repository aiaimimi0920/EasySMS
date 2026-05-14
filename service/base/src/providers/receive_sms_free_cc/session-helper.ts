import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EasySmsRuntimeConfig } from "../../domain/models.js";

const receiveSmsFreeCcPythonHelperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "session_helper.py",
);

const receiveSmsFreeCcAccessGatePattern =
  /virtual numbers are required to .*register.*or .*login.*before accessing the content/i;

export interface ReceiveSmsFreeCcLoginPayload {
  mail: string;
  password: string;
}

export interface ReceiveSmsFreeCcAuthConfig {
  email?: string;
  password?: string;
}

export function buildReceiveSmsFreeCcLoginPayload(
  email: string,
  password: string,
): ReceiveSmsFreeCcLoginPayload {
  return {
    mail: String(email).trim(),
    password: createHash("md5").update(String(password), "utf8").digest("hex"),
  };
}

export function isReceiveSmsFreeCcAccessGateHtml(html: string): boolean {
  return receiveSmsFreeCcAccessGatePattern.test(String(html ?? ""));
}

export function resolveReceiveSmsFreeCcAuthConfig(
  config: EasySmsRuntimeConfig,
): ReceiveSmsFreeCcAuthConfig | undefined {
  const email = config.providers.receiveSmsFreeCc.email?.trim();
  const password = config.providers.receiveSmsFreeCc.password?.trim();
  if (!email || !password) {
    return undefined;
  }

  return { email, password };
}

export async function fetchReceiveSmsFreeCcHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: ReceiveSmsFreeCcAuthConfig | undefined,
): Promise<string> {
  const loginPayload = auth?.email && auth?.password
    ? buildReceiveSmsFreeCcLoginPayload(auth.email, auth.password)
    : undefined;
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
    receiveSmsFreeCcPythonHelperPath,
    "--url",
    url,
    "--timeout-seconds",
    String(Math.max(5, Math.ceil(config.scraping.requestTimeoutMs / 1000))),
    ...(loginPayload
      ? [
          "--login-email",
          loginPayload.mail,
          "--login-password-md5",
          loginPayload.password,
        ]
      : []),
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
        throw new Error(`receive_sms_free_cc helper returned an empty response for ${url}.`);
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

  throw lastError ?? new Error("Python runtime is unavailable for receive_sms_free_cc.");
}
