# EasySMS

`EasySMS` 是 `EasySms` monorepo 中 `service/base` 的免费公共短信聚合服务，统一对外暴露 HTTP API，把多个公开接码网站抽象成同一套号码列表与短信收件箱接口。

当前版本已包含：

- 文件驱动运行时契约
- 多站点 HTML / 公共 JSON API provider
- 可选 paid provider `HeroSMS` API 能力
- 浏览器风格请求头 + `curl` 回退抓取链路
- 可选本机浏览器 `--dump-dom` 渲染回退，用于识别前端渲染 / gate 页面
- provider 健康检查、冷却/熔断、临时禁用与状态快照
- session-first native one-stop API
- HTTP health / provider catalog / provider health / public number / inbox / admin 控制接口
- free provider synthetic activation facade
- `GET /openapi.json` 机器可读接口契约
- Docker 部署骨架
- TypeScript + Vitest 开发基线

技术栈总览见：

- `C:\Users\Public\nas_home\AI\GameEditor\EasySms\docs\tech-stack.md`

canonical package location：

- `C:\Users\Public\nas_home\AI\GameEditor\EasySms\service\base`

---

## Runtime Contract（文件驱动）

运行时配置采用固定文件契约：

- canonical runtime config：`/etc/easy-sms/config.yaml`
- canonical state dir：`/var/lib/easy-sms`

`config.yaml` 顶层结构固定为：

- `server`
- `strategy`
- `maintenance`
- `persistence`
- `scraping`
- `providers`

容器环境变量只保留最小三项：

- `EASY_SMS_CONFIG_PATH`
- `EASY_SMS_STATE_DIR`
- `EASY_SMS_RESET_STORE_ON_BOOT`

---

## 仓内结构

- `src/domain/`：领域模型、错误与 provider / inbox 数据结构
- `src/defaults/`：默认运行时配置
- `src/providers/`：provider adapters（当前正式 runtime-registered 的 free provider 默认包含 `onlinesim`、`smstome`、`receive_smss`、`receive_sms_free_cc`、`sms24` 与 `yunduanxin`）
- `src/service/`：`EasySmsService` 与服务编排
- `src/service/provider-operational-state.ts`：provider 健康状态、路由冷却、临时禁用与失败分类
- `src/http/`：统一 HTTP contracts 与 server
- `src/runtime/`：YAML config 解析、维护循环与持久化循环
- `src/persistence/`：运行时状态快照读写
- `src/shared/`：仓内共享 helpers
- `tests/`：单元测试

入口：

- `src/index.ts`
- `src/runtime/main.ts`
- `index.ts`

---

## Deploy / Docker 资产位置

monorepo 部署资产位于：

- `C:\Users\Public\nas_home\AI\GameEditor\EasySms\deploy\service\base`

---

## 本地验证

在仓库根目录执行：

```powershell
npm install
npm run typecheck
npm run test
npm run build
```

