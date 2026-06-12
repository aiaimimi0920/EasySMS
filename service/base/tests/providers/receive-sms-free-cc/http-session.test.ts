import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildReceiveSmsFreeCcLoginPayload,
  getReceiveSmsFreeCcImpersonationProfiles,
  isReceiveSmsFreeCcAccessGateHtml,
} from "../../../src/providers/receive_sms_free_cc/session-helper.js";

describe("Receive-SMS-Free.cc HTTP session helper", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("builds the ajax login payload with the md5-hashed password expected by the site", () => {
    expect(buildReceiveSmsFreeCcLoginPayload("user@example.test", "example-password")).toEqual({
      mail: "user@example.test",
      password: "cc4436eff149ba9761aaac07b36360ea",
    });
  });

  it("detects the HTML access gate used when SMS content is not available", () => {
    expect(isReceiveSmsFreeCcAccessGateHtml(
      "<p>Unfortunately, Due To Security Concerns, Virtual Numbers Are Required To register Or login In Before Accessing The Content.</p>",
    )).toBe(true);

    expect(isReceiveSmsFreeCcAccessGateHtml(
      "<div class=\"sms-item\"><p class=\"sms-content\">[LeetCode力扣]您的注册验证码为：601210，该验证码 5 分钟内有效，请勿泄漏于他人。</p></div>",
    )).toBe(false);
  });

  it("prefers impersonation profiles that avoid curl_cffi TLS regressions", () => {
    expect(getReceiveSmsFreeCcImpersonationProfiles()).toEqual([
      "chrome136",
      "chrome123",
      "chrome107",
      "chrome99",
      "safari17_0",
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
        callback(null, "<html><body>receive-sms-free directory</body></html>", "");
      }),
    }));

    const { fetchReceiveSmsFreeCcHtml } = await import("../../../src/providers/receive_sms_free_cc/session-helper.js");

    const html = await fetchReceiveSmsFreeCcHtml(
      "https://receive-sms-free.cc/regions/",
      { scraping: { requestTimeoutMs: 30_000 } } as never,
      undefined,
    );

    expect(html).toContain("receive-sms-free directory");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["--impersonate-profile", "chrome136"]));
    expect(calls[1]).toEqual(expect.arrayContaining(["--impersonate-profile", "chrome123"]));
  });
});
