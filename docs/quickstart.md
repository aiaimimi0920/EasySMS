# Quickstart

## 1. 本地校验与开发启动

```powershell
Copy-Item .\config.example.yaml .\config.yaml
powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1

Set-Location .\service\base
npm run dev
```

## 2. 通过 SpringBok 部署到 Cloudflare Workers

1. 生成秘密导入模板并在安全本地文件中填写实际密钥：
   ```powershell
   node .\scripts\export-sba-secrets-template.mjs
   ```
2. 在 SpringBok 控制台连接本仓库与 Cloudflare 账号，导入上述 `applicationSecrets` JSON，选择固定提交 SHA 预览并确认部署。
3. 部署成功后使用 `scripts/test-easysms-endpoint.ps1` 验证对外 HTTPS 服务可用性。
