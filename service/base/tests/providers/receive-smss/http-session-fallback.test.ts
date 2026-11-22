import { describe, expect, it } from "vitest";

import { fetchReceiveSmssHtml } from "../../../src/providers/receive_smss/session-helper.js";

describe("Receive-SMSS Web HTTP session fallback", () => {
  it("falls back to anonymous page fetch when the configured login endpoint returns 403", async () => {
    const visitedUrls: string[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      visitedUrls.push(url);
      if (url === "https://receive-smss.com/login/") {
        return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
      }
      return new Response("<html><body>anonymous directory</body></html>", { status: 200 });
    };

    const html = await fetchReceiveSmssHtml(
      "https://receive-smss.com/",
      { scraping: { requestTimeoutMs: 15_000 } } as never,
      { username: "configured-user", password: "configured-password" },
      fetchImpl,
    );

    expect(html).toContain("anonymous directory");
    expect(visitedUrls).toEqual([
      "https://receive-smss.com/login/",
      "https://receive-smss.com/",
    ]);
  });

  it("tries the next header mode when an earlier header profile fails", async () => {
    const headerSnapshots: Array<Record<string, string>> = [];
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      headerSnapshots.push(headers);
      if (headerSnapshots.length === 1) {
        return new Response("Gateway error", { status: 502 });
      }
      return new Response("<html><body>receive-smss directory</body></html>", { status: 200 });
    };

    const html = await fetchReceiveSmssHtml(
      "https://receive-smss.com/",
      { scraping: { requestTimeoutMs: 15_000 } } as never,
      undefined,
      fetchImpl,
    );

    expect(html).toContain("receive-smss directory");
    expect(headerSnapshots).toHaveLength(2);
    expect(headerSnapshots[0]?.["accept-language"]).toBeTruthy();
    expect(headerSnapshots[1]?.["accept-language"]).toBeUndefined();
  });
});
