# Userscript Live Smoke Guide

This guide is the canonical operator workflow for validating the browser-side
`EasySMS` runtime with real provider pages.

It assumes:

- you are working from the repository root
- `config.yaml` already contains your local defaults
- you will import the generated `easy_sms_proxy.local.user.js` into
  Tampermonkey (or another compatible userscript manager)

## 1. Generate A Local Userscript

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-userscript.ps1 -ConfigPath config.yaml
```

That generates:

- `runtimes/userscript/easy_sms_proxy.local.user.js`

This local file is allowed to contain your local provider defaults and secrets.
The template file stays clean.

## 2. Import The Local Script Into The Browser

Import:

- `runtimes/userscript/easy_sms_proxy.local.user.js`

Then open any page where you want the EasySMS mini-bar to appear.

The mini-bar actions are:

- `设` — expand/collapse the main panel
- `号` — acquire and optionally fill a phone number
- `码` — poll for OTP and optionally fill it

After you expand the main panel, first verify the new mode/status UI:

- a mode badge:
  - `AUTO`
  - `EXPLICIT`
- a tier badge:
  - `FREE`
  - `PAID`
- a quick-switch strip:
  - `自动模式`
  - `指定模式`
  - provider dropdown

## 3. Pick The Right Runtime Mode

### Auto mode

Use `providerMode = auto` when you want the browser helper to try the current
free-provider candidate set:

- `onlinesim`
- `smstome`
- `receive_smss`
- `receive_sms_free_cc`
- `sms24`
- `yunduanxin`

This is the normal free-first browser helper path.

### Explicit mode

Use `providerMode = explicit` when you want to pin one provider.

This is especially recommended for:

- `hero_sms`

## 4. Provider-Specific Smoke Checklist

### `onlinesim`

Required settings:

- optional: `onlineSimApiKey`

Smoke steps:

1. set `explicitProviderKey = onlinesim` or keep auto mode
2. click `号`
3. confirm a country-scoped primary number is acquired
4. click `读取一次` or `码`
5. confirm new inbox content appears

Expected rule:

- only numbers with verification-like activity within the last **20 minutes**
  are considered live

### `smstome`

Required settings:

- `smsToMeEmail`
- `smsToMePassword`

Smoke steps:

1. set `explicitProviderKey = smstome`
2. click `号`
3. confirm login succeeds and a number is acquired
4. click `读取一次`
5. confirm inbox rows appear

Expected rule:

- only numbers with verification-like activity within the last **30 minutes**
  are considered live

### `receive_smss`

Optional-but-recommended settings:

- `receiveSmssUsername`
- `receiveSmssPassword`

Smoke steps:

1. set `explicitProviderKey = receive_smss`
2. click `号`
3. confirm the script can open the number list
4. click `读取一次`
5. confirm inbox messages appear

Expected rule:

- only numbers with verification-like activity within the last **30 minutes**
  are considered live

### `receive_sms_free_cc`

Optional-but-recommended settings:

- `receiveSmsFreeCcEmail`
- `receiveSmsFreeCcPassword`

Use these when the target number page is gated.

Smoke steps:

1. set `explicitProviderKey = receive_sms_free_cc`
2. click `号`
3. confirm the script can resolve a country directory page
4. click `读取一次`
5. if the page is gated, confirm the script logs in through:
   - `/auth/login`
   - `/ajax/login`
6. confirm inbox messages appear

Expected rule:

- only numbers with verification-like activity within the last **30 minutes**
  are considered live

### `sms24`

No site credentials required.

Smoke steps:

1. set `explicitProviderKey = sms24`
2. click `号`
3. confirm a number is acquired
4. click `读取一次`
5. confirm inbox messages appear

Expected rule:

- only numbers with verification-like activity within the last **30 minutes**
  are considered live

### `yunduanxin`

No site credentials required.

Smoke steps:

1. set `explicitProviderKey = yunduanxin`
2. click `号`
3. confirm a number is acquired
4. click `读取一次`
5. confirm inbox messages appear

Expected rule:

- only numbers with verification-like activity within the last **30 minutes**
  are considered live

### `hero_sms`

Recommended mode:

- `providerMode = explicit`
- `explicitProviderKey = hero_sms`

Required settings:

- `heroSmsApiKey`

Recommended settings:

- `heroSmsService`
- `heroSmsCountry`
- `heroSmsSelectionMode`
- `heroSmsBusinessKey`
- `heroSmsMaxBindingsPerPhone`

Smoke steps:

1. set explicit mode to `hero_sms`
2. click `号`
3. confirm a paid number is acquired
4. confirm the summary panel shows:
   - lease seat usage
   - business key
   - activation cost
   - refundable cancel time or refund-ready status
   - lease expiry time
5. click `读取一次` or `码`
6. if the number is unusable and the refund window has passed, click:
   - `退款取消当前号`

Expected notes:

- `hero_sms` is implemented in the browser helper, but it is intentionally not
  part of the default automatic free candidate flow
- cancellation semantics are only meaningful for paid activations

## 5. End-To-End OTP Check

For a real-world smoke:

1. use the browser helper to acquire a number
2. send an OTP from the target site
3. click `读取一次` or `码`
4. confirm:
   - a new OTP appears
   - the code pill updates
   - copy/fill actions work

## 6. Validate The Repo Before Claiming Success

After userscript changes, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
```

This is the required verification gate before claiming the browser runtime is
fully updated.
