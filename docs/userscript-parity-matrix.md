# Userscript Parity Matrix

This document tracks whether each provider that exists in `service/base` also
has a corresponding browser-side implementation in
`runtimes/userscript/easy_sms_proxy.user.js`.

As of `2026-05-14`, the goal is:

- `service/base` remains the canonical main runtime
- `userscript` remains a subset/runtime companion
- any provider that is kept in the main runtime should also have a browser-side
  implementation unless there is a deliberate product reason not to

## Matrix

| Provider Key | Cost Tier | `service/base` | `userscript` | Parity Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `onlinesim` | `free` | yes | yes | aligned | Both runtimes use the same official API family and enforce the 20-minute verification freshness rule. |
| `smstome` | `free` | yes | yes | aligned | Both runtimes log in through `/sign-in`, solve the inline arithmetic captcha, and enforce the 30-minute rule. |
| `receive_smss` | `free` | yes | yes | aligned | Both runtimes support optional authenticated reads through `https://receive-smss.com/login/` and enforce the 30-minute rule. |
| `receive_sms_free_cc` | `free` | yes | yes | aligned | Both runtimes now support the login-enhanced flow: `/auth/login` bootstrap, `/ajax/login`, then gated page reads, plus the 30-minute rule. |
| `sms24` | `free` | yes | yes | aligned | Both runtimes expose the same public number / inbox flow and enforce the 30-minute verification freshness rule. |
| `yunduanxin` | `free` | yes | yes | aligned | Both runtimes expose the same list/inbox behavior and enforce the 30-minute verification freshness rule. |
| `hero_sms` | `paid` | yes | yes | aligned with deliberate UX difference | Both runtimes support paid activations, business-key reuse semantics, and cancel paths. `userscript` keeps it out of the default auto candidate list and recommends explicit mode. |

## Deliberate Differences

The current parity target is **behavioral parity**, not byte-for-byte runtime
identity. The following differences are intentional:

### `hero_sms`

- `service/base` can participate in generic free-first routing and paid fallback
- `userscript` exposes the same paid provider features but recommends:
  - `providerMode = explicit`
  - `explicitProviderKey = hero_sms`

This prevents accidental paid-number acquisition from the browser helper while
still keeping the paid implementation available.

## What Counts As Aligned

A provider is treated as aligned when both runtimes implement:

1. list-number acquisition
2. inbox/status reads
3. provider-specific auth requirements, if any
4. the same liveness/freshness rule
5. the same broad operator contract shape

That does **not** require the browser runtime to use the exact same transport
stack as `service/base`; for example, `userscript` is allowed to use page
requests and browser cookies where the main runtime uses `curl_cffi`.
