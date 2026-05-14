# EasySMS HTTP API

`EasySms` 现在有两层对外接口：

1. **native session-first API**
2. **legacy / compatibility API**

推荐调用方优先使用 native session-first API。它的设计目标与
`EasyEmail` 一致：对外主语是业务 session，而不是底层 provider。

---

## 一、Native Session-First API

### `GET /sms/catalog`

获取统一 catalog：

- `providers`
- `strategyModeId`
- `compatibility`

### `GET /sms/snapshot`

获取运行时快照：

- 默认 `mode=summary`
- 若要完整明细，可传：
  - `?mode=detail`

`summary` 模式返回：

- `catalog`
- `runtime`
- `runtimeState`

`detail` 模式额外返回：

- `sessions`
- `observedMessages`
- `projectedMessages`

说明：

- `runtimeState` 不再重复内嵌 `managedSessions / observedMessages / projectedMessages`
- `runtimeState.probeHistory` 仅在 `detail` 模式返回；默认请走 `GET /sms/query/providers/probe-history`
- 这样 detail snapshot 不会在 root 和 runtimeState 中重复装同一批 session/message 数据

### `POST /sms/sessions/plan`

只做 plan，不真正开 session。

请求体可选字段：

- `providerKey`
- `costTier`
- `service`
- `country`
- `countryCode`
- `countryName`
- `numberId`
- `operator`

返回：

- `plan`
  - `planned`
  - `providerKey`
  - `providerDisplayName`
  - `costTier`
  - `sessionMode`
  - `notes`

### `POST /sms/sessions/open`

打开 canonical SMS session。

请求体与 `plan` 基本一致：

- `providerKey`
- `costTier`
- `service`
- `country`
- `countryCode`
- `countryName`
- `numberId`
- `operator`

返回：

- `session`
  - `id`
  - `providerKey`
  - `providerDisplayName`
  - `activationId`
  - `sessionMode`
  - `costTier`
  - `phoneNumber`
  - `countryCode`
  - `countryName`
  - `openedAtIso`

### `POST /sms/sessions/recover-by-phone`

按手机号恢复本地已存在 session。

请求体：

- `phoneNumber`：必填
- `providerKey`：可选

返回：

- `result.recovered`
- `result.strategy`
- `result.session`

### `POST /sms/sessions/report-outcome`

回报 session outcome。

请求体：

- `sessionId`
- `success`
- `failureReason`
- `observedAt`
- `source`
- `detail`

说明：

- 对 synthetic public-inbox session，这个结果会反馈进 provider
  operational state
- 这样可以让 one-stop API 的业务 outcome 反哺 provider health

### `POST /sms/messages/observe`

手动写入一条 observed message。

请求体：

- `sessionId`
- `content`
- `sender`
- `receivedAtText`
- `receivedAtIso`
- `code`
- `sourceUrl`

### `GET /sms/sessions/{sessionId}/status`

读取 session 当前状态。

返回：

- `status`
  - `providerKey`
  - `activationId`
  - `sessionId`
  - `received`
  - `cancelled`
  - `code`
  - `text`
  - `costTier`
  - `sessionMode`

### `GET /sms/sessions/{sessionId}/code`

读取当前最优 OTP 提取结果。

返回：

- `code.sessionId`
- `code.providerKey`
- `code.code`
- `code.source`
- `code.observedMessageId`
- `code.candidates`

### `GET /sms/sessions/{sessionId}/messages`

返回该 session 的归一化消息视图。

返回：

- `messages[]`
  - `id`
  - `sessionId`
  - `providerKey`
  - `sourceType`
  - `sender`
  - `receivedAtText`
  - `receivedAtIso`
  - `content`
  - `code`
  - `sourceUrl`
  - `observedAtIso`

### `POST /sms/sessions/{sessionId}/actions`

更新 session 生命周期动作。

请求体：

- `action`
  - `request-code`
  - `complete`
  - `cancel`

返回：

- `result`
  - `providerKey`
  - `activationId`
  - `sessionId`
  - `requestedAction`
  - `requestedStatus`
  - `resultText`

---

## 二、Admin / Query API

### `GET /sms/query/providers`

查询 provider catalog。

支持 query：

- `costTier`
- `capability`

### `GET /sms/query/runtime`

查询后台 runtime diagnostics。

返回：

- `runtime`
  - `serviceStartedAt`
  - `stateStore`
  - `stateLoad`
  - `maintenanceLoop`
  - `activeProbeLoop`
  - `persistenceLoop`

### `GET /sms/query/providers/health`

