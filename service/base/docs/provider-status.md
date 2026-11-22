# Provider Runtime Status (Cloudflare Workers)

所有 Provider 均在 Cloudflare Workers 内通过纯标准 Web `fetch` + 轻量 `WebCookieJar` 运行，无外部浏览器或本地子进程依赖：

| Provider Key | 类型 | 运行方式 | 说明 |
| --- | --- | --- | --- |
| `hero_sms` | 付费激活 API (`paid`) | HTTPS `fetch` | 支持多策略选路、号码复用、可退款取消窗口与 `activation-catalog` 非扣费健康探测 |
| `onlinesim` | 免费公有池 (`free`) | HTTPS JSON `fetch` | 从 Cloudflare 边缘节点直连 JSON 接口，支持可选 `EASYSMS_ONLINESIM_API_KEY` |
| `sms24` | 免费公有池 (`free`) | HTTPS HTML `fetch` + `cheerio` | 多 User-Agent 退避抓取公有号码与短信列表 |
| `yunduanxin` | 免费公有池 (`free`) | HTTPS HTML `fetch` + `cheerio` | 抓取活跃公有号码并识别 Cloudflare 拦截页 |
| `receive_sms_free_cc` | 免费公有池 (`free`) | Cookie-Jar 登录 + HTML `fetch` | 支持配置邮箱密码自动完成 AJAX 会话登录（纯 TS MD5 摘要） |
| `receive_smss` | 免费公有池 (`free`) | Cookie-Jar 登录 / 匿名回退 | 登录受阻（如 `403`）时自动回退匿名公有目录抓取，若遇验证门禁则标记 `challenge` 冷却 |
| `smstome` | 免费公有池 (`free`) | Cookie-Jar 会话 + HTML `fetch` | 支持按 `limit` 提前终止国家页分页；若上游登录页要求交互式验证码，直接安全失败并进入 `challenge` 冷却 |
