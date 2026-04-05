# EasySMS API

当前 API 以“公开号码列表 + 号码收件箱”两类查询为核心。

## `GET /healthz`

返回服务状态、已启用 provider 数量与当前策略模式。

## `GET /providers`

返回当前 provider catalog、来源网站、能力与说明。

## `GET /sms/public-numbers`

查询参数：

- `providerKey`：可选，限定单个 provider
- `limit`：可选，限制返回条数
- `countryCode`：可选，例如 `+1`
- `countryName`：可选，例如 `United States`

返回值：

- `items[]`：统一后的公开号码列表
- `errors[]`：某个 provider 抓取失败时的非致命错误

每个 `items[]` 元素包含：

- `providerKey`
- `providerDisplayName`
- `numberId`
  - 这是对源站号码引用做过 base64url 编码后的稳定标识，调用 `/sms/inbox` 时直接原样带回即可
- `sourceUrl`
- `phoneNumber`
- `countryName`
- `countryCode`
- `latestActivityText`

## `GET /sms/inbox`

查询参数：

- `providerKey`：必填
- `numberId`：必填，来自 `/sms/public-numbers`

返回值：

- `phoneNumber`
- `countryName`
- `countryCode`
- `sourceUrl`
- `fetchedAtIso`
- `messages[]`

每条 `messages[]` 包含：

- `id`
- `sender`
- `receivedAtText`
- `receivedAtIso`
- `content`
- `sourceUrl`
