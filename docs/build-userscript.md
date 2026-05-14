# Build Userscript

The preferred entrypoint is the root wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-userscript.ps1
```

That reads:

- `config.yaml`
- `runtimes/userscript/easy_sms_proxy.user.js`

and writes:

- `runtimes/userscript/easy_sms_proxy.local.user.js`

For validation-only output that should not touch your working runtime file:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-userscript.ps1
```
