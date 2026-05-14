# API Contract

`EasySms` now exposes one canonical native API face plus one compatibility
facade over the same provider-centric runtime:

- native EasySms session-first API
- HeroSMS or SMS-Activate style compatibility facade

The canonical machine-readable contract is served by the runtime itself:

- `GET /openapi.json`

## Native Contract

The canonical external contract is now session-centric, modeled after the
one-stop API shape used by `EasyEmail`.

Preferred public routes:

- `GET /sms/catalog`
- `GET /sms/snapshot`
- `POST /sms/sessions/plan`
- `POST /sms/sessions/open`
- `POST /sms/sessions/recover-by-phone`
- `POST /sms/sessions/report-outcome`
- `POST /sms/messages/observe`
- `GET /sms/sessions/{sessionId}/status`
- `GET /sms/sessions/{sessionId}/code`
- `GET /sms/sessions/{sessionId}/messages`
- `POST /sms/sessions/{sessionId}/actions`

Key properties:

- sessions are the first-class external business object
- providers remain the internal integration boundary
- `costTier` is metadata, not an API layer split
- callers can still constrain routing by `providerKey`, `costTier`, `countryCode`, `countryName`, or `numberId`
- open requests can target free, paid, or auto-selection flows without changing route shape
- auto-selection is free-first by default; paid providers only enter the candidate set when the free route has no suitable option, unless the caller explicitly asks for `costTier=paid` or `providerKey=hero_sms`

`GET /sms/snapshot` now supports:

- `mode=summary` (default)
- `mode=detail`

The summary mode is intended for regular operator polling. Detail mode adds:

- `sessions`
- `observedMessages`
- `projectedMessages`

The public snapshot no longer duplicates those collections inside `runtimeState`.
It also keeps `runtimeState.probeHistory` detail-only so regular summary polling
does not carry the full probe-history payload.

## Low-Level Native Compatibility Surface

The previous lower-level routes remain available for compatibility and
inspection:

- `GET /providers`
- `GET /sms/public-numbers`
- `GET /sms/inbox`
- `POST /sms/activations`
- `GET /sms/activations/{activationId}/status`
- `POST /sms/activations/{activationId}/actions`

## Query Surface

The session-centric query routes now expose:

- `GET /sms/query/providers`
- `GET /sms/query/runtime`
- `GET /sms/query/providers/health`
- `GET /sms/query/providers/probe-history`
- `GET /sms/query/providers/selection-plan`
- `GET /sms/query/sessions`
- `GET /sms/query/sessions/{sessionId}`
- `GET /sms/query/messages`
- `GET /sms/query/messages/{messageId}`
- `GET /sms/query/stats`

`GET /sms/query/messages` is a **unified message view** by default:

- cached provider-projected messages are included
- manual `observe` messages are included
- cache-first observability is the default; the query surface does not live-fetch provider inboxes or activation status unless asked to do so

Optional query flags can narrow the view:

- `includeProjected=false`
- `includeManual=false`
- `refreshProjected=true`

Long-running query surfaces now also support time-window style filtering where relevant:

- `since`
- `until`

Additional native filters are available for:

- sessions: `service`, `countryCode`, `countryName`, `hasCode`, `hasOutcome`
- messages: `sourceType`
- provider probe history: `routeKind`, `healthState`, `limit`, `newestFirst`

`GET /sms/query/runtime` now exposes canonical background-loop diagnostics for:

- maintenance loop
- active probe loop
- persistence loop
- persisted state load status

Provider observability routes now support lightweight shaping:

- `GET /sms/query/providers/health?mode=summary`
- `GET /sms/query/providers/probe-history?mode=summary`

In summary mode, both routes default to the smallest response envelope and only
add arrays when the corresponding include flags are explicitly enabled.

and explicit include flags where needed:

- `includeProviders`
- `includeRoutes`
- `includeTrends`
- `includeHistory`

## Compatibility Contract

Compatibility route:

- `GET /stubs/handler_api.php?action=...`

Supported actions:

- `getCountries`
- `getPrices`
- `getTopCountriesByService`
- `getTopCountriesByServiceRank`
- `getOperators`
- `getNumberV2`
- `getStatus`
- `getStatusV2`
- `setStatus`

## Free-Provider Facade Behavior

Free providers with readable public inboxes now participate in the generic
activation contract through synthetic activation sessions.

For compatibility metadata actions, the facade now defaults to the free layer
first. Free sessions also carry a per-business seat model so a number can be
reused while its free business quota remains available. If the caller needs
paid-provider metadata instead, it should pass one of:

- `providerKey=hero_sms`
- `costTier=paid`

This means:

- `POST /sms/activations` can return a free-provider session
- `getNumberV2` can return a free-provider session through the compatibility facade
- `getStatus` and `getStatusV2` poll the mapped public inbox
- `setStatus` updates local synthetic session state without leaking provider-specific implementation details
- free sessions can be reused for the same `businessKey` until their seat quota is exhausted
- when a free route is unavailable, the runtime may fall back to a reusable HeroSMS lease for the same `businessKey` if one exists and still has remaining seats

## EasySms Facade Extensions

To keep the external contract stable while supporting both free and paid
providers, the unified activation input accepts a few EasySms-specific
extensions:

- `countryCode`
- `countryName`
- `numberId`
- `providerKey`
- `costTier`
- `businessKey`
- `maxBindingsPerPhone`
- `selectionMode`
- `allowReuse`

These are useful when the caller wants the HeroSMS-shaped facade but the
runtime should still resolve into the free public-inbox layer first. The same
business-scoped seat model is applied to both free virtual leases and paid
HeroSMS leases; the paid lease only becomes a candidate when its business key
matches and it still has available bindings.

When the caller uses compatibility metadata action `getOperators` against the
free facade, the returned operator values are projected provider keys. This lets
the caller keep speaking the HeroSMS-shaped contract while selecting a concrete
free provider through the `operator` field on `getNumberV2`.

The generic activation route follows this order when the caller does not force
`paid`:

1. reuse a matching free lease for the same `businessKey` if one still has seats
2. pick the best free candidate by the current cost/success/stock policy
3. if no free candidate exists, reuse a matching HeroSMS lease for the same `businessKey` if one still has seats
4. if no reusable lease exists, create a fresh paid `hero_sms` activation only when the caller explicitly requests paid or the route has no free answer
