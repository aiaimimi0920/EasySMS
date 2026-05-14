# GitHub Actions Secrets

This repository uses GitHub repository secrets for hosted deployment. Do not
commit these values into source files.

Add them in GitHub at:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

Fork users must add the same secret names to their own fork if they want to run
hosted deployment there. Secret values do not transfer to forks.

## Supported Secret Mode

`publish-service-base-ghcr.yml` uses only the granular `EASYSMS_*` secret set.

Each secret maps to one field or one list, so operators can fill the GitHub
Actions secret screen item by item instead of maintaining a large YAML blob.

## Multi-Line Support

GitHub Actions secrets support multi-line values. That matters for list-style or
YAML/JSON secrets such as:

- `EASYSMS_PROVIDER_ENABLED_PROVIDERS`
- `EASYSMS_USERSCRIPT_SELECTED_PROVIDERS`
- `EASYSMS_SERVICE_CONTAINER_ENVIRONMENT`

For list-style secrets, this repository accepts either:

- a YAML or JSON array
- one item per line
- a single comma-separated line

## Common Service/Base Runtime Secrets

| Secret name | Purpose |
| --- | --- |
| `EASYSMS_SERVICE_RUNTIME_API_KEY` | `serviceBase.runtime.server.apiKey` |
| `EASYSMS_PROVIDER_ENABLED_PROVIDERS` | Override `serviceBase.runtime.providers.enabledProviders` |
| `EASYSMS_PROVIDER_ONLINESIM_API_KEY` | `providers.onlineSim.apiKey` |
| `EASYSMS_PROVIDER_SMSTOME_EMAIL` | `providers.smsToMe.email` |
| `EASYSMS_PROVIDER_SMSTOME_PASSWORD` | `providers.smsToMe.password` |
| `EASYSMS_PROVIDER_RECEIVE_SMSS_USERNAME` | `providers.receiveSmss.username` |
| `EASYSMS_PROVIDER_RECEIVE_SMSS_PASSWORD` | `providers.receiveSmss.password` |
| `EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_EMAIL` | `providers.receiveSmsFreeCc.email` |
| `EASYSMS_PROVIDER_RECEIVE_SMS_FREE_CC_PASSWORD` | `providers.receiveSmsFreeCc.password` |
| `EASYSMS_PROVIDER_HERO_SMS_ENABLED` | `providers.heroSms.enabled` |
| `EASYSMS_PROVIDER_HERO_SMS_API_KEY` | `providers.heroSms.apiKey` |
| `EASYSMS_PROVIDER_HERO_SMS_BASE_URL` | `providers.heroSms.baseUrl` |
| `EASYSMS_PROVIDER_HERO_SMS_DEFAULT_SERVICE` | `providers.heroSms.defaultService` |
| `EASYSMS_PROVIDER_HERO_SMS_DEFAULT_COUNTRY` | `providers.heroSms.defaultCountry` |
| `EASYSMS_PROVIDER_HERO_SMS_SELECTION_MODE` | `providers.heroSms.selectionMode` |
| `EASYSMS_PROVIDER_HERO_SMS_REUSE_ENABLED` | `providers.heroSms.reuseEnabled` |
| `EASYSMS_PROVIDER_HERO_SMS_DEFAULT_MAX_BINDINGS_PER_PHONE` | `providers.heroSms.defaultMaxBindingsPerPhone` |
| `EASYSMS_PROVIDER_HERO_SMS_REFUNDABLE_CANCEL_WINDOW_SECONDS` | `providers.heroSms.refundableCancelWindowSeconds` |
| `EASYSMS_PROVIDER_HERO_SMS_LEASE_WINDOW_SECONDS` | `providers.heroSms.leaseWindowSeconds` |

## Common Userscript Secrets