如果你已经在根级 `config.yaml` 中启用了 `HeroSMS`，可在仓库根目录额外执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-hero-sms-provider.ps1
```

## Health / Cooling

`EasySMS` 现在会持续维护 provider 运行状态：

- 自动探测每个 provider 当前是“可抓 / challenge / 空站 / blocked / degraded”
- 对 challenge、连接异常、通用失败分别应用不同的 penalty 与 cooldown
- 支持按路由维度冷却：
  - `list-public-numbers` 的 provider 级或 country 级路由
  - `read-public-inbox` 的 provider 级或 country 级路由
- 支持 provider 级临时禁用
- 支持把运行时状态快照持久化到 `persistence.filePath`

当前管理接口：

- `GET /sms/query/providers/health`
- `GET /sms/query/providers/probe-history`
- `GET /sms/query/providers/selection-plan`
- `GET /providers/health`
- `GET /providers/selection-plan`
- `GET /providers/probe-history`
- `POST /providers/probe`
- `POST /admin/providers/{providerKey}/probe`
- `POST /admin/providers/{providerKey}/disable`
- `POST /admin/providers/{providerKey}/enable`
- `POST /admin/providers/{providerKey}/reset`

当前 provider catalog / paid provider 相关接口：

- `GET /sms/catalog`
- `GET /sms/snapshot`
- `POST /sms/sessions/plan`
- `POST /sms/sessions/open`
- `POST /sms/sessions/recover-by-phone`
- `POST /sms/sessions/report-outcome`
- `POST /sms/messages/observe`
- `GET /sms/sessions/{sessionId}/status`
- `GET /sms/sessions/{sessionId}/code`
- `GET /sms/sessions/{sessionId}/messages`
- `POST /sms/sessions/{sessionId}/actions`
- `GET /providers?costTier=free|paid&capability=<capability>`
- `GET /providers/hero_sms/countries`
- `GET /providers/hero_sms/top-countries`
- `GET /providers/hero_sms/operators?country=<id>&service=<service>`
- `POST /sms/activations`
- `GET /sms/activations/{activationId}/status`
- `POST /sms/activations/{activationId}/actions`
- `GET /sms/query/providers`
- `GET /sms/query/runtime`
- `GET /sms/query/providers/health`
- `GET /sms/query/providers/probe-history`
- `GET /sms/query/providers/selection-plan`
- `GET /sms/query/sessions`
- `GET /sms/query/sessions/{sessionId}`
- `GET /sms/query/messages`
- `GET /sms/query/messages/{messageId}`
- `GET /sms/query/stats`
- `GET /sms/providers/probe-all`
- `GET /sms/providers/{providerKey}/probe`
- `POST /sms/maintenance/run`
- `GET /openapi.json`

当前兼容外观接口：

- `GET /stubs/handler_api.php?action=getCountries`
- `GET /stubs/handler_api.php?action=getPrices&service=<service>`
- `GET /stubs/handler_api.php?action=getTopCountriesByService&service=<service>`
- `GET /stubs/handler_api.php?action=getTopCountriesByServiceRank&service=<service>`
- `GET /stubs/handler_api.php?action=getOperators&country=<id>&service=<service>`
- `GET /stubs/handler_api.php?action=getNumberV2&service=<service>&country=<id>&providerKey=hero_sms`
- `GET /stubs/handler_api.php?action=getNumberV2&providerKey=<freeProvider>&countryCode=<dialCode>`
- `GET /stubs/handler_api.php?action=getStatusV2&id=<activationId>&providerKey=hero_sms`
- `GET /stubs/handler_api.php?action=getStatus&id=<activationId>&providerKey=hero_sms`
- `GET /stubs/handler_api.php?action=setStatus&id=<activationId>&status=<3|6|8>&providerKey=hero_sms`

说明：

- 对外推荐优先使用 `sms/sessions/*` 这一组 native one-stop API；它和 `EasyEmail` 一样，以业务 session 为主语，而不是以 provider-specific 细节为主语。
- `GET /sms/query/messages` 现在默认返回统一消息视图，会把 cached provider-projected messages 与手动 `observe` messages 合并起来。
- `GET /sms/query/messages` 默认是 cache-first observability 语义；若要显式刷新 provider 投影消息，可传 `refreshProjected=true`
- `/providers/health`、`/providers/probe-history`、`/providers/probe` 当前主要面向具备公开号码 / 收件箱抓取能力的 provider
- `/sms/query/providers/health`、`/sms/query/providers/probe-history`、`/sms/query/providers/selection-plan` 是新的 canonical namespaced inspect 面
- `/sms/query/providers/health?mode=summary` 与 `/sms/query/providers/probe-history?mode=summary` 可用于更轻量的 dashboard / polling 场景
- `GET /sms/query/runtime` 现在会暴露 maintenance / active-probe / persistence 这三条后台 loop 的 canonical runtime diagnostics
- `GET /sms/snapshot` 默认是 `summary` 模式；如果要看完整 sessions/messages 明细，可显式传 `?mode=detail`
- `hero_sms` 这类 activation-capable provider 仍然出现在统一 provider catalog 中，但不参与同一套 public-number probe 统计
- `hero_sms` 的 paid 路径现在支持额外的请求字段：
  - `selectionMode = price-first | success-first | stock-first | balanced`
  - `allowReuse = true`
  - `businessKey`
  - `maxBindingsPerPhone`
- 同一条 HeroSMS 付费租期现在可以在 native activation API 中复用；返回的逻辑 activation 会额外暴露：
  - `upstreamActivationId`
  - `assignmentIndex`
  - `refundableCancelAvailableAtIso`
  - `refundEligible`
- 对外若只想认一套标准接口，可直接使用 `/openapi.json` 对应的 generic activation API，或使用 `handler_api.php` 兼容外观
- free provider 如果具备 public inbox 能力，现在也会以 synthetic activation session 的形式进入同一条 activation contract

`maintenance` 额外配置项：

- `activeProbeEnabled`
- `activeProbeIntervalMs`

当前 provider 选择模式：

- `aggregate-latest`
  会按加权排序后的 provider 顺序分批抓取，优先从更健康、惩罚更低的 provider 填满 `limit`
- `weighted-fallback`
  会按加权排序后的 provider 顺序逐个 fallback，命中第一个返回非空号码列表的 provider 后立即停止

加权排序会综合以下信号：

- provider `healthScore`
- provider 当前状态：`active` / `cooling` / `temporarily_disabled` / `degraded`
- provider 级路由 penalty
- country 级路由 penalty
- 最近错误类别：如 challenge / network / generic
- 最近是否出现空目录响应

主动探测结果会维护一个历史窗口，并对错误类别做分桶统计：

- `healthy`
- `empty`
- `challenge`
- `blocked`
- `degraded`

趋势评分会优先惩罚“最近 24 小时内反复出现 challenge / blocked”的 provider。这样像 `quackr` 这类经常被 verification gate 命中的 provider，即使偶尔恢复，也不会立刻回到最前排。

## 当前实现范围

- 默认启用的 free provider：
  - `onlinesim`
  - `smstome`
  - `receive_smss`
  - `receive_sms_free_cc`
  - `sms24`
  - `yunduanxin`
- 已接入但属于 paid provider：
  - `hero_sms`
- 当前默认启用的 synthetic activation free provider：
  - `onlinesim`
- 已调研但暂未接入：
  - `receivesms.org`：已列入 `/docs/unusable-providers.md`，人工验证判定不可用，不再重新接回
  - `smsreceivefree.com`：已列入 `/docs/unusable-providers.md`，人工验证判定不可用，不再重新接回
  - `freephonenum`：已列入 `/docs/unusable-providers.md`，不再重新接回
  - `temp_number`：已列入 `/docs/unusable-providers.md`，不再重新接回
  - `oksms.org`：已列入 `/docs/unusable-providers.md`，人工验证判定不可用，不再重新接回
  - `tempsmsonline.com`：已列入 `/docs/unusable-providers.md`，人工验证判定不可用，不再重新接回
  - `disposablesms.com`：已列入 `/docs/unusable-providers.md`，人工验证判定不可用，不再重新接回

当前限制说明：

- `onlinesim`：当前按国家只暴露“当前主号”，并增加“最近验证码 ≤ 20 分钟”活性过滤；支持通过 `providers.onlineSim.apiKey` 走官方 apikey 授权的纯 HTTP API 路径；已实测西班牙 / 法国主号可接到 LeetCode 新验证码。
- `receive_smss`：已改造成纯 HTTP provider。当前使用 curl_cffi 模拟现代浏览器 TLS/session；如果配置了 `providers.receiveSmss.username/password`，会先走 `/login/` 表单登录，再在同一 HTTP 会话里抓目录页与短信页。号码会额外应用“最近验证码 ≤ 30 分钟”的活性过滤。
- `receive_sms_free_cc`：已确认不是“必须浏览器态”，而是需要正确的纯 HTTP 登录顺序。当前 `service/base` 已补齐 `/auth/login` + `/ajax/login` 登录 helper，并支持通过 `providers.receiveSmsFreeCc.email/password` 在无浏览器环境下读取美国/英国号码页；同时继续沿用“最近验证码 ≤ 30 分钟”的活性过滤。2026-05-13 已通过隔离 Docker 实例实证 `/sms/public-numbers?providerKey=receive_sms_free_cc&countryCode=%2B44` 与 `/sms/inbox` 均可工作。它默认现已启用，且已经属于主服务可注册 provider，而不再只是 userscript 专属实现。
- `sms24`：已改造成纯 HTTP provider。当前使用 curl_cffi 模拟现代浏览器 TLS/session 抓取 `/en/numbers` 与具体号码页；号码会额外应用“最近验证码 ≤ 30 分钟”的活性过滤。
- `smstome`：已改造成纯 HTTP 登录增强 provider。当前使用 curl_cffi 模拟现代浏览器 TLS/session；helper 会先访问 `/sign-in`，解析 `_token`、`csrf_v` 和页面内算术验证码，再在同一 HTTP session 中抓国家页与短信页。号码会额外应用“最近验证码 ≤ 30 分钟”的活性过滤。
- `yunduanxin`：已改造成纯 HTTP provider。当前使用 curl_cffi 模拟现代浏览器 TLS/session 抓取主页与具体号码页；号码会额外应用“最近验证码 ≤ 30 分钟”的活性过滤。
- `hero_sms`：当前属于付费 activation provider。除原有 `getCountries / getPrices / getOperators / getNumberV2 / getStatus / setStatus` 兼容能力外，现已增加策略化选号（价格优先 / 成功率优先 / 库存优先 / 综合平衡）、业务维度的租期复用，以及 2 分钟后可退款取消的元数据。
