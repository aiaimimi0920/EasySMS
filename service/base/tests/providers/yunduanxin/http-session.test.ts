import { describe, expect, it } from "vitest";

import { detectYunDuanXinAccessGateHtml } from "../../../src/providers/yunduanxin/session-helper.js";

describe("YunDuanXin HTTP session helper", () => {
  it("detects real browser challenge pages", () => {
    expect(detectYunDuanXinAccessGateHtml(
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>",
    )).toBe(true);
  });

  it("does not treat normal inbox pages as gate pages just because static assets mention captcha or Cloudflare", () => {
    expect(detectYunDuanXinAccessGateHtml(`
      <!DOCTYPE html>
      <html lang="zh-CN">
        <head>
          <title>荷兰电话号码 +3197010518998,在线接收短信验证码 - 云短信</title>
          <script src="/assets/cloudflare-helper.js"></script>
          <script>const captchaLabel = "captcha";</script>
        </head>
        <body>
          <div class="row border-bottom table-hover">
            <div class="col-xs-12 col-md-2"><div class="mobile_hide">OpenAI</div></div>
            <div class="col-xs-0 col-md-2 mobile_hide">34秒前</div>
            <div class="col-xs-12 col-md-8">Your verification code is 123456.</div>
          </div>
        </body>
      </html>
    `)).toBe(false);
  });
});
