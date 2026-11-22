# Release Acceptance Standard

本文定义 `EasySms` 通过 **SpringBok** 部署到 `cloudflare-workers` 的发布与验收标准。本地单元测试或离线合同校验通过不等同于已完成真实云端发布或业务验收。

## 1. 离线前置验收（提交前必做）

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
python .\scripts\validate-release-contract.py
```

若本机存在同级 `SpringBok` 仓库，可额外运行平台侧官方校验器：

```powershell
node C:\Users\Public\Project\SpringBok\pages\check-example.mjs C:\Users\Public\nas_home\AI\GameEditor\EasySms
```

要求检查项：
- `.sba/manifest.json`（v3）与 `.sba/deployment.json`（v2）字段、路径与秘密集合完全一致。
- `service/base` TypeScript 类型检查、Vitest 回归测试与 `dist/worker.mjs` 打包零 `node:` 依赖。
- `tests/sba/sba-lifecycle.test.mjs` 五个生命周期动作及 `failed`/`unknown` 边界回归全部通过。

## 2. SpringBok 部署后线上人工验收

在 SpringBok 控制台选择固定 40 位提交 SHA 完成部署或升级，并收到认证成功回执后，还须针对线上入口核验：

1. 匿名版本回执：`GET /.well-known/easysms-release.json` 返回当前固定 `applicationVersion`、`sourceSha`、`environment` 与 `purpose: "production"`。
2. 匿名健康与契约：`GET /healthz` 返回 `status: "ok"`，`GET /openapi.json` 返回 OpenAPI `3.1.0`。
3. 访问控制边界：不携带 `Authorization` 访问 `GET /sms/catalog` 必须返回 `HTTP 401`。
4. 认证业务可用性：携带 `Authorization: Bearer <EASYSMS_API_KEY>` 访问 `GET /sms/catalog`、`GET /providers/health` 与 `GET /sms/query/stats` 返回 `HTTP 200`，且 D1 状态读写正常。

可使用辅助验收脚本一键核对上述四项：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-easysms-endpoint.ps1 -BaseUrl "https://<worker-origin>" -ApiKey "<EASYSMS_API_KEY>"
```
