import { describe, expect, it } from "vitest";

import {
  buildReceiveSmssLoginPayload,
  detectReceiveSmssAccessGateHtml,
  getReceiveSmssHeaderModes,
  getReceiveSmssImpersonationProfiles,
} from "../../../src/providers/receive_smss/session-helper.js";

describe("Receive-SMSS HTTP session helper", () => {
  it("builds the login payload expected by the site", () => {
    expect(buildReceiveSmssLoginPayload("vmjcv666", "Qq365210!@#$%^")).toEqual({
      log: "vmjcv666",
      pwd: "Qq365210!@#$%^",
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

  it("prefers profiles that can still retrieve the public directory", () => {
    expect(getReceiveSmssImpersonationProfiles()).toEqual([
      "chrome123",
      "chrome124",
      "chrome146",
      "chrome120",
    ]);
  });

  it("prefers header modes that do not override curl_cffi's browser user agent", () => {
    expect(getReceiveSmssHeaderModes()).toEqual([
      "full-no-ua",
      "no-headers",
      "accept-only",
      "legacy",
    ]);
  });
});
