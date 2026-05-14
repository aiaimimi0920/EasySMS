import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EasySmsRuntimeConfig } from "../../domain/models.js";

const smsToMePythonHelperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "session_helper.py",
);

const smsToMeImpersonationProfiles = [
  "chrome101",
  "edge101",
  "chrome99",
  "chrome136",
] as const;

const smsToMeAccessGatePattern =
  /please log in to view messages for this number|require a free account to access/i;

export interface SmsToMeAuthConfig {
  email?: string;
  password?: string;
}

export interface SmsToMeLoginChallenge {
  csrfToken: string;
  csrfV: string;
  captchaPrompt: string;
  captchaAnswer: string;
}

export function isSmsToMeAccessGateHtml(html: string): boolean {
  return smsToMeAccessGatePattern.test(String(html ?? ""));
}

export function getSmsToMeImpersonationProfiles(): string[] {
  return [...smsToMeImpersonationProfiles];
}

export function resolveSmsToMeAuthConfig(
  config: EasySmsRuntimeConfig,
): SmsToMeAuthConfig | undefined {
  const email = config.providers.smsToMe.email?.trim();
  const password = config.providers.smsToMe.password?.trim();
  if (!email || !password) {
    return undefined;
  }

  return { email, password };
}

export function extractSmsToMeLoginChallenge(html: string): SmsToMeLoginChallenge {
  const csrfToken = html.match(/name="_token"\s+value="([^"]+)"/i)?.[1]?.trim();
  const csrfV = html.match(/name="csrf_v"\s+value="([^"]+)"/i)?.[1]?.trim();
  const captchaPrompt = html.match(/What is\s+\d+\s*[+\-]\s*\d+\?/i)?.[0]?.trim();

  if (!csrfToken || !csrfV || !captchaPrompt) {
    throw new Error("smstome login challenge is missing expected form fields.");
  }

  const numbers = Array.from(captchaPrompt.matchAll(/\d+/g), (match) => Number.parseInt(match[0], 10));
  if (numbers.length < 2 || numbers.some((value) => !Number.isFinite(value))) {
    throw new Error(`Unable to parse smstome captcha challenge: ${captchaPrompt}`);
  }

  const captchaAnswer = captchaPrompt.includes("-")
    ? String(numbers[0] - numbers[1])
    : String(numbers[0] + numbers[1]);

  return {
    csrfToken,
    csrfV,
    captchaPrompt,
    captchaAnswer,
  };
}

export async function fetchSmsToMeHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: SmsToMeAuthConfig | undefined,
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
    smsToMePythonHelperPath,
    "--url",
    url,
    "--timeout-seconds",
    String(Math.max(5, Math.ceil(config.scraping.requestTimeoutMs / 1000))),
    ...getSmsToMeImpersonationProfiles().flatMap((profile) => [
      "--impersonate-profile",
      profile,
    ]),
    ...(auth?.email && auth?.password
      ? [
          "--login-email",
          auth.email,
          "--login-password",
          auth.password,
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
        throw new Error(`smstome helper returned an empty response for ${url}.`);
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

  throw lastError ?? new Error("Python runtime is unavailable for smstome.");
}