查询 canonical provider health / route health / trend 数据。

支持 query：

- `providerKey`
- `mode`
  - `detail`：默认，返回完整 health 包
  - `summary`：只返回 summary，除非显式打开 include flags
- `includeProviders`
- `includeRoutes`
- `includeTrends`

### `GET /sms/query/providers/probe-history`

查询 canonical provider probe history。

支持 query：

- `providerKey`
- `mode`
  - `detail`：默认
  - `summary`：默认只返回最小响应，需要显式打开 include flags
- `includeHistory`
- `includeTrends`
- `routeKind`
- `healthState`
- `since`
- `until`
- `newestFirst`
- `limit`

### `GET /sms/query/providers/selection-plan`

查询 canonical provider selection plan。

支持 query：

- `providerKey`
- `costTier`
- `countryCode`
- `countryName`
- `limit`

### `GET /sms/query/sessions`

查询 session 列表。

支持 query：

- `providerKey`
- `costTier`
- `sessionMode`
- `phoneNumber`
- `service`
- `countryCode`
- `countryName`
- `hasCode`
- `hasOutcome`
- `since`
- `until`
- `newestFirst`
- `limit`

### `GET /sms/query/sessions/{sessionId}`

查询单个 managed session。

### `GET /sms/query/messages`

查询统一消息视图。

支持 query：

- `sessionId`
- `providerKey`
- `sourceType`
- `extractedCodeOnly`
- `includeProjected`
- `includeManual`
- `refreshProjected`
- `since`
- `until`
- `newestFirst`
- `limit`

说明：

- 默认会同时返回：
  - cached provider-projected messages
  - 手动 `observe` messages
- 默认是 cache-first observability 语义，不会因为查询面而主动触发上游抓取
- 如需显式刷新 provider-projected messages，可传：
  - `refreshProjected=true`
- 如果只想看人工写入的消息，可传：
  - `includeProjected=false`
- 如果只想看 provider 投影消息，可传：
  - `includeManual=false`

### `GET /sms/query/messages/{messageId}`

按统一 message id 查询单条消息。

### `GET /sms/query/stats`

查询轻量统计：

- `sessionCount`
- `observedMessageCount`
- `providerCount`
- `syntheticSessionCount`
- `paidSessionCount`
- `storedObservedMessageCount`
- `cachedProjectedMessageCount`

### `GET /sms/providers/probe-all`

对当前 provider 池执行 probe。

### `GET /sms/providers/{providerKey}/probe`

对单个 provider 执行 probe。

### `POST /sms/maintenance/run`

立即执行一次 maintenance。

---

## 三、Legacy / Low-Level API

这些接口仍保留，但不再是推荐主入口：

- `GET /providers`
- `GET /providers/health`
- `GET /providers/probe-history`
- `GET /providers/selection-plan`
- `POST /providers/probe`
- `GET /sms/public-numbers`
- `GET /sms/inbox`
- `POST /sms/activations`
- `GET /sms/activations/{id}/status`
- `POST /sms/activations/{id}/actions`
- `GET /providers/hero_sms/countries`
- `GET /providers/hero_sms/top-countries`
- `GET /providers/hero_sms/operators`

这组接口更适合：

- compatibility
- provider debugging
- low-level routing inspection

---

## 四、Compatibility Facade

兼容路由：

- `GET /stubs/handler_api.php?action=...`

支持：

- `getCountries`
- `getPrices`
- `getTopCountriesByService`
- `getTopCountriesByServiceRank`
- `getOperators`
- `getNumberV2`
- `getStatus`
- `getStatusV2`
- `setStatus`

说明：

- free facade 默认优先
- 若要显式走 paid metadata 或 paid activation：
  - `providerKey=hero_sms`
  - 或 `costTier=paid`

---

## 五、鉴权

当前仍采用单层 Bearer token 方案：

- 若配置了 `server.apiKey`
- 则所有接口都要求：
  - `Authorization: Bearer <api-key>`

当前例外：

- `/healthz`
- `/openapi.json`

仓内推荐的 secured-mode 验证入口：

- `powershell -ExecutionPolicy Bypass -File .\scripts\test-service-base-instance.ps1 -ApiKey "<api-key>" -Cleanup`

该脚本会基于当前 root config 生成一个临时 secured smoke config，
不会改动主配置文件。

---

## 六、机器可读契约

正式机器可读契约：

- `GET /openapi.json`

如果其他 agent / 程序要直接集成 `EasySms`，优先读取这里，而不是自己猜接口。
