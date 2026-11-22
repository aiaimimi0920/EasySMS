# Release Contract

Project: `EasySms`

Release class: `springbok-cloudflare-workers`

本仓库遵循面向 **SpringBok** 控制面的 Cloudflare Workers 服务发布契约。部署、同实例升级、独立验证、隔离预升级与测试环境清理由 `.sba/` 目录定义，不在本仓库维护独立的 GHCR 镜像或手写云端发布流水线。

## 核心契约项

- `.sba/manifest.json`（`schemaVersion: 3`）：声明稳定应用 ID `easysms`、固定 `ubuntu-24.04` / Node `22` 运行环境、五个必需动作（`deploy`、`update`、`verify`、`preview`、`destroy-preview`）及 11 个秘密名称引用。
- `.sba/deployment.json`（`schemaVersion: 2`）：声明 `target: "cloudflare-workers"`、单 Cloudflare 运行账号、D1 状态数据库（`database`）、私有 R2 加密备份桶（`backups`）以及带 `{instance}` 隔离模板的 Worker 与域名目标。
- `.sba/springbok.ps1` / `.sba/springbok.mjs`：接收 `-RequestPath` 与 `-ResultPath`，写前失败返回 `failed`，云写入开始后的不确定异常返回 `unknown` 且绝不自动重放。
- `service/base/scripts/build-worker.mjs`：产出零 `node:` 运行时依赖的单文件 Worker 模块。

## 本地校验命令

```powershell
node .\scripts\validate-sba.mjs
python .\scripts\validate-release-contract.py
```
