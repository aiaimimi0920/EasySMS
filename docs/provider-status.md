# Provider Status

| Provider Key | Status on 2026-04-05 | Notes |
| --- | --- | --- |
| `freephonenum` | implemented | 主页和号码页都是可直接抓取的 server-rendered HTML |
| `jiemahao` | implemented | 国家页 `/us/`、`/gb/` 等可直接列出公开号码；`/sms/?phone=...` 当前需要 Turnstile + 提交表单 |
| `onlinesim` | implemented | 已切到 `free_numbers_content` 国家页接口，可按国家列出多个号码；公开 inbox 当前只稳定暴露国家页主号码 |
| `quackr` | implemented | 使用 `numbers.json` 公开列表；`/api/messages/:number` 和浏览器渲染号码页在 2026-04-05 都会命中 verification / login gate |
| `receivesms_co` | implemented | `receivesms.co` 的目录页和号码页在 2026-04-05 可通过常规 HTML 抓取直接读取 |
| `receive_smss` | implemented | `receive-smss.com` 的首页和号码页在 2026-04-05 可通过原生浏览器 UA 的 DOM 渲染读取；自定义抓取 UA / 裸 HTTP 更容易命中 Cloudflare |
| `temp_number` | implemented | `/temporary-numbers` 和 `/countries/{slug}` 都是可解析 HTML；详情页短信列表为 `.msg-card` |
| `temporary_phone_number` | implemented | 裸 `fetch` 会 403，已改成 browser headers + `curl` fallback 后可抓 |
| `receive_sms_free_cc` | implemented | 列表和短信页可抓，但站点模板与 `temporary_phone_number` 略有差异 |
| `yunduanxin` | implemented | 号码卡片和短信列表都能直接从 HTML 解析 |
| `sms24` | implemented | 号码列表与短信详情可抓，部分号码页会显示“暂无短信” |
| `smstome` | blocked | 首页和国家页可达，但匿名浏览器渲染号码页在 2026-04-05 会落到 Cloudflare 错误页 |
| `receivesms.org` | empty | `active-numbers` 页面当前直接显示没有可用号码 |
| `smsreceivefree.com` | blocked | `curl` TLS 握手失败；匿名浏览器请求在 2026-04-05 会落到 `ERR_CONNECTION_CLOSED` |
| `oksms.org` | blocked | 命中 Cloudflare challenge |
| `tempsmsonline.com` | researching | 目录页可达，但已检查的号码页在 2026-04-05 主要只暴露前端壳页面 |
| `disposablesms.com` | out-of-scope | 主页号码当前为 `XXXX` 打码展示，不符合公开号码聚合的接入标准 |
| `hero-sms` | out-of-scope | 收费注册服务，不属于当前 free aggregator 首批接入 |
