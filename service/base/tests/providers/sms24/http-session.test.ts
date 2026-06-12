import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectSms24AccessGateHtml,
  getSms24ImpersonationProfiles,
} from "../../../src/providers/sms24/session-helper.js";

describe("SMS24 HTTP helper", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("detects challenge HTML", () => {
    expect(detectSms24AccessGateHtml(
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>",
    )).toBe(true);

    expect(detectSms24AccessGateHtml(
      "<dl id=\"sms_msg\"><dt class=\"mt-3\"><div data-created=\"2026-05-13T06:07:08.000000Z\">&nbsp</div></dt></dl>",
    )).toBe(false);
  });

  it("prefers impersonation profiles that are stable in the service container", () => {
    expect(getSms24ImpersonationProfiles()).toEqual([
      "chrome120",
      "chrome136",
      "chrome104",
      "safari17_0",
      "chrome146",
    ]);
  });

  it("tries the next impersonation profile when the helper reports a TLS error", async () => {
    const calls: string[][] = [];
    vi.doMock("node:child_process", () => ({
      execFile: vi.fn((
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        calls.push(args);
        if (calls.length === 1) {
          callback(new Error("helper failed"), "", "curl: (35) TLS connect error");
          return;
        }
        callback(null, "<html><body>sms24 directory</body></html>", "");
      }),
    }));

    const { fetchSms24Html } = await import("../../../src/providers/sms24/session-helper.js");

    const html = await fetchSms24Html("https://sms24.me/en/numbers", {
      scraping: { requestTimeoutMs: 20_000 },
    } as never);

    expect(html).toContain("sms24 directory");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["--impersonate-profile", "chrome120"]));
    expect(calls[1]).toEqual(expect.arrayContaining(["--impersonate-profile", "chrome136"]));
  });
});