| Secret name | Purpose |
| --- | --- |
| `EASYSMS_USERSCRIPT_PROVIDER_MODE` | `userscript.defaults.providerMode` |
| `EASYSMS_USERSCRIPT_EXPLICIT_PROVIDER_KEY` | `userscript.defaults.explicitProviderKey` |
| `EASYSMS_USERSCRIPT_SELECTED_PROVIDERS` | `userscript.defaults.selectedProvidersCsv` |
| `EASYSMS_USERSCRIPT_ONLINESIM_API_KEY` | `userscript.defaults.onlineSimApiKey` |
| `EASYSMS_USERSCRIPT_SMSTOME_EMAIL` | `userscript.defaults.smsToMeEmail` |
| `EASYSMS_USERSCRIPT_SMSTOME_PASSWORD` | `userscript.defaults.smsToMePassword` |
| `EASYSMS_USERSCRIPT_RECEIVE_SMSS_USERNAME` | `userscript.defaults.receiveSmssUsername` |
| `EASYSMS_USERSCRIPT_RECEIVE_SMSS_PASSWORD` | `userscript.defaults.receiveSmssPassword` |
| `EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_EMAIL` | `userscript.defaults.receiveSmsFreeCcEmail` |
| `EASYSMS_USERSCRIPT_RECEIVE_SMS_FREE_CC_PASSWORD` | `userscript.defaults.receiveSmsFreeCcPassword` |
| `EASYSMS_USERSCRIPT_HERO_SMS_API_KEY` | `userscript.defaults.heroSmsApiKey` |
| `EASYSMS_USERSCRIPT_HERO_SMS_BASE_URL` | `userscript.defaults.heroSmsBaseUrl` |
| `EASYSMS_USERSCRIPT_HERO_SMS_SERVICE` | `userscript.defaults.heroSmsService` |
| `EASYSMS_USERSCRIPT_HERO_SMS_COUNTRY` | `userscript.defaults.heroSmsCountry` |
| `EASYSMS_USERSCRIPT_HERO_SMS_OPERATOR` | `userscript.defaults.heroSmsOperator` |
| `EASYSMS_USERSCRIPT_HERO_SMS_SELECTION_MODE` | `userscript.defaults.heroSmsSelectionMode` |
| `EASYSMS_USERSCRIPT_HERO_SMS_ALLOW_REUSE` | `userscript.defaults.heroSmsAllowReuse` |
| `EASYSMS_USERSCRIPT_HERO_SMS_BUSINESS_KEY` | `userscript.defaults.heroSmsBusinessKey` |
| `EASYSMS_USERSCRIPT_HERO_SMS_MAX_BINDINGS_PER_PHONE` | `userscript.defaults.heroSmsMaxBindingsPerPhone` |

## R2 / Import-Code Distribution Secrets

| Secret name | Purpose |
| --- | --- |
| `EASYSMS_R2_CONFIG_ACCOUNT_ID` | Cloudflare account id |
| `EASYSMS_R2_CONFIG_BUCKET` | R2 bucket name |
| `EASYSMS_R2_CONFIG_ENDPOINT` | Optional custom endpoint override |
| `EASYSMS_R2_CONFIG_CONFIG_OBJECT_KEY` | Rendered runtime YAML object key |
| `EASYSMS_R2_CONFIG_ENV_OBJECT_KEY` | Rendered runtime env object key |
| `EASYSMS_R2_CONFIG_USERSCRIPT_OBJECT_KEY` | Userscript defaults object key |
| `EASYSMS_R2_CONFIG_MANIFEST_OBJECT_KEY` | Distribution manifest object key |
| `EASYSMS_R2_CONFIG_UPLOAD_ACCESS_KEY_ID` | Upload credential key id |
| `EASYSMS_R2_CONFIG_UPLOAD_SECRET_ACCESS_KEY` | Upload credential secret |
| `EASYSMS_R2_CONFIG_READ_ACCESS_KEY_ID` | Read-only credential key id for import-code consumers |
| `EASYSMS_R2_CONFIG_READ_SECRET_ACCESS_KEY` | Read-only credential secret for import-code consumers |
| `EASYSMS_R2_CONFIG_IMPORT_CODE_OWNER_PUBLIC_KEY` | Public key used to encrypt the owner import-code artifact |
| `EASYSMS_R2_CONFIG_SYNC_ENABLED` | Import-code bootstrap sync toggle |
| `EASYSMS_R2_CONFIG_SYNC_INTERVAL_SECONDS` | Import-code bootstrap sync interval |

## Optional GHCR Login Override Secrets

| Secret name | Purpose |
| --- | --- |
| `EASYSMS_PUBLISH_GHCR_USERNAME` | Override `github.actor` for GHCR login |
| `EASYSMS_PUBLISH_GHCR_TOKEN` | Override `GITHUB_TOKEN` for GHCR login |
