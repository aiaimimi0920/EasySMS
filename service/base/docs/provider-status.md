# Provider Status

This file tracks provider onboarding status for the current `service/base`
runtime. As of `2026-05-13`, provider integration is provider-centric:
`costTier` is metadata, not the architecture boundary.

## Integrated Providers

当前默认启用的 free provider 为 `onlinesim`、`smstome`、`receive_smss`、`receive_sms_free_cc`、`sms24` 与 `yunduanxin`。
其中 `onlinesim` 现在支持 `providers.onlineSim.apiKey`，会优先走官方 apikey
授权的纯 HTTP API 路径（例如 `api/getFreeList` 与
`api/v1/free_numbers_content/countries/*`），而不是依赖被遮罩的网页登录视图。
其中 `receive_smss` 现在通过 curl_cffi 模拟现代浏览器 TLS/session，属于纯 HTTP
provider；如果配置了 `providers.receiveSmss.username/password`，则会先走 `/login/`
表单登录，再在同一 HTTP 会话里抓目录页与短信页，并对号码应用“最近验证码 ≤ 30 分钟”
的活性过滤。
其中 `receive_sms_free_cc` 在默认配置下即参与 runtime registry，但受保护区域要想
稳定读取号码页，仍建议提供 `providers.receiveSmsFreeCc.email/password`，这样它会
通过纯 HTTP 登录链（`/auth/login` + `/ajax/login`）读取号码页，而不是依赖真实浏览器运行时。
其中 `yunduanxin` 现在也已切到 curl_cffi 驱动的纯 HTTP 抓取路径：普通匿名 fetch 会遇到
Cloudflare challenge，但 helper 会以现代浏览器 TLS/session 指纹请求主页和号码页，并且
仅保留“最近验证码 ≤ 30 分钟”的活号。
其中 `smstome` 现在也已切到 curl_cffi 驱动的纯 HTTP 登录路径：站点会在国家页与短信页要求
先登录免费账号，因此 helper 会先访问 `/sign-in`，解析 `_token`、`csrf_v` 与页面上的算术验证码，
再在同一 HTTP session 中抓国家页和短信页；号码同样只保留“最近验证码 ≤ 30 分钟”的活号。

| Provider Key | Cost Tier | Status on 2026-05-13 | Notes |
| --- | --- | --- | --- |
| `onlinesim` | `free` | enabled | 已切到 `free_numbers_content` 国家页接口，并增加“最近验证码 ≤ 20 分钟”活性规则；支持通过 `providers.onlineSim.apiKey` 走官方 apikey 授权的纯 HTTP API；LeetCode 实测已验证西班牙/法国主号可收新验证码 |
| `smstome` | `free` | enabled | 已改造成 curl_cffi 驱动的纯 HTTP 登录增强 provider；helper 会先抓 `/sign-in` 并解页面内算术验证码，再在同一 HTTP session 中读取国家页与号码页；号码额外应用“最近验证码 ≤ 30 分钟”的活性过滤 |
| `receive_smss` | `free` | enabled | 已改造成 curl_cffi 驱动的纯 HTTP provider；若配置 `providers.receiveSmss.username/password` 会先走 `/login/` 表单登录，再抓目录页与短信页；号码额外应用“最近验证码 ≤ 30 分钟”的活性过滤 |
| `receive_sms_free_cc` | `free` | enabled | 已补齐 30 分钟验证码活性规则，并增加纯 HTTP 登录 helper；当前在无浏览器环境下会优先通过 `providers.receiveSmsFreeCc.email/password` 走统一 HTTP 登录链，再读取目标号码页；2026-05-13 已通过隔离 Docker 实例实证 `/sms/public-numbers` + `/sms/inbox` 可用；默认配置现已启用，但受保护区域仍建议配置账号密码 |
| `sms24` | `free` | enabled | 已改造成 curl_cffi 驱动的纯 HTTP provider；目录页与号码页均通过浏览器指纹化 HTTP 抓取，不依赖真实浏览器；号码额外应用“最近验证码 ≤ 30 分钟”的活性过滤 |
| `yunduanxin` | `free` | enabled | 已改造成 curl_cffi 驱动的纯 HTTP provider；主页与号码页通过浏览器指纹化 HTTP 抓取，不依赖真实浏览器；号码额外应用“最近验证码 ≤ 30 分钟”的活性过滤 |
| `hero_sms` | `paid` | enabled | 已接入统一 provider catalog、generic activation API 和 `handler_api.php` 兼容外观；现在支持策略化选号（`price-first` / `success-first` / `stock-first` / `balanced`）、租期内号码复用（按 `businessKey` + `maxBindingsPerPhone` 控制），并暴露 2 分钟后可退款取消的元数据；2026-05-13 已用真实 `apiKey` 完成 live create + 125 秒后 cancel smoke |

## Researched But Not Integrated

| Provider Key | Status on 2026-05-13 | Notes |
| --- | --- | --- |
| `receivesms.org` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `smsreceivefree.com` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `freephonenum` | removed | 已列入根级 `/docs/unusable-providers.md`，不再重新接回 |
| `quackr` | removed | 已列入根级 `/docs/unusable-providers.md`，不再重新接回 |
| `temporary_phone_number` | removed | 已列入根级 `/docs/unusable-providers.md`，不再重新接回 |
| `temp_number` | removed | 已列入根级 `/docs/unusable-providers.md`；公共免费号池虽可人工浏览器访问，但当前没有稳定的纯 HTTP 路径满足 `service/base` 主标准 |
| `receivesms_co` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `jiemahao` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定因 challenge/gate 不可用，不再重新接回 |
| `oksms.org` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `receive-sms-online.info` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `smscodeonline.com` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `receivefreesms.net` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `receive-sms.com` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `tempsmsonline.com` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |
| `disposablesms.com` | removed | 已列入根级 `/docs/unusable-providers.md`；人工验证已判定不可用，不再重新接回 |

## Current Gaps

- Activation-capable paid providers currently have one real implementation:
  `hero_sms`; it now carries paid-only strategy/reuse logic that is not applied to free public-inbox providers.
- Public-number health/probe state is richer than paid-provider operational
  state; `hero_sms` is exposed in `/providers` but does not yet participate in
  the same scrape-route probe model.
- The synthetic activation facade now also projects free metadata for
  compatibility actions such as `getCountries`, `getPrices`, and
  `getOperators`, but that projection is sampled from live public-number
  directories rather than backed by a true upstream pricing API.
