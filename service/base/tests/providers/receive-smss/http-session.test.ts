import { describe, expect, it } from "vitest";

import {
  buildReceiveSmssLoginPayload,
  detectReceiveSmssAccessGateHtml,
  getReceiveSmssHeaderModes,
} from "../../../src/providers/receive_smss/session-helper.js";

describe("Receive-SMSS Web HTTP session helper", () => {
  it("builds the login payload expected by the site", () => {
    expect(buildReceiveSmssLoginPayload("demo-user", "demo-pass")).toEqual({
      log: "demo-user",
      pwd: "demo-pass",
      redirect_to: "/",
      instance: "",
      action: "login",
    });
  });

  it("detects Cloudflare access-gate HTML", () => {
    expect(detectReceiveSmssAccessGateHtml(
      "<html><head><title>Just a moment...</title></head><body>正在进行安全验证</body></html>",
    )).toBe(true);

    expect(detectReceiveSmssAccessGateHtml(
      "<article class=\"msg-card msg-card--otp\"><div class=\"msg-body\">Your DENT code is: 842711</div></article>",
    )).toBe(false);
  });

  it("orders header modes from full headers down to legacy fallback", () => {
    expect(getReceiveSmssHeaderModes()).toEqual([
      "full-no-ua",
      "no-headers",
      "accept-only",
      "legacy",
    ]);
  });
});
