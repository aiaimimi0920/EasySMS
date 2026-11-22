# Configuration & Secrets

`EasySms` 区分 **云端公开部署配置**、**云端加密业务秘密** 与 **本地开发配置**。

## 1. SpringBok 云端公开配置（`.sba/deployment.json`）

公开配置进入部署计划与回执，**严禁包含任何密钥或密码**：
- `workerName`：默认模板 `easysms-{instance}`
- `workerOrigin`：默认模板 `https://easysms-{instance}.{subdomain:runtime}.workers.dev`（可在控制台选择已登记自定义域名子域，如 `https://sms.yamiyu.com`）
- `runtimeOptions`：可选 JSON 覆盖项（如调整 `scraping.requestTimeoutMs` 或 `providers.enabledProviders`），默认 `null`

## 2. SpringBok 加密秘密（`manifest.secrets`）

| 秘密名称 | 类型 | 必填性 | 说明 |
| --- | --- | --- | --- |
| `EASYSMS_CLOUDFLARE_API_TOKEN` | 云账号秘密 | 必填 | 由 SpringBok Cloudflare 连接自动提供 |
| `EASYSMS_API_KEY` | 业务秘密 | 必填 | 对外 HTTP API 的 Bearer 访问令牌（`>= 8` 字符） |
| `EASYSMS_BACKUP_PASSPHRASE` | 业务秘密 | 必填 | D1 状态备份与预升级归属记录的加密口令 |
| `EASYSMS_HEROSMS_API_KEY` | 业务秘密 | 可选 | 付费 HeroSMS API Key；不用时填 `"disabled"` |
| `EASYSMS_ONLINESIM_API_KEY` | 业务秘密 | 可选 | OnlineSIM API Key；不用时填 `"disabled"` |
| `EASYSMS_SMSTOME_EMAIL` | 业务秘密 | 可选 | SMSToMe 登录邮箱；不用时填 `"disabled"` |
| `EASYSMS_SMSTOME_PASSWORD` | 业务秘密 | 可选 | SMSToMe 登录密码；不用时填 `"disabled"` |
| `EASYSMS_RECEIVESMSS_USERNAME` | 业务秘密 | 可选 | Receive-SMSS 用户名；不用时填 `"disabled"` |
| `EASYSMS_RECEIVESMSS_PASSWORD` | 业务秘密 | 可选 | Receive-SMSS 密码；不用时填 `"disabled"` |
| `EASYSMS_RECEIVESMSFREECC_EMAIL` | 业务秘密 | 可选 | Receive-SMS-Free.cc 邮箱；不用时填 `"disabled"` |
| `EASYSMS_RECEIVESMSFREECC_PASSWORD` | 业务秘密 | 可选 | Receive-SMS-Free.cc 密码；不用时填 `"disabled"` |

## 3. 本地开发配置（`config.yaml`）

本地运行 `npm run dev` 时从仓库根目录 `config.yaml`（由 `config.example.yaml` 复制生成，已被 `.gitignore` 忽略）读取配置。
