# EasySms Userscript Runtime

这个目录承载 `EasySms` monorepo 的浏览器侧 runtime。

主要文件：

- 模板脚本：
  - `runtimes/userscript/easy_sms_proxy.user.js`
- 本地覆盖示例：
  - `runtimes/userscript/easy_sms_proxy.secrets.example.json`
- 本地生成脚本：
  - `runtimes/userscript/generate_local_userscript.ps1`
- 本地生成结果：
  - `runtimes/userscript/easy_sms_proxy.local.user.js`

## 当前脚本定位

这个 userscript 现在是：

- 浏览器内运行的 `EasySMS` runtime

而不是：

- 调本地 `EasySMS` HTTP 服务的桥接器

它会直接在浏览器中访问公开短信站点，抓取手机号列表和短信内容，然后完成：

- 获取公开号码
- 读取短信收件箱
- 提取验证码
- 自动填充手机号 / 验证码
- 保存号码历史
- 在与 `EasyEmail` 并存时自动错开右侧按钮位置

当前模板内置 provider：

- `onlinesim`
- `smstome`
- `receive_smss`
- `receive_sms_free_cc`
- `yunduanxin`
- `sms24`
- `hero_sms`（默认不放入自动候选，建议显式模式使用）

其中：

- `onlinesim` 已在 2026-05-13 补齐 userscript 逻辑。它会优先走
  `providers.onlineSim.apiKey` 对应的官方 API key 路径；如果未配置 key，则继续走公开
  JSON API。
- `smstome` 已在 2026-05-13 补齐 userscript 逻辑。它会先访问 `/sign-in`，解析 `_token`、
  `csrf_v` 和页面内算术验证码，再在同一浏览器会话里抓国家页与号码页。
- `receive_smss` 已在 2026-05-13 补齐 userscript 逻辑。它会在配置了用户名/密码时先访问
  `https://receive-smss.com/login/`，再在同一浏览器会话里抓目录页与短信页。
- `receive_sms_free_cc` 已在 2026-05-13 确认可用；当前 `service/base` 也已经补齐
  纯 HTTP 登录 helper。userscript 现在也支持配置邮箱/密码，在命中 gate 时先访问
  `/auth/login`，再对 `/ajax/login` 提交 md5(password) 形式的登录载荷，然后继续抓目录页与号码页。
- `hero_sms` 已在 2026-05-13 补齐一条浏览器侧 paid provider 逻辑，但它和免费 provider 不同：
  只有在显式选择 `hero_sms` 时才建议使用；脚本会直接调用 HeroSMS API 取号、查码，并支持
  在当前号码上发起取消。

当前 userscript 会对 `onlinesim`、`smstome`、`receive_smss`、`receive_sms_free_cc`、
`sms24` 与 `yunduanxin` 应用 provider 对应的活性规则：

- `onlinesim`：最近验证码 <= 20 分钟
- 其他已接入 free provider：最近验证码 <= 30 分钟

## 推荐的本地调试方式

目标：

- 仓库里的模板脚本保持为可提交版本
- 本地仍然可以一键生成一份“带好默认覆盖、可直接导入 Tampermonkey”的 userscript

### 推荐入口：走根级 config.yaml

如果你希望和 `EasyEmail` 一样，从仓库根级统一管理默认设置，使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compile-userscript.ps1
```

这样会从根级 `config.yaml` 的 `userscript.defaults` 生成本地 userscript。

### 第一步：创建本地覆盖文件

复制：

- `easy_sms_proxy.secrets.example.json`

为：

- `easy_sms_proxy.secrets.local.json`

这个文件名沿用了之前的命名，但这里放的是“本地默认覆盖”，不一定是密钥。

### 第二步：生成本地 userscript

运行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\runtimes\userscript\generate_local_userscript.ps1"
```

生成结果：

- `runtimes/userscript/easy_sms_proxy.local.user.js`

### 第三步：如果你习惯“直接复制到浏览器”

运行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\runtimes\userscript\generate_local_userscript.ps1" -CopyToClipboard
```

这样会：

- 生成本地 userscript
- 同时把完整脚本内容直接放进剪贴板

## 本地覆盖字段说明

本地覆盖文件当前支持这些常用字段：

- `providerMode`
- `explicitProviderKey`
- `selectedProvidersCsv`
- `countryName`
- `countryCode`
- `overallLimit`
- `pollSeconds`
- `timeoutSeconds`
- `senderContains`
- `onlineSimApiKey`
- `smsToMeEmail`
- `smsToMePassword`
- `receiveSmssUsername`
- `receiveSmssPassword`
- `receiveSmsFreeCcEmail`
- `receiveSmsFreeCcPassword`
- `heroSmsApiKey`
- `heroSmsBaseUrl`
- `heroSmsService`
- `heroSmsCountry`
- `heroSmsOperator`
- `heroSmsSelectionMode`
- `heroSmsAllowReuse`
- `heroSmsBusinessKey`
- `heroSmsMaxBindingsPerPhone`
- `smsToMePassword`

说明：

- `providerMode` 可选 `auto` 或 `explicit`
- `selectedProvidersCsv` 仅在 `auto` 模式下生效
- `countryName` / `countryCode` 会作为默认筛选条件

## 进一步文档

- `docs/userscript-parity-matrix.md`
- `docs/userscript-live-smoke.md`

## 当前 UI 说明

- 默认只显示右侧三个小按钮：`设 / 号 / 码`
- `设` 用来展开或收起主面板
- `号` 用来直接获取并填手机号
- `码` 用来轮询并填验证码
- 如果同页存在 `EasyEmail` 的迷你栏，当前脚本会自动把自己的按钮栏向左错开

展开主面板后，现在顶部还会额外显示：

- 当前运行模式：
  - `AUTO`
  - `EXPLICIT`
- 当前 provider tier：
  - `FREE`
  - `PAID`
- 当前 provider key

并且有一条快速切换区：

- `自动模式`
- `指定模式`
- provider 快速下拉

如果当前 provider 是 `hero_sms`：

- 顶部会显示明显的 `PAID` 状态
- 摘要卡会显示租约席位、业务键、费用、退款取消窗口、租约到期时间
- 到达退款窗口后，按钮文案会变成：
  - `退款取消当前号`
