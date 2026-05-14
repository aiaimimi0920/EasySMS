import { describe, expect, it } from "vitest";

import { detectSms24AccessGateHtml } from "../../../src/providers/sms24/session-helper.js";

describe("SMS24 HTTP helper", () => {
  it("detects challenge HTML", () => {
    expect(detectSms24AccessGateHtml(
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>",
    )).toBe(true);

    expect(detectSms24AccessGateHtml(
      "<dl id=\"sms_msg\"><dt class=\"mt-3\"><div data-created=\"2026-05-13T06:07:08.000000Z\">&nbsp</div></dt></dl>",
    )).toBe(false);
  });
});
