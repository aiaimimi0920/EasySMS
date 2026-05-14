# EasySms Service Base Deploy Workspace

这个目录承载 `EasySms` monorepo 中 `service/base` 的 Docker / 发布 / smoke 资产。
它是根级 `scripts/` 与 `deploy-host.ps1` 的底层部署层，不是用户首先进入的操作入口。

## 核心部署契约（文件驱动）

- canonical runtime config：`/etc/easy-sms/config.yaml`
- canonical runtime env：`/etc/easy-sms/runtime.env`
- canonical bootstrap path：`/etc/easy-sms/bootstrap/r2-bootstrap.json`
- canonical state dir：`/var/lib/easy-sms`
- 最小容器环境变量：
  - `EASY_SMS_CONFIG_PATH`
  - `EASY_SMS_RUNTIME_ENV_PATH`
  - `EASY_SMS_BOOTSTRAP_PATH`
  - `EASY_SMS_STATE_DIR`
  - `EASY_SMS_RESET_STORE_ON_BOOT`

运行时 provider 与服务参数都应写入 `config.yaml`，不再以零散环境变量作为主契约。

`config.yaml` 顶层字段：

- `server`
- `strategy`
- `maintenance`
- `persistence`
- `scraping`
- `providers`

`maintenance` 额外包含：

- `activeProbeEnabled`
- `activeProbeIntervalMs`

## 目录内关键文件

- `Dockerfile`：构建 EasySMS 服务镜像（含 bootstrap/import-code helper）
- `docker-compose.yaml`：本地 docker compose 运行 / EasyAiMi 外部网络别名
- `config.template.yaml`：默认配置模板
- `bootstrap-service-config.py`：从 Cloudflare R2 拉取运行时配置
- `docker-entrypoint.sh`：容器启动入口（支持 import-code/bootstrap、runtime env、远程同步）
- `publish-ghcr-easy-sms-service.ps1`：底层本机 GHCR 发布脚本
- `smoke-easy-sms-docker-api.ps1`：底层容器 API smoke 脚本

## Blank-host / bootstrap

如果容器内没有挂入本地 `config.yaml`，现在可以通过：

- `EASY_SMS_IMPORT_CODE`
- 或挂载 `bootstrap/r2-bootstrap.json`

在容器启动时自动从 R2 拉取：

- `config.yaml`
- `runtime.env`

## 独立运行时约定

- 宿主机访问地址：`http://127.0.0.1:18081`
- 其他 Docker 容器访问地址：`http://host.docker.internal:18081`
- 推荐开启 `server.apiKey`，其他程序统一通过 `Authorization: Bearer <token>` 访问
- 当前默认启用的 public-web providers：
- `onlinesim`
- `smstome`
- `receive_smss`
- `receive_sms_free_cc`
- `sms24`
- 其余 free provider 代码仍保留，但因为 list-only、headless challenge、或当前匿名运行态下长期空目录，不再默认启用
- 运行时会优先尝试 Node `fetch`，命中站点防护时自动回退到容器内 `curl`
- `onlinesim` 走公开 JSON API，并支持通过 `providers.onlineSim.apiKey` 走官方 apikey 授权路径；同时附带“最近验证码 ≤ 20 分钟”活性过滤
- `receive_smss` 现在也能在 `service/base` 中以纯 HTTP 方式工作：使用 curl_cffi 模拟现代浏览器 TLS/session；如果配置了 `providers.receiveSmss.username/password`，会先调用 `/login/` 表单登录，再抓目录页与短信页；同时附带“最近验证码 ≤ 30 分钟”活性过滤
- `receive_sms_free_cc` 现在也能在 `service/base` 中以纯 HTTP 方式工作：先调用 `/auth/login` + `/ajax/login` 建立站点会话，再抓取号码页；同时附带“最近验证码 ≤ 30 分钟”活性过滤。它现在默认已启用；如需稳定读取受保护区域，请填写 `providers.receiveSmsFreeCc.email/password`
- `sms24` 现在也能在 `service/base` 中以纯 HTTP 方式工作：使用 curl_cffi 模拟现代浏览器 TLS/session 抓目录页和号码页；同样附带“最近验证码 ≤ 30 分钟”活性过滤
- `smstome` 现在也能在 `service/base` 中以纯 HTTP 方式工作：helper 会先访问 `/sign-in`，解析 `_token`、`csrf_v` 和页面里的算术验证码，再在同一 HTTP session 中抓国家页与短信页；同样附带“最近验证码 ≤ 30 分钟”活性过滤。建议填写 `providers.smsToMe.email/password`
- 运行时会自动维护 provider 健康状态，并周期性探测站点是“可抓 / challenge / 空站 / blocked”
- provider 级临时禁用、provider 路由冷却和状态快照可以通过 HTTP 管理接口查看或操作

## 快速启动

```powershell
# 推荐先在仓库根目录执行
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-service-base.ps1
```

如果需要直接调用底层 compose 文件：

```powershell
docker compose -p easysms-service-base -f .\deploy\service\base\docker-compose.yaml up -d --build
```

默认端口：`http://127.0.0.1:18081`

容器内配置注意：

- 如果把真实运行配置挂进容器，`server.host` 必须绑定到 `0.0.0.0`
- 如果误写成 `127.0.0.1`，容器虽然会正常启动，但 Docker 端口映射无法从宿主机访问
- 当前仓库只保留 `data/.gitkeep`，不版本化任何运行时 state 快照
- 新部署应从空 `data/` 目录启动，由服务自己生成运行状态

示例请求：

```powershell
$headers = @{
  Authorization = "Bearer <server.apiKey>"
}

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/sms/public-numbers?providerKey=onlinesim&limit=5" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/health" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/selection-plan?countryName=United%20States" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/probe-history" `
  -Headers $headers

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/providers/probe" `
  -Headers $headers
```

## 本地 smoke

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\service\base\smoke-easy-sms-docker-api.ps1 -Rebuild -Cleanup
```

## 发布 GHCR（本机）

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\service\base\publish-ghcr-easy-sms-service.ps1 -Owner <github-owner> -Push
```
