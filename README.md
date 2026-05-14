# EasySms

EasySms is the public monorepo entrypoint for the EasySms ecosystem.

It contains:

- `service/base`: the local EasySMS HTTP runtime
- `runtimes/userscript`: the browser-side userscript runtime
- `deploy`: deployment templates and operational scripts
- `docs`: repository-level architecture, quickstart, and workflow guidance

This repository intentionally avoids submodules. External contributors only need
one repository checkout and one root operator config.

## Development Workflow

See `docs/development-workflow.md` for the shared cross-repository development
rules used for copy-only migration, local-first validation, and final release
checks.

## Toolchain

- Node.js `20+` is the minimum supported version across the repo.
- Python 3.10+ is required for config rendering helpers.
- The repository root includes `.nvmrc` and `.node-version` to pin the shared
  baseline.

## Repository Layout

```text
service/
  base/
runtimes/
  userscript/
deploy/
  service/
    base/
docs/
scripts/
```

## Module Roles

### `service/base`

The local service runtime. This is the main EasySms control plane that owns:

- provider catalog and provider defaults
- HTTP API surface
- session-first one-stop SMS workflow API
- public number and inbox aggregation
- optional paid-provider activation flows such as `HeroSMS`
- optional `HeroSMS` / `SMS-Activate` style compatibility facade for activation clients
- paid `HeroSMS` flows now support strategy-based country/operator selection, lease reuse for the same business, and refundable-cancel timing metadata
- provider health, cooldown, and operational state
- runtime bootstrap and persistence loops

### `runtimes/userscript`

The browser-side EasySMS runtime. It is a browser-native operator helper, not a
thin bridge that requires `service/base` to be online.

## Quick Start

### Local service runtime

The repository root includes a host-facing one-click deploy wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1
```

That wrapper now supports both:

- local repo deploys with `config.yaml`
- blank-host GHCR + bootstrap deploys with `-ImportCode` or `-BootstrapFile`

Example blank-host style path:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1 `
  -NoBuild `
  -Pull `
  -Image ghcr.io/<owner>/easy-sms-service:<tag> `
  -ImportCode "<import-code>"
```

If you want the repository to automate the hosted artifact download, import-code
decrypt, blank-host deploy, verification, and optional cleanup in one step, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-blank-host-release-smoke.ps1 `
  -RunId <successful-publish-run-id> `
  -PrivateKeyPath .\owner-private-key.txt
```

If you want the lower-level entrypoint directly:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-service-base.ps1
```

And if you only want the package-level runtime checks:

```powershell
Set-Location service/base
npm install
npm run typecheck
npm run test
npm run build
```

### Browser userscript runtime

Generate a local userscript directly from the root `config.yaml`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-userscript.ps1
```

Validation writes generated output under `.tmp/` so it does not overwrite your
working userscript file.

## Documentation

- `docs/architecture.md`
- `docs/api-contract.md`
- `docs/tech-stack.md`
- `docs/quickstart.md`
- `docs/userscript-parity-matrix.md`
- `docs/userscript-live-smoke.md`
- `docs/configuration.md`
- `docs/build-service-base-image.md`
- `docs/build-userscript.md`
- `docs/easysms-release-workflow.md`
- `docs/github-actions-secrets.md`
- `docs/hosted-release-readiness.md`
- `docs/root-host-deploy-standard.md`
- `docs/development-workflow.md`

GitHub Actions automation lives under `.github/workflows/`:

- `validate.yml`
- `publish-service-base-ghcr.yml`

## Operator Scripts

- `deploy-host.ps1`
- `scripts/init-config.ps1`
- `scripts/decrypt-import-code.ps1`
- `scripts/run-blank-host-release-smoke.ps1`
- `scripts/render-derived-configs.ps1`
- `scripts/materialize-action-config.py`
- `scripts/compile-userscript.ps1`
- `scripts/validate-userscript.ps1`
- `scripts/compile-service-base-image.ps1`
- `scripts/deploy-service-base.ps1`
- `scripts/write-service-base-r2-bootstrap.ps1`
- `scripts/upload-service-base-r2-config.ps1`
- `scripts/easysms-import-code.py`
- `scripts/remove-service-base.ps1`
- `scripts/test-service-base-instance.ps1`
- `scripts/test-hero-sms-provider.ps1`
- `scripts/start-leetcode-controlled-browser.ps1`
- `scripts/test-leetcode-signup-delivery.mjs`
- `scripts/test-all.ps1`

## Shared Config

Copy `config.example.yaml` to `config.yaml` before running the operator scripts.
The root `config.yaml` is the single source of operator-managed settings for:

- userscript generation
- service/base image and container defaults
- the rendered `deploy/service/base/config/config.yaml`
- the rendered `deploy/service/base/config/runtime.env`
- optional paid-provider credentials and defaults such as `providers.heroSms`
- GHCR publication metadata
- R2/bootstrap/import-code distribution metadata

For the current default free providers:

- `providers.onlineSim.apiKey` is the canonical authenticated path for `onlinesim`
  in `service/base`
- `providers.receiveSmss.username/password` is the canonical authenticated path
  for `receive_smss` in `service/base`
- `providers.receiveSmsFreeCc.email/password` is the canonical authenticated path
  for protected `receive_sms_free_cc` pages
- `sms24` is also supported in `service/base` via a pure HTTP,
  curl_cffi-backed fetch path with the same 30-minute verification freshness rule

For repository validation, `scripts/validate-userscript.ps1` uses
`config.example.yaml` and writes generated output under `.tmp/`.

## Security Notes

- Do not commit local deployment config, state, or generated userscript files.
- Do not commit live API tokens, provider cookies, or operator-only overrides.
- Legacy `SMSService` remains reference-only and should not be modified as part
  of forward development in this new monorepo.
