# EasySms Release Workflow

## Local Pre-Flight

Before publishing:

1. Run `scripts/test-all.ps1`
2. Run `scripts/test-service-base-instance.ps1 -Cleanup`
3. If HeroSMS is enabled for this release line, run `scripts/test-hero-sms-provider.ps1`
4. Confirm `deploy/service/base/Dockerfile` still builds cleanly

## GitHub Actions

The repository exposes two primary workflows:

- `validate.yml`
- `publish-service-base-ghcr.yml`

`publish-service-base-ghcr.yml` is the canonical hosted release path. It now:

1. materializes `config.yaml` from granular `EASYSMS_*` secrets
2. builds and smoke-tests the image
3. pushes the image to GHCR
4. re-pulls the published tag and re-runs smoke checks
5. uploads rendered runtime config, runtime env, and userscript defaults to R2
6. emits an encrypted owner import-code artifact for blank-host bootstrap

See also:

- `docs/github-actions-secrets.md`
- `docs/root-host-deploy-standard.md`

## Manual GHCR Publish

If you need a local manual path:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\service\base\publish-ghcr-easy-sms-service.ps1 -Owner <github-owner> -Tag <release-tag> -Push
```

## Blank-Host Deploy Contract

The hosted release chain is designed to pair with the root deploy entrypoint:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1 `
  -NoBuild `
  -Pull `
  -Image ghcr.io/<owner>/easy-sms-service:<release-tag> `
  -ImportCode "<import-code>"
```

That path is now the canonical “download one file, pull from GHCR, bootstrap
from R2” operator flow for EasySms.
