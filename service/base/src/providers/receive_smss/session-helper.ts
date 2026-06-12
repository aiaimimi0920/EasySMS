import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EasySmsRuntimeConfig } from "../../domain/models.js";

const receiveSmssPythonHelperPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "session_helper.py",
);

const receiveSmssAccessGatePattern =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|正在进行安全验证/i;

const receiveSmssImpersonationProfiles = [
  "chrome123",
  "chrome124",
  "chrome146",
  "chrome120",
] as const;

const receiveSmssHeaderModes = [
  "full-no-ua",
  "no-headers",
  "accept-only",
  "legacy",
] as const;

export interface ReceiveSmssAuthConfig {
  username?: string;
  password?: string;
}

export interface ReceiveSmssLoginPayload {
  log: string;
  pwd: string;
  redirect_to: string;
  instance: string;
  action: "login";
}

export function buildReceiveSmssLoginPayload(
  username: string,
  password: string,
): ReceiveSmssLoginPayload {
  return {
    log: String(username).trim(),
    pwd: String(password),
    redirect_to: "/",
    instance: "",
    action: "login",
  };
}

export function detectReceiveSmssAccessGateHtml(html: string): boolean {
  return receiveSmssAccessGatePattern.test(String(html ?? ""));
}

export function getReceiveSmssImpersonationProfiles(): string[] {
  return [...receiveSmssImpersonationProfiles];
}

export function getReceiveSmssHeaderModes(): string[] {
  return [...receiveSmssHeaderModes];
}

export function resolveReceiveSmssAuthConfig(
  config: EasySmsRuntimeConfig,
): ReceiveSmssAuthConfig | undefined {
  const username = config.providers.receiveSmss.username?.trim();
  const password = config.providers.receiveSmss.password?.trim();
  if (!username || !password) {
    return undefined;
  }

  return { username, password };
}

function isCommandMissingError(error: Error): boolean {
  const normalized = error.message.toLowerCase();
  return normalized.includes("not found") || normalized.includes("cannot find");
}

function shouldRetryReceiveSmssAnonymously(error: Error): boolean {
  const normalized = error.message.toLowerCase();
  return normalized.includes("http error 403")
    || normalized.includes("forbidden")
    || normalized.includes("login did not establish")
    || normalized.includes("just a moment")
    || normalized.includes("cloudflare");
}

export async function fetchReceiveSmssHtml(
  url: string,
  config: EasySmsRuntimeConfig,
  auth: ReceiveSmssAuthConfig | undefined,
): Promise<string> {
  const loginPayload = auth?.username && auth?.password
    ? buildReceiveSmssLoginPayload(auth.username, auth.password)
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

  const buildArgs = (
    payload: ReceiveSmssLoginPayload | undefined,
    profile: string,
    headerMode: string,
  ): string[] => [
    receiveSmssPythonHelperPath,
    "--url",
    url,
    "--timeout-seconds",
    String(Math.max(5, Math.ceil(config.scraping.requestTimeoutMs / 1000))),
    "--impersonate-profile",
    profile,
    "--header-mode",
    headerMode,
    ...(payload
      ? [
          "--login-username",
          payload.log,
          "--login-password",
          payload.pwd,
        ]
      : []),
  ];

  const runHelper = async (command: string, prefix: string[], args: string[]): Promise<string> => {
    const stdout = await new Promise<string>((resolveOutput, reject) => {
      execFile(
        command,
        [...prefix, ...args],
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
      throw new Error(`receive_smss helper returned an empty response for ${url}.`);
    }

    return stdout;
  };

  let lastError: Error | undefined;
  for (const candidate of commandCandidates) {
    let commandMissing = false;
    for (const profile of getReceiveSmssImpersonationProfiles()) {
      for (const headerMode of getReceiveSmssHeaderModes()) {
        try {
          return await runHelper(candidate.command, candidate.prefix, buildArgs(loginPayload, profile, headerMode));
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (isCommandMissingError(lastError)) {
            commandMissing = true;
            break;
          }
          if (loginPayload && shouldRetryReceiveSmssAnonymously(lastError)) {
            try {
              return await runHelper(candidate.command, candidate.prefix, buildArgs(undefined, profile, headerMode));
            } catch (anonymousError) {
              lastError = anonymousError instanceof Error ? anonymousError : new Error(String(anonymousError));
              if (isCommandMissingError(lastError)) {
                commandMissing = true;
                break;
              }
            }
          }
        }
      }
      if (commandMissing) {
        break;
      }
    }
    if (!commandMissing) {
      throw lastError;
    }
  }

  throw lastError ?? new Error("Python runtime is unavailable for receive_smss.");
}
