# Development Workflow

## 环境要求

- Node.js `22`（见 `.nvmrc`）
- Python `3.12` + `pyyaml`（用于本地配置渲染与发布契约检查）

## 常用命令

1. **初始化本地开发配置**：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\init-config.ps1
   ```
2. **执行全量验证（提交前必跑）**：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
   python .\scripts\validate-release-contract.py
   ```
3. **仅构建 Cloudflare Worker 产物**：
   ```powershell
   Set-Location .\service\base
   npm run build:worker
   ```
4. **单独运行 SBA 生命周期测试**：
   ```powershell
   node --test .\tests\sba\sba-lifecycle.test.mjs
   ```
