# Hosted Release Readiness

This checklist is the canonical operator handoff for taking the local
`EasySms` monorepo and validating the hosted publish path after the GitHub
repository has been updated to match the local checkout.

## 1. Repository shape on GitHub

Before touching GitHub Actions secrets, confirm the public repository already
contains the current EasySms monorepo layout:

- `service/`
- `runtimes/`
- `deploy/`
- `scripts/`
- root `config.example.yaml`
- root `deploy-host.ps1`
- `.github/workflows/publish-service-base-ghcr.yml`

If the public repository still shows the older `src/` / `tests/` / `index.ts`
layout, stop here and sync the repository content first.

## 2. Required Actions secrets

List the current workflow secret surface from the checked-in workflow:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\list-publish-workflow-secrets.ps1
```

That output must be reconciled against:

- `docs/github-actions-secrets.md`
- the real repository Actions secrets screen

The publish workflow expects these categories:

- `EASYSMS_SERVICE_*`
- `EASYSMS_PROVIDER_*`
- `EASYSMS_USERSCRIPT_*`
- `EASYSMS_R2_CONFIG_*`
- optional `EASYSMS_PUBLISH_GHCR_*`

## 3. Hosted publish rehearsal

Once the repository content and secrets are ready:

1. Trigger `publish-service-base-ghcr.yml` with `workflow_dispatch`
2. Leave `run_smoke=true`
3. Use a release-like tag override if needed

Expected hosted outputs:

- a GHCR image push
- a pull-back smoke verification
- a `service-base-r2-config-manifest` artifact
- a `service-base-import-code-encrypted` artifact

## 4. Blank-host validation

After the workflow succeeds:

1. Download `deploy-host.ps1`
2. Download the encrypted import-code artifact
3. Decrypt it locally with:

```powershell
python .\scripts\easysms-import-code.py decrypt `
  --encrypted-file .\service-base-import-code.encrypted.json `
  --private-key-file .\owner-private-key.txt `
  --import-code-only
```

4. Use the import code on a blank host:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1 `
  -NoBuild `
  -Pull `
  -Image ghcr.io/<owner>/easy-sms-service:<release-tag> `
  -ImportCode "<import-code>"
```

5. Validate:

- `/healthz`
- `/providers`
- secured smoke if an API key is configured

## 5. Current local proof points

The local repo already proves these preconditions:

- `scripts/test-all.ps1` passes
- operator script tests pass
- `deploy-host.ps1 -ResolveRepoOnly` works
- the bootstrap-aware Docker runtime image builds
- an isolated bootstrap-aware service smoke succeeds

So if hosted validation still fails after sync, the next place to look is:

- GitHub Actions secrets
- R2 permissions
- GHCR permissions
- the public repository contents being out of date
