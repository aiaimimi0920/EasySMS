# EasySms SpringBok 发布流程

`EasySms` 通过 **SpringBok** 部署到 Cloudflare Workers，不再使用历史 Docker / GHCR 发布工作流。验收要求详见 [docs/release-acceptance-standard.md](release-acceptance-standard.md)。

## 1. 准备业务秘密集合（首次部署）

1. 在本地生成秘密模板：
   ```powershell
   node .\scripts\export-sba-secrets-template.mjs
   ```
2. 在安全本地环境中填入真实的 `EASYSMS_API_KEY`、`EASYSMS_BACKUP_PASSPHRASE` 以及实际启用的上游通道密钥（未启用的上游项保持 `"disabled"`），**切勿将该文件提交进 Git**。
3. 在 SpringBok 部署界面点击 `applicationSecrets` 的“导入 JSON”，保存至 owner 加密保险库。

## 2. 首次部署（`deploy`）

1. 将通过本地全量校验的提交推送到 GitHub。
2. 在 SpringBok 中选择已连接的 GitHub 仓库与固定 40 位提交 SHA，确认环境名（如 `prod`）、Cloudflare 账号、默认生成的 D1（`easysms-{instance}-state`）、私有 R2（`easysms-{instance}-backups`）及访问域名（默认 `.workers.dev` 或选择已登记 Zone 子域）。
3. 审阅两分钟签名计划并提交一次，等待业务回执返回 `succeeded`。

## 3. 版本升级与隔离预升级（`preview` / `destroy-preview` / `update`）

- 每次升级必须递增 `.sba/manifest.json` 中的稳定版本号 `x.y.z` 并产生新的提交 SHA。
- 可先通过 `preview` 在独立 `test-*` 环境复制源 D1 数据验证迁移与预升级隔离，验证后执行 `destroy-preview` 清理预升级资源。
- 正式 `update` 会自动在私有 R2 创建加密备份并核对升级前后 D1 业务状态一致。
