# Configuration

`EasySms` uses one root operator config:

- `config.example.yaml`
- `config.yaml`

All root scripts read this file and derive lower-level runtime files from it.

## Root Sections

### `userscript`

Controls browser runtime generation:

- `sourcePath`
- `outputPath`
- `copyToClipboard`
- `defaults`

`defaults` maps directly onto the `DEFAULTS` object embedded in
`runtimes/userscript/easy_sms_proxy.user.js`.

### `serviceBase`

Controls container/runtime defaults:

- `context`
- `dockerfile`
- `image`
- `hostPort`
- `containerName`
- `containerEnvironment`
- `runtime`

`runtime` is rendered to:

- `deploy/service/base/config/config.yaml`

`containerEnvironment` is rendered to:

- `deploy/service/base/config/runtime.env`

Within `serviceBase.runtime.providers`, the `heroSms` subsection controls one
concrete SMS provider whose `costTier` is `paid`:

- `enabled`
- `apiKey`
- `baseUrl`
- `defaultService`
- `defaultCountry`

At the API layer, free vs paid is not a separate architecture layer. It is a
provider attribute exposed as `costTier`, and callers can filter provider
catalog results with `costTier=free` or `costTier=paid`.

Free synthetic activation sessions do not require additional provider config.
They are derived from the enabled free providers that already support:

- `list-public-numbers`
- `read-public-inbox`

### `publishing.ghcr`

Holds publication metadata for GHCR-oriented workflows and manual publishing
flows.

### `publishing.r2Config`

Holds the blank-host/bootstrap distribution metadata used by:

- `scripts/upload-service-base-r2-config.ps1`
- `scripts/write-service-base-r2-bootstrap.ps1`
- `deploy-host.ps1 -ImportCode`

The canonical fields are:

- `enabled`
- `accountId`
- `bucket`
- `endpoint`
- `configObjectKey`
- `runtimeEnvObjectKey`
- `userscriptSettingsObjectKey`
- `manifestObjectKey`
- `uploadAccessKeyId`
- `uploadSecretAccessKey`
- `readAccessKeyId`
- `readSecretAccessKey`
- `importCodeOwnerPublicKey`
- `syncEnabled`
- `syncIntervalSeconds`

## Rendered Output

`scripts/render-derived-configs.ps1` and `scripts/render-derived-configs.py`
render:

- service runtime YAML to `deploy/service/base/config/config.yaml`
- service runtime env to `deploy/service/base/config/runtime.env`
- userscript defaults JSON to `.tmp/derived/userscript-defaults.json`
- a JSON summary of the loaded operator config to `.tmp/derived/config-summary.json`
