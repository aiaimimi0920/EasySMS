# EasySms Core & Cloudflare Worker (`service/base`)

`service/base` 包含 `EasySms` 的核心领域模型、统一 Provider 路由健康状态机、纯 Web `fetch` + Cookie-Jar 抓取客户端、D1 持久化存储适配器以及 Cloudflare Workers 入口（`src/worker/index.ts`）。

## 主要脚本

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

- `npm run build` 会同时执行 TypeScript 编译检查与 `scripts/build-worker.mjs`，产出零 `node:` 运行时依赖的单文件 ESM Worker 包 `dist/worker.mjs`。
- `npm run dev` 仍可在本地启动轻量开发调试 HTTP 服务（读取本地 `config.yaml`）。

## 目录结构

- `src/worker/index.ts`：Cloudflare Workers `fetch` 与 `scheduled` 入口
- `src/http/web-router.ts`：基于标准 Web `Request`/`Response` 的统一路由器、Bearer 鉴权与 `preview` 副作用隔离
- `src/persistence/d1-store.ts`：Cloudflare D1 状态读写与 SHA-256 校验
- `migrations/0001_initial.sql`：D1 初始表结构（`easysms_meta`、`easysms_runtime_state`）
- `src/service/`：`EasySmsService` 与 `EasySmsProviderOperationalState`
- `src/providers/` & `src/activation-providers/`：免费公有池抓取源与付费激活源 `hero_sms`
