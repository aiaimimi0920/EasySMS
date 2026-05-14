# Quickstart

## 1. Initialize Local Config

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\init-config.ps1
```

That creates `config.yaml` from `config.example.yaml` if it does not already
exist.

## 2. Validate The Repo

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-all.ps1
```

This validates:

- root userscript generation
- `service/base` install, typecheck, test, and build
- Python config-render helper syntax

## 3. Generate A Local Userscript

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-userscript.ps1
```

## 4. Deploy The Service Runtime

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1
```

If you are treating the host as blank and want to pull from GHCR with a
bootstrap/import-code payload instead of editing `config.yaml` manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-host.ps1 `
  -NoBuild `
  -Pull `
  -Image ghcr.io/<owner>/easy-sms-service:<tag> `
  -ImportCode "<import-code>"
```

## 5. Smoke-Test An Isolated Instance

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-service-base-instance.ps1 -Cleanup
```

To validate secured mode without editing your main config, pass an API key and
the test script will render a temporary secured smoke config under `.tmp`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-service-base-instance.ps1 `
  -ApiKey "<api-key>" `
  -Cleanup
```

That secured-mode smoke checks:

- anonymous access to protected routes returns `401`
- authenticated access succeeds
- `/healthz` and `/openapi.json` remain anonymously accessible

If you want `onlinesim` to use the authenticated API path instead of relying on
the public free-number website view, set:

```yaml
serviceBase:
  runtime:
    providers:
      onlineSim:
        apiKey: "<onlinesim-api-key>"
```

If you want `receive_sms_free_cc` to read protected pages in `service/base`, set:

```yaml
serviceBase:
  runtime:
    providers:
      receiveSmsFreeCc:
        email: "<site-email>"
        password: "<site-password>"
```

If you want `receive_smss` to use the authenticated HTTP login path in
`service/base`, set:

```yaml
serviceBase:
  runtime:
    providers:
      receiveSmss:
        username: "<site-username>"
        password: "<site-password>"
```

`sms24` does not need site credentials. In `service/base`, it is treated as a
live number source only when the latest verification-like SMS is within the
last 30 minutes.

## 6. Query The Unified Provider Catalog

Free and paid are provider attributes, not separate API layers.

List every currently exposed provider:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18081/providers"
```

List only free providers:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18081/providers?costTier=free"
```

List only paid providers:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18081/providers?costTier=paid"
```

List providers that support activation sessions:

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18081/providers?capability=create-activation"
```

## 7. Fetch The Formal API Contract

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18081/openapi.json"
```

## 8. Plan Or Open A Session Through The Native One-Stop API

Plan without opening:

```powershell
$planBody = @{
  countryCode = "+1"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/sms/sessions/plan" `
  -ContentType "application/json" `
  -Body $planBody
```

Open the canonical session object:

```powershell
$openBody = @{
  countryCode = "+1"
  service = "otp"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/sms/sessions/open" `
  -ContentType "application/json" `
  -Body $openBody
```

Then read the projected code or messages:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/sms/sessions/<sessionId>/code"
```

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/sms/sessions/<sessionId>/messages"
```

## 9. Low-Level Activation API

Free providers with public inbox support now participate in the same activation
contract. If you omit `providerKey` and `costTier`, EasySms first tries to
reuse an eligible free business lease, then picks the best free provider, and
only considers paid-provider reuse or creation when the free route cannot
serve the request.

Example free or auto activation:

```powershell
$body = @{
  service = "otp"
  countryCode = "+1"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/sms/activations" `
  -ContentType "application/json" `
  -Body $body
```

When a paid provider such as `hero_sms` is enabled, create an activation
through the generic route:

```powershell
$body = @{
  providerKey = "hero_sms"
  service = "dr"
  selectionMode = "balanced"
  allowReuse = $true
  businessKey = "openai-bind"
  maxBindingsPerPhone = 3
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/sms/activations" `
  -ContentType "application/json" `
  -Body $body
```

If you want to keep the same paid lease within the same business, call the
same route again with the same `businessKey`. EasySms will only reuse that paid
lease when the business matches and the lease still has unused seats. If free
capacity still exists for the same business, the free route remains preferred.

Then poll status:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/sms/activations/<activationId>/status?providerKey=hero_sms"
```

For a full paid-provider smoke flow from root config:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-hero-sms-provider.ps1
```

To verify the refundable-cancel path, wait slightly longer than 2 minutes
before issuing the cancel action:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-hero-sms-provider.ps1 `
  -CreateActivation `
  -SelectionMode price-first `
  -WaitBeforeCancelSeconds 125
```

## 10. Use The HeroSMS-Compatible Facade

When you want an external client to speak a `HeroSMS` / `SMS-Activate` style
API instead of the native EasySms routes, use:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/stubs/handler_api.php?action=getCountries"
```

Example activation creation:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/stubs/handler_api.php?action=getNumberV2&service=dr&country=16&providerKey=hero_sms"
```

Example unified free-facade activation creation:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/stubs/handler_api.php?action=getNumberV2&providerKey=onlinesim&countryCode=%2B44"
```

## 11. Browser-Drive A Real Signup SMS Send With LeetCode.cn

When you want to validate whether a free provider can participate in a real
browser signup flow, use the LeetCode.cn smoke script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-leetcode-controlled-browser.ps1 -RemoteDebuggingPort 9224
```

Then run the delivery script in attach mode:

```powershell
node .\scripts\test-leetcode-signup-delivery.mjs http://127.0.0.1:18083 onlinesim 1 10 50 "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" attach:9224
```

The script will:

- fetch candidate numbers from EasySms
- open a synthetic session for the chosen number
- attach to the controllable Edge browser
- open `https://leetcode.cn/accounts/signup/?next=%2F`
- fill the selected phone number and click `获取验证码`
- poll the EasySms session for newly observed SMS messages

The JSON output separates:

- browser-side send state
- EasySms delivery polling results
- newly observed messages and extracted codes

This is a validation-only tool for provider testing. It is not used by the
runtime service path itself.
