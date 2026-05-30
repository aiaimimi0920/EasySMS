import { afterEach, describe, expect, it, vi } from "vitest";

describe("Receive-SMSS HTTP session fallback", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("falls back to anonymous page fetch when the configured login path is forbidden", async () => {
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
          callback(new Error("helper failed"), "", "HTTP Error 403:");
          return;
        }
        callback(null, "<html><body>anonymous directory</body></html>", "");
      }),
    }));

    const { fetchReceiveSmssHtml } = await import("../../../src/providers/receive_smss/session-helper.js");

    const html = await fetchReceiveSmssHtml(
      "https://receive-smss.com/",
      {
        scraping: {
          requestTimeoutMs: 15_000,
        },
      } as never,
      { username: "configured-user", password: "configured-password" },
    );

    expect(html).toContain("anonymous directory");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--login-username");
    expect(calls[1]).not.toContain("--login-username");
    expect(calls[1]).not.toContain("--login-password");
  });
});
