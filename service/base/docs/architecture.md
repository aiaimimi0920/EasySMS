# EasySMS Architecture

`EasySMS` 当前采用轻量分层：

- `runtime`
  - 负责读取 YAML 配置、合并默认值、启动 HTTP server
- `service`
  - 负责多 provider 编排、聚合结果裁剪、错误汇总
- `providers`
  - 负责对接具体短信网站，并把 HTML 页面或公共接口抽象成统一数据结构
- `http`
  - 负责 HTTP 协议层与鉴权
- `domain`
  - 负责业务模型、错误与统一返回结构
- `shared`
  - 负责文本归一化、号码引用编码、browser-like 请求与 `curl` 回退

当前 provider 采用混合接入策略：

1. 如果源站有匿名可用的公开接口，优先直接接官方接口。
2. 如果没有公开接口，但能直接读官方 / 公网页面 HTML，就做 server-side scrape。
3. 如果页面依赖前端请求，再继续逆向页面调用并抽象成统一 provider。
4. 如果站点对裸请求做强挑战，先记录为 `degraded` 或 `pending`，避免把不稳定站点直接挂进默认链路。
