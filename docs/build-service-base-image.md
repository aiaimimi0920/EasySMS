# Build Service Base Image

Use the root wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-service-base-image.ps1
```

This reads the root `config.yaml`, renders the service runtime config, and then
builds:

- `deploy/service/base/Dockerfile`

You can override the target image name:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-service-base-image.ps1 -Image ghcr.io/example/easy-sms-service:test
```
