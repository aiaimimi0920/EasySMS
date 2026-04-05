# EasySMS

`EasySMS` 是 `SMSService` 工作区中的免费公共短信聚合服务，统一对外暴露 HTTP API，把多个公开接码网站抽象成同一套号码列表与短信收件箱接口。

当前版本已包含：

- 文件驱动运行时契约
- 多站点 HTML / 公共 JSON API provider
- 浏览器风格请求头 + `curl` 回退抓取链路
- 可选本机浏览器 `--dump-dom` 渲染回退，用于识别前端渲染 / gate 页面
- provider 健康检查、冷却/熔断、临时禁用与状态快照
- HTTP health / provider catalog / provider health / public number / inbox / admin 控制接口
- Docker 部署骨架
- TypeScript + Vitest 开发基线

canonical repo：

- `C:\Users\Public\nas_home\AI\GameEditor\SMSService\repos\EasySMS`

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
- `src/providers/`：provider adapters（当前包含 `freephonenum`、`jiemahao`、`onlinesim`、`quackr`、`receivesms_co`、`receive_smss`、`temp_number`、`temporary_phone_number`、`receive_sms_free_cc`、`yunduanxin`、`sms24`）
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

工作区级部署资产位于：

- `C:\Users\Public\nas_home\AI\GameEditor\SMSService\deploy\EasySMS`

---

## 本地验证

在仓库根目录执行：

```powershell
npm install
npm run typecheck
npm run test
npm run build
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

- `GET /providers/health`
- `GET /providers/selection-plan`
- `GET /providers/probe-history`
- `POST /providers/probe`
- `POST /admin/providers/{providerKey}/probe`
- `POST /admin/providers/{providerKey}/disable`
- `POST /admin/providers/{providerKey}/enable`
- `POST /admin/providers/{providerKey}/reset`

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

- 已接入并验证可抓取：
  - `freephonenum`
  - `jiemahao`
  - `onlinesim`
  - `quackr`
  - `receivesms_co`
  - `receive_smss`
  - `temp_number`
  - `temporary_phone_number`
  - `receive_sms_free_cc`
  - `yunduanxin`
  - `sms24`
- 已调研但暂未接入：
  - `smstome`：站点首页与国家页可达，但在 2026-04-05 的匿名浏览器渲染下号码页会落到 Cloudflare 错误页
  - `receivesms.org`：`active-numbers` 页面当前直接显示没有可用号码，接入后只会长期返回空列表
  - `smsreceivefree.com`：在 2026-04-05 的当前网络环境下，`curl` TLS 握手失败，匿名浏览器请求则会落到 `ERR_CONNECTION_CLOSED`
  - `oksms.org`：匿名请求会落到 Cloudflare challenge
  - `tempsmsonline.com`：目录页可达，但已检查的号码页在 2026-04-05 主要暴露前端壳页面，未确认稳定公开 inbox 数据源
  - `disposablesms.com`：首页号码目前以 `XXXX` 打码展示，不符合当前公共号码聚合的接入标准
  - `hero-sms`：收费注册服务，不属于当前 free aggregator 首批接入范围

当前限制说明：

- `onlinesim`：现在按国家可枚举多个公开号码，但在 2026-04-05 的公开接口状态下，短信收件箱只稳定暴露国家页当前主号码。
- `quackr`：公开号码列表已接入；在 2026-04-05 的匿名状态下，公共 API 与浏览器渲染号码页都会命中 verification / login gate，因此默认仅标记为列表型 provider。
- `receivesms_co`：目录页和号码页都可通过常规 HTML 抓取读取，不需要额外浏览器回退。
- `jiemahao`：国家页列号可抓；但在 2026-04-05 的匿名状态下，`/sms/?phone=...` 需要先过 Turnstile 并提交表单，因此默认仅标记为列表型 provider。
- `receive_smss`：在 2026-04-05 的当前环境下，必须走“原生浏览器 UA + DOM 渲染”链路；带固定抓取 UA 的 HTTP / 浏览器请求都会更容易命中 Cloudflare challenge。
