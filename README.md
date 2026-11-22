# EasySms

`EasySms` 是一个运行在 **Cloudflare Workers + D1 + 私有 R2** 上的统一短信接码与会话编排 HTTP 服务，并通过 `.sba/` 完整接入 **SpringBok**（manifest v3 / deployment v2）实现固定版本发布、加密备份升级、隔离预升级与受控清理。

## 核心能力

- **纯服务端对外 HTTP 服务（Cloudflare Workers）**：
  - 会话优先 API：`/sms/catalog`、`/sms/sessions/plan`、`/sms/sessions/open`、`/sms/sessions/:id/code`、`/sms/sessions/:id/report`
  - 兼容门面：`/stubs/handler_api.php`（兼容 SMS-Activate / HeroSMS 调用协议，支持 `Authorization: Bearer <key>` 或 `?api_key=<key>`）
  - 通道健康治理：`/providers/health`、`/providers/probe`、冷却降级、加权选路与管理员 `disable` / `enable` / `reset`
  - 强制访问控制：对外仅匿名开放 `/healthz`、`/openapi.json` 与 `/.well-known/easysms-release.json`，其余业务与管理端点强制校验 `EASYSMS_API_KEY`
- **Cloudflare 原生存储与定时维护**：
  - `STATE_DB`（Cloudflare D1）：持久化会话、合成/付费租约、Provider 路由健康、探测趋势与 SHA-256 完整性摘要
  - `BACKUP_STORE`（私有 Cloudflare R2）：用于 SBA `update` 加密状态备份与 `preview` 预升级归属凭证
  - 支持 Worker `scheduled` 触发器执行过期会话裁剪与非预升级环境的主动健康探测
- **SpringBok SBA 标准接入**：
  - 见 [.sba/README.md](.sba/README.md)、[docs/easysms-release-workflow.md](docs/easysms-release-workflow.md) 与 [docs/release-acceptance-standard.md](docs/release-acceptance-standard.md)

## 本地验证与开发

需要 Node.js 22+ 与 Python 3.12（安装了 `pyyaml`）：

```powershell
Copy-Item .\config.example.yaml .\config.yaml
powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
python .\scripts\validate-release-contract.py
```

导出供 SpringBok 部署面板导入的 `applicationSecrets` JSON 模板：

```powershell
node .\scripts\export-sba-secrets-template.mjs
```

对已部署的 Cloudflare Worker 实例执行端到端 HTTP 验收检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-easysms-endpoint.ps1 -BaseUrl "https://easysms-prod.<subdomain>.workers.dev" -ApiKey "<EASYSMS_API_KEY>"
```

## 文档导航

- [快速开始](docs/quickstart.md)
- [架构说明](docs/architecture.md)
- [配置与秘密管理](docs/configuration.md)
- [API 契约](docs/api-contract.md)
- [开发工作流](docs/development-workflow.md)
- [SpringBok 发布流程](docs/easysms-release-workflow.md)
- [发布契约](docs/release-contract.md)
- [发布验收标准](docs/release-acceptance-standard.md)
