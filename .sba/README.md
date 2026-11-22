# EasySms SBA 接入说明

本目录实现 `EasySms` 面向 **SpringBok** 控制面的 SBA 执行契约（`manifest.json` v3 与 `deployment.json` v2），目标形态为 `cloudflare-workers`。

> 注意：源码与本地合成契约测试通过不代表已在真实云账号部署或完成线上业务验收；所有真实云写入、升级与清理均须在 SpringBok 控制台按固定提交 SHA 审阅确认后执行。

## 1. 目录与文件

| 文件 | 说明 |
| --- | --- |
| `manifest.json` | SBA v3 执行合同（`id: "easysms"`，`ubuntu-24.04` / Node 22，动作 `deploy`、`update`、`verify`、`preview`、`destroy-preview`） |
| `deployment.json` | SBA v2 部署声明（单 Cloudflare 账号、Worker 与 HTTPS 入口目标、D1 状态库 `database`、私有 R2 备份桶 `backups`、10 项 `applicationSecrets`） |
| `springbok.ps1` | SBA 官方入口（接收 `-RequestPath` 与 `-ResultPath`，转发至同目录 `springbok.mjs`） |
| `springbok.mjs` | Node 22 执行调度器（原子写入 UTF-8 无 BOM 结果 JSON） |
| `lifecycle.mjs` | 五个必需动作的真实生命周期实现、预升级副作用隔离与 `unknown` 停写保护 |
| `cloudflare-api.mjs` | Cloudflare v4 REST API 客户端（Workers、D1、私有 R2、Custom Domain / `workers.dev`） |
| `crypto-backup.mjs` | 基于 `EASYSMS_BACKUP_PASSPHRASE` 的 HKDF-SHA256 + AES-256-GCM 状态快照加解密与完整性校验 |
| `worker-build.mjs` | 在源码树之外的隔离临时目录构建无 `node:` 运行时依赖的单文件 `worker.mjs` |

## 2. 秘密声明（不含任何秘密值）

- **账号秘密**：`EASYSMS_CLOUDFLARE_API_TOKEN`（需具备目标账号 Workers Scripts Write、Workers Custom Domains/Subdomain Write、D1 Write、R2 Storage Write，以及使用自定义域名时的 Zone Read / DNS Read）
- **必需业务秘密**：
  - `EASYSMS_API_KEY`：对外 HTTP API 的强制 Bearer 访问密钥（至少 8 位且不含空白字符）
  - `EASYSMS_BACKUP_PASSPHRASE`：`update` 数据备份与 `preview` 来源元数据加密口令
- **可选上游通道秘密**（未启用时请在 SpringBok `applicationSecrets` JSON 中填写 `"disabled"` 占位，因平台要求每个秘密值非空）：
  - `EASYSMS_HEROSMS_API_KEY`
  - `EASYSMS_ONLINESIM_API_KEY`
  - `EASYSMS_SMSTOME_EMAIL` / `EASYSMS_SMSTOME_PASSWORD`
  - `EASYSMS_RECEIVESMSS_USERNAME` / `EASYSMS_RECEIVESMSS_PASSWORD`
  - `EASYSMS_RECEIVESMSFREECC_EMAIL` / `EASYSMS_RECEIVESMSFREECC_PASSWORD`

可通过以下命令在本地生成供 SpringBok 表单“导入 JSON”使用的占位模板：

```powershell
node .\scripts\export-sba-secrets-template.mjs
```

## 3. 动作行为与边界

- `deploy`：校验空白 D1 与私有 R2，初始化 `0001_initial.sql`，发布 Worker 与绑定，启用 `workers.dev` 或绑定自定义域名，核验公开 `/.well-known/easysms-release.json`、`/healthz`、`401` 鉴权边界及带 Bearer 的 `/sms/catalog`、`/sms/query/stats`。
- `update`：核对原版本/SHA 基线，先导出 D1 状态并经 AES-256-GCM 加密写入私有 R2 读回解密核验（`backup-created`），再执行增量迁移与 Worker 更新，最后核对 D1 业务状态摘要未变（`data-preserved`）。
- `verify`：支持无部署写凭据模式（秘密占位为 `verification-not-applicable`），只读核验公开版本回执、健康检查、OpenAPI 与未授权请求 `401` 拦截边界。
- `preview`：将源 D1 状态复制至独立预升级 D1（`snapshot-copied`、`migration-verified`），以 `SBA_PURPOSE=preview` 发布预升级 Worker（自动剥离付费上游密钥并拒绝激活/探测写操作，实现 `side-effects-isolated`），最后复核源 D1 零改动（`source-unchanged`）。
- `destroy-preview`：核验预升级加密归属记录后，按“入口 -> Worker -> D1 -> R2 对象与桶”顺序清理独立预升级资源，并复核源实例未受影响。
