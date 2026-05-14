# Architecture

`EasySms` is a single-repository monorepo that separates operator-facing layers
by responsibility rather than by historical workspace boundaries.

## Top-Level Structure

- `service/base`
  - canonical EasySMS HTTP runtime
  - provider adapters, health logic, runtime config loading, and persistence
- `runtimes/userscript`
  - browser-side operator runtime for direct page interaction
- `deploy/service/base`
  - Dockerfile, compose, entrypoint, smoke, and publish helpers
- `scripts`
  - root operator entrypoints that read `config.yaml` and drive the lower-level
    deploy/runtime assets
- `docs`
  - onboarding, architecture, workflow, and release guidance

## Ownership Contract

- `service/base` owns the product behavior and HTTP API.
- `deploy/service/base` owns container packaging and runtime orchestration.
- `runtimes/userscript` owns browser-native helper behavior.
- root `scripts/` own the operator ergonomics and central config handling.

## Provider Contract

- Providers are the first-class integration boundary.
- Free vs paid is modeled as provider metadata via `costTier`, not as a
  separate architecture layer.
- Public directory/inbox providers and activation-capable providers can expose
  different capabilities while still living in the same provider catalog.
- Clients can filter the unified catalog by `costTier` or `capability` instead
  of switching to a different provider namespace.

## External API Contract

- Native routes and compatibility routes both terminate in the same service
  layer.
- `POST /sms/sessions/open` is now the canonical one-stop native entrypoint.
- `POST /sms/sessions/plan` is the native non-mutating planning entrypoint.
- `GET /stubs/handler_api.php?action=...` is the canonical compatibility facade
  for HeroSMS or SMS-Activate style clients.
- Free providers with readable public inboxes now participate in activation
  flows through synthetic activation sessions, so callers do not need to know
  whether the resolved backend is a paid API or a public inbox poller.
- The formal machine-readable contract is exposed at `GET /openapi.json`.
- Older primitive routes such as `/sms/public-numbers` and `/sms/activations`
  remain available as compatibility and low-level inspection surfaces, not as
  the preferred public integration layer.

## Migration Contract

- `SMSService` remains a read-only reference workspace.
- forward development should happen only in `EasySms`
- copy-only migration means the new repo may reshape assets internally, but it
  must not modify or delete files in the legacy workspace
