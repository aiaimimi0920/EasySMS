# Unusable Provider Blocklist

This is the temporary operator-facing table for providers that have already
been judged unusable and should **not** be re-added casually.

When a provider is declared unusable by manual validation:

1. remove it from the runtime provider list
2. delete the corresponding adapter code when it still exists
3. append a row here so later sweeps do not accidentally add it back

| Provider Key | Homepage | Decision Date | Reason | Code Status |
| --- | --- | --- | --- | --- |
| `freephonenum` | https://freephonenum.com | 2026-05-13 | Public numbers are stale; sampled inbox history included very old messages such as `2 years ago`, so it does not meet the current receive-flow standard. | already removed |
| `quackr` | https://quackr.io | 2026-05-13 | List-only under current conditions; `numbers.json` still lists numbers but inbox access is gated by verification/login and does not satisfy the current receive-flow standard. | removed |
| `temporary_phone_number` | https://temporary-phone-number.com | 2026-05-13 | Real browser inspection showed many numbers, but manual validation found the tested numbers could not actually receive new verification codes reliably, so it does not meet the current receive-flow standard. | removed |
| `temp_number` | https://temp-number.com | 2026-05-13 | Public free-number pages can be read manually in a browser, but the route behavior is Cloudflare-heavy and route-sensitive; there is no stable pure-HTTP path for the free pool that satisfies the current `service/base` standard. | removed |
| `receivesms_co` | https://www.receivesms.co/ | 2026-05-13 | Manual validation judged the provider unusable, so it no longer meets the current `service/base` receive-flow standard. | removed |
| `jiemahao` | https://jiemahao.com/ | 2026-05-13 | Manual validation judged the provider unusable because inbox access is challenge/gate protected, so it no longer meets the current `service/base` receive-flow standard. | removed |
| `oksms` | https://oksms.org | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `receivesms.org` | https://www.receivesms.org | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `tempsmsonline` | https://tempsmsonline.com | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `smsreceivefree` | https://smsreceivefree.com | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `disposablesms` | https://www.disposablesms.com | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `receive-sms-online.info` | https://receive-sms-online.info/ | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `smscodeonline` | https://smscodeonline.com/ | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `receivefreesms.net` | https://receivefreesms.net/ | 2026-05-13 | Manual validation judged the provider unusable. It does not meet the current `service/base` receive-flow standard and should not be re-added. | never integrated; blocklisted |
| `receive-sms.com` | https://receive-sms.com/ | 2026-05-13 | Manual validation judged the provider unusable for the current EasySms main-runtime standard and it should not be re-added. | never integrated; blocklisted |
