# Hosted Release Readiness

本文列出将 `EasySms` 通过 **SpringBok** 部署为 Cloudflare 对外服务前的核查清单：

- [ ] `.sba/manifest.json` 版本号已按 `x.y.z` 规则更新（升级时严格高于上一线上版本），工作区干净并已推送到 GitHub。
- [ ] 本地已通过 `.\scripts\test-all.ps1` 与 `python .\scripts\validate-release-contract.py`。
- [ ] SpringBok 已登记目标 GitHub 仓库连接与 Cloudflare 账号连接（令牌具备 Workers Scripts、Workers Subdomain/Domains、D1、R2 Storage 权限）。
- [ ] 已在 SpringBok 保存绑定当前仓库与 `easysms` 应用 ID 的 `applicationSecrets` 集合（含强随机 `EASYSMS_API_KEY` 与 `EASYSMS_BACKUP_PASSPHRASE`）。
- [ ] 部署或升级完成后，已按 [docs/release-acceptance-standard.md](release-acceptance-standard.md) 执行线上接口验收。
