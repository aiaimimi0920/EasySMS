import { describe, expect, it } from "vitest";

import {
  buildReceiveSmsFreeCcLoginPayload,
  isReceiveSmsFreeCcAccessGateHtml,
} from "../../../src/providers/receive_sms_free_cc/session-helper.js";

describe("Receive-SMS-Free.cc HTTP session helper", () => {
  it("builds the ajax login payload with the md5-hashed password expected by the site", () => {
    expect(buildReceiveSmsFreeCcLoginPayload("vmjcv666@gmail.com", "Qq365210!@#$%^")).toEqual({
      mail: "vmjcv666@gmail.com",
      password: "c9c25f04839766d074fcfa35bf6c383b",
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
});
