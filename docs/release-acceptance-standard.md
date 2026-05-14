# Release Acceptance Standard

## Scope

This document defines what it means for an EasySms public release to be
accepted as operationally complete.

The target is not only:

- "the code builds"
- or "the hosted publish job is green"

The target is a repeatable release chain that proves all of these layers:

1. local repository validation
2. hosted GHCR publication
3. R2 runtime-config and import-code distribution
4. blank-host-style deployment from a downloaded root `deploy-host.ps1`
5. provider catalog and provider health consistency at runtime

## Required Preconditions

1. All release-related changes must already be committed and pushed to the
   public GitHub repository.
2. The repository root validation must pass locally:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
   ```

3. GitHub repository secrets must already cover:
   - `EASYSMS_SERVICE_*`
   - `EASYSMS_PROVIDER_*`
   - `EASYSMS_USERSCRIPT_*`
   - `EASYSMS_R2_CONFIG_*`
   - optional `EASYSMS_PUBLISH_GHCR_*`
4. The owner private key for encrypted import-code artifacts must still be
   available locally.

## Required Hosted Workflow Evidence

An accepted release requires a successful run of:

- `Publish Service Base GHCR`

That run must prove:

1. image build smoke passed
2. secured smoke passed
3. GHCR push succeeded
4. published-image pull-back smoke succeeded
5. `service-base-r2-config-manifest` artifact exists
6. `service-base-import-code-encrypted` artifact exists

The matching `Validate` workflow for the current public `main` branch should
also be green so the repository state around the release helper/docs is not
drifting.

## Required Blank-Host Deployment Style

The canonical acceptance path is a blank-host-style deployment. That means:

1. use a brand-new empty working directory
2. do not manually clone the repository into that directory
3. use only the downloaded root `deploy-host.ps1` as the entrypoint
4. use the published GHCR image as the source of truth
5. use the encrypted import-code artifact from the hosted publish run
6. keep container name, compose project, and host port isolated from any
   existing local stacks

## Canonical Operator Helper

EasySms now ships a canonical operator helper for this exact rehearsal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-blank-host-release-smoke.ps1 `
  -PrivateKeyPath .\owner-private-key.txt
```

By default, the helper now:

1. finds the latest successful `Publish Service Base GHCR` run
2. downloads `service-base-import-code-encrypted`
3. decrypts the artifact into an import code
4. copies only `deploy-host.ps1` into a fresh temporary blank-host work dir
5. deploys from GHCR + import code
6. verifies:
   - `/healthz`
   - `/providers`
   - `/providers/health`
   - `/sms/catalog`
7. asserts provider key and provider count consistency across those routes
8. cleans up the temporary deployment by default

## Acceptance Success Condition

A release is considered accepted only when all of the following are true:

1. local `scripts/test-all.ps1` passes
2. the hosted `Publish Service Base GHCR` run succeeds
3. the hosted publish run emits:
   - `service-base-r2-config-manifest`
   - `service-base-import-code-encrypted`
4. the blank-host rehearsal succeeds from a downloaded `deploy-host.ps1`
5. the deployed runtime returns a healthy `/healthz`
6. provider keys match across:
   - `/providers`
   - `/providers/health`
   - `/sms/catalog`
7. `/healthz.providerCount` matches:
   - `/providers` count
   - `/providers/health.summary.totalProviders`

## Failure Classification

The release does **not** pass if the observed failure is caused by:

1. missing or stale GHCR publication
2. missing R2 config upload
3. missing encrypted import-code artifact
4. blank-host bootstrap failure
5. runtime config loading from the wrong path or wrong filesystem boundary
6. provider catalog and provider health summary drifting apart
7. helper scripts only working in a full local checkout instead of the
   canonical blank-host path

## Current Recorded Acceptance

### Acceptance Date

- `2026-05-14`

### Hosted Publish Evidence

- workflow: `Publish Service Base GHCR`
- run id: `25846012827`
- result: `success`
- release tag: `service-base-20260514-013`
- image:
  - `ghcr.io/aiaimimi0920/easy-sms-service:service-base-20260514-013`

### Repository Validation Evidence

- workflow: `Validate`
- run id: `25846972343`
- result: `success`

### Blank-Host Helper Evidence

The canonical helper was executed without passing `-RunId`, so it auto-resolved
the latest successful publish run and then completed the full blank-host flow.

Observed runtime result:

- resolved run id: `25846012827`
- resolved release tag: `service-base-20260514-013`
- provider count: `7`
- provider keys:
  - `onlinesim`
  - `smstome`
  - `receive_smss`
  - `receive_sms_free_cc`
  - `sms24`
  - `yunduanxin`
  - `hero_sms`

Provider consistency also matched across:

- `/providers`
- `/providers/health`
- `/sms/catalog`
- `/healthz`

This is the current canonical proof that EasySms has:

- a valid hosted release path
- a valid GHCR image
- valid R2/import-code distribution
- a valid blank-host deployment path
- and consistent provider metadata at runtime
