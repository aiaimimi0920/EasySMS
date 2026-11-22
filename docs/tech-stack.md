# Tech Stack

- **Cloud Runtime**：Cloudflare Workers（ES2022 ESM 模块，零 Node 内置运行时依赖）
- **State & Backup Storage**：Cloudflare D1（`STATE_DB` SQLite 状态存储）+ 私有 Cloudflare R2（`BACKUP_STORE` AES-256-GCM 加密备份）
- **Deployment Control Plane**：SpringBok SBA（`manifest.json` v3 + `deployment.json` v2 + `.sba/springbok.mjs`）
- **Language & Bundler**：TypeScript 5.9 + `esbuild` + `cheerio`（HTML 解析）+ 标准 Web `fetch` / `crypto.subtle`
- **Testing**：Vitest 4（服务端与 Worker 单元/集成测试）+ Node `node:test`（SBA 五动作全生命周期离线模拟测试）+ Python `unittest`（配置与契约检查）
