# EasySms AI 接入指南（For AI Agents & Automated Workflows）

本文档专为**其他 AI 智能体（Coding Agent / 自动化工作流 / 注册与验证脚本）**编写，提供接入 `EasySms` 统一短信接码服务的完整协议契约、状态机规范、无损退款规则与零依赖调用模板。

---

## 1. 服务基础信息（Quick Facts）

- **线上生产 Base URL**：`https://sms.yamiyu.com`（若接入自建实例，请以环境变量 `EASYSMS_BASE_URL` 为准）
- **免鉴权公开自描述端点**：
  - 健康检查：`GET /healthz` → `{"status": "ok", "service": "easy-sms", ...}`
  - 完整 OpenAPI 3.1 契约：`GET /openapi.json`
  - 部署版本元信息：`GET /.well-known/easysms-release.json`
- **强制鉴权方式**（除上述 3 个公开端点外，其余所有接口均强制鉴权，缺失或错误返回 `HTTP 401`）：
  - **现代 REST 接口（推荐）**：HTTP Header `Authorization: Bearer <EASYSMS_API_KEY>`
  - **传统兼容接口（`/stubs/handler_api.php`）**：支持 `Authorization: Bearer <EASYSMS_API_KEY>` 或 URL Query `?api_key=<EASYSMS_API_KEY>`
- **本地密钥获取提示**（仅限部署机本地环境）：若在当前仓库工作区运行且用户已部署生产环境，可从环境变量 `EASYSMS_API_KEY` 读取密钥（**严禁将明文密钥硬编码写入代码仓库或打印到公开日志**）。

---

## 2. AI 调用五大铁律（Mandatory Rules）

1. **生产环境显式指定 `"costTier": "paid"`**：
   - 在 Cloudflare Workers 边缘运行环境下，免费网页源普遍对机房出口 IP 开启反爬拦截；在 `POST /sms/sessions/open` 中显式传 `"costTier": "paid"` 可跳过免费源探测，**约 `1 秒` 直接从 `hero_sms` 拿到独享真实手机号**。
2. **请求参数全部放在 JSON 顶层**：
   - `POST /sms/sessions/open` 与 `POST /sms/sessions/plan` 的字段（如 `costTier`、`service`、`countryCode`、`maxPrice` 等）**直接位于请求 JSON 根对象顶层**，不要嵌套在 `"input": {...}` 中。
3. **轮询查码间隔严格保持 `3 ~ 5 秒`**：
   - 调用 `GET /sms/sessions/{sessionId}/code` 等待短信到达时，每次轮询间隔 **`3 ~ 5 秒`**，总超时建议设为 **`90 ~ 180 秒`**。严禁毫秒级死循环轮询。
4. **严格遵守 2 分钟可退款取消窗口（零损耗省钱关键）**：
   - `paid` 独享号码在开号响应中会返回 `refundableCancelAvailableAtIso`（通常为开号后 **120 秒**）。
   - **若超时未收到短信，或目标网站提示该号码不可用**：必须等待当前时间 `>= refundableCancelAvailableAtIso`（且 `< leaseExpiresAtIso`）后，调用 `POST /sms/sessions/{sessionId}/actions` 发送 `{"action": "cancel"}`。此时响应中 `refundEligible: true`、`resultText: "ACCESS_CANCEL"`，上游将 **100% 全额退回本次号码费用**。
   - **若提前在 2 分钟内直接丢弃会话而不取消，或在错误时机遗漏取消**，可能导致扣费不退或占用租约。
5. **收码成功后主动闭环确认**：
   - 验证码校验通过后，调用 `POST /sms/sessions/{sessionId}/actions` 发送 `{"action": "complete"}`，并可调用 `POST /sms/sessions/report-outcome` 上报 `{"sessionId": "...", "success": true}`，帮助服务端持续优化各国/运营商选路权重。

---

## 3. 标准五步接码流程（REST Session API）

### Step 1：申请接码会话与手机号 — `POST /sms/sessions/open`

**请求示例**：
```http
POST /sms/sessions/open HTTP/1.1
Host: sms.yamiyu.com
Authorization: Bearer <EASYSMS_API_KEY>
Content-Type: application/json

{
  "costTier": "paid",
  "service": "dr",
  "selectionMode": "balanced",
  "businessKey": "my-signup-task",
  "allowReuse": false
}
```

**顶层请求字段说明**：

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `costTier` | `"paid" \| "free"` | 推荐填 `"paid"` | `"paid"` 直连 HeroSMS 独享真号（~1s）；省略则默认免费优先并自动降级付费 |
| `service` | `string` | 否（默认 `"dr"`） | 目标业务简码（兼容 SMS-Activate 标准码，常见：`dr`=OpenAI/ChatGPT，`go`=Google，`ds`=Discord，`tg`=Telegram，`wa`=WhatsApp，`ig`=Instagram，`tw`=X/Twitter，`ot`=任意通用短信） |
| `country` | `integer` | 否 | 上游国家数字 ID（如 `16`=英国，`73`=巴西，`187`=美国，`6`=印尼）；省略则按 `selectionMode` 自动优选 |
| `countryCode` | `string` | 否 | ISO 两位国家码（如 `"GB"`、`"US"`、`"BR"`），可替代 `country` |
| `selectionMode` | `string` | 否 | 自动选国/选运营商策略：`"balanced"`（默认，平衡成功率与低价）、`"price-first"`、`"success-first"`、`"stock-first"` |
| `maxPrice` | `number` | 否 | 单次激活最高价格上限（如 `0.30`） |
| `phoneBlacklist` | `string[]` | 否 | 需排除的手机号列表（如重试时传入上一次被目标站拒收的号码 `["+5513910009355"]`） |
| `businessKey` | `string` | 否 | 业务隔离标识（如 `"app-a"`）。当 `allowReuse: true` 时，不同 `businessKey` 可安全复用同一在租号码 |
| `allowReuse` | `boolean` | 否 | 是否允许跨不同 `businessKey` 复用已有活跃号码 |

**成功响应（`HTTP 200`）**：
```json
{
  "session": {
    "id": "sms_session_000001",
    "providerKey": "hero_sms",
    "providerDisplayName": "HeroSMS",
    "activationId": 900000000,
    "upstreamActivationId": 1160674013,
    "sessionMode": "paid-api",
    "costTier": "paid",
    "phoneNumber": "+5513910009355",
    "service": "dr",
    "countryId": 73,
    "countryName": "Brazil",
    "operator": "arqia",
    "activationCost": 0.0585,
    "selectionMode": "balanced",
    "businessKey": "my-signup-task",
    "refundableCancelAvailableAtIso": "2026-11-22T07:38:40.249Z",
    "leaseExpiresAtIso": "2026-11-22T07:56:40.249Z",
    "openedAtIso": "2026-11-22T07:36:40.249Z"
  }
}
```
> AI 提取字段：`session.id`（后续所有操作的主键）、`session.phoneNumber`（带 `+` 国际区号的完整手机号，填入目标网站发送验证码）、`session.refundableCancelAvailableAtIso`（最早可全额退款取消的 UTC 时间）。

---

### Step 2：轮询提取短信验证码 — `GET /sms/sessions/{sessionId}/code`

将 `session.phoneNumber` 填入目标网站触发发送短信后，每隔 **4 秒**调用一次：

```http
GET /sms/sessions/sms_session_000001/code HTTP/1.1
Host: sms.yamiyu.com
Authorization: Bearer <EASYSMS_API_KEY>
```

- **尚未收到短信时（`HTTP 200`）**：
  ```json
  {
    "code": {
      "sessionId": "sms_session_000001",
      "providerKey": "hero_sms",
      "source": "none",
      "candidates": []
    }
  }
  ```
- **收到验证码时（`HTTP 200`）**：
  ```json
  {
    "code": {
      "sessionId": "sms_session_000001",
      "providerKey": "hero_sms",
      "code": "849201",
      "source": "activation-status",
      "observedMessageId": "msg_000001",
      "candidates": ["849201"]
    }
  }
  ```
  > 若需读取完整短信原文（如包含链接或非纯数字口令），可调用 `GET /sms/sessions/{sessionId}/messages`。

---

### Step 3（可选）：同一号码请求接收下一条验证码

若目标业务需要二次收码或重发验证码，调用：
```http
POST /sms/sessions/sms_session_000001/actions HTTP/1.1
Host: sms.yamiyu.com
Authorization: Bearer <EASYSMS_API_KEY>
Content-Type: application/json

{
  "action": "request-code"
}
```

---

### Step 4：闭环结束会话（成功确认 或 无损退款取消）

- **分支 A — 验证码使用成功**：
  ```http
  POST /sms/sessions/sms_session_000001/actions HTTP/1.1
  Host: sms.yamiyu.com
  Authorization: Bearer <EASYSMS_API_KEY>
  Content-Type: application/json

  {
    "action": "complete"
  }
  ```
  并上报成功结果（推荐）：
  ```http
  POST /sms/sessions/report-outcome HTTP/1.1
  Host: sms.yamiyu.com
  Authorization: Bearer <EASYSMS_API_KEY>
  Content-Type: application/json

  {
    "sessionId": "sms_session_000001",
    "success": true,
    "detail": "OTP verified successfully"
  }
  ```

- **分支 B — 超时未收码或号码被目标站拒收（等待到达 `refundableCancelAvailableAtIso` 后取消退款）**：
  ```http
  POST /sms/sessions/sms_session_000001/actions HTTP/1.1
  Host: sms.yamiyu.com
  Authorization: Bearer <EASYSMS_API_KEY>
  Content-Type: application/json

  {
    "action": "cancel"
  }
  ```
  响应中返回 `"resultText": "ACCESS_CANCEL"` 且 `"refundEligible": true` 即代表退款成功。

---

## 4. 开箱即用客户端代码模板（可直接复制到下游项目）

### 4.1 Python 标准库零依赖模板

```python
from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any


class EasySmsClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_sec: float = 20.0,
    ) -> None:
        self.base_url = (base_url or os.environ.get("EASYSMS_BASE_URL") or "https://sms.yamiyu.com").rstrip("/")
        self.api_key = (api_key or os.environ.get("EASYSMS_API_KEY") or "").strip()
        if not self.api_key:
            raise ValueError("Missing EASYSMS_API_KEY environment variable.")
        self.timeout_sec = timeout_sec

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def open_session(
        self,
        service: str = "dr",
        cost_tier: str = "paid",
        country_code: str | None = None,
        max_price: float | None = None,
        phone_blacklist: list[str] | None = None,
        business_key: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "costTier": cost_tier,
            "service": service,
            "selectionMode": "balanced",
        }
        if country_code:
            payload["countryCode"] = country_code
        if max_price is not None:
            payload["maxPrice"] = max_price
        if phone_blacklist:
            payload["phoneBlacklist"] = phone_blacklist
        if business_key:
            payload["businessKey"] = business_key
        return self._request("POST", "/sms/sessions/open", payload)["session"]

    def wait_for_code(
        self,
        session_id: str,
        timeout_sec: float = 130.0,
        poll_interval_sec: float = 4.0,
    ) -> str | None:
        deadline = time.monotonic() + timeout_sec
        while time.monotonic() < deadline:
            res = self._request("GET", f"/sms/sessions/{session_id}/code")
            code = res.get("code", {}).get("code")
            if code:
                return str(code)
            time.sleep(max(3.0, poll_interval_sec))
        return None

    def complete_session(self, session_id: str) -> dict[str, Any]:
        act = self._request("POST", f"/sms/sessions/{session_id}/actions", {"action": "complete"})
        self._request("POST", "/sms/sessions/report-outcome", {"sessionId": session_id, "success": True})
        return act["result"]

    def refundable_cancel_session(self, session: dict[str, Any], failure_reason: str = "otp_timeout") -> dict[str, Any]:
        refundable_iso = session.get("refundableCancelAvailableAtIso")
        if refundable_iso:
            target_dt = dt.datetime.fromisoformat(refundable_iso.replace("Z", "+00:00"))
            wait_sec = (target_dt - dt.datetime.now(dt.timezone.utc)).total_seconds() + 1.0
            if 0 < wait_sec <= 130:
                time.sleep(wait_sec)
        session_id = session["id"]
        act = self._request("POST", f"/sms/sessions/{session_id}/actions", {"action": "cancel"})
        self._request(
            "POST",
            "/sms/sessions/report-outcome",
            {"sessionId": session_id, "success": False, "failureReason": failure_reason},
        )
        return act["result"]
```

### 4.2 TypeScript / Node.js 18+（标准 `fetch`）模板

```ts
export interface EasySmsSession {
  id: string;
  phoneNumber: string;
  providerKey: string;
  costTier: "free" | "paid";
  refundableCancelAvailableAtIso?: string;
  leaseExpiresAtIso?: string;
}

export class EasySmsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EASYSMS_BASE_URL ?? "https://sms.yamiyu.com").replace(/\/+$/, "");
    this.apiKey = (options.apiKey ?? process.env.EASYSMS_API_KEY ?? "").trim();
    if (!this.apiKey) {
      throw new Error("Missing EASYSMS_API_KEY.");
    }
  }

  private async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`EasySms HTTP ${res.status}: ${JSON.stringify(data)}`);
    }
    return data as T;
  }

  async openSession(params: {
    service?: string;
    costTier?: "paid" | "free";
    countryCode?: string;
    maxPrice?: number;
    phoneBlacklist?: string[];
    businessKey?: string;
  } = {}): Promise<EasySmsSession> {
    const res = await this.request<{ session: EasySmsSession }>("POST", "/sms/sessions/open", {
      costTier: params.costTier ?? "paid",
      service: params.service ?? "dr",
      selectionMode: "balanced",
      ...params,
    });
    return res.session;
  }

  async waitForCode(sessionId: string, timeoutMs = 130_000, pollIntervalMs = 4_000): Promise<string | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.request<{ code: { code?: string } }>("GET", `/sms/sessions/${encodeURIComponent(sessionId)}/code`);
      if (res.code.code) {
        return res.code.code;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(3_000, pollIntervalMs)));
    }
    return undefined;
  }

  async completeSession(sessionId: string): Promise<void> {
    await this.request("POST", `/sms/sessions/${encodeURIComponent(sessionId)}/actions`, { action: "complete" });
    await this.request("POST", "/sms/sessions/report-outcome", { sessionId, success: true });
  }

  async refundableCancelSession(session: EasySmsSession, failureReason = "otp_timeout"): Promise<void> {
    if (session.refundableCancelAvailableAtIso) {
      const waitMs = Date.parse(session.refundableCancelAvailableAtIso) - Date.now() + 1_000;
      if (waitMs > 0 && waitMs <= 130_000) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    await this.request("POST", `/sms/sessions/${encodeURIComponent(session.id)}/actions`, { action: "cancel" });
    await this.request("POST", "/sms/sessions/report-outcome", {
      sessionId: session.id,
      success: false,
      failureReason,
    });
  }
}
```

---

## 5. 传统 SMS-Activate / HeroSMS 兼容模式（零改代码接入已有工具）

如果下游项目已集成了标准 SMS-Activate / HeroSMS SDK，无需改写为新接口，直接将 SDK 配置指向：

- **API Base URL**：`https://sms.yamiyu.com/stubs/handler_api.php`（或基础域名 `https://sms.yamiyu.com`）
- **API Key**：`<EASYSMS_API_KEY>`

已完整兼容的 `action` 列表（推荐附加 `&costTier=paid` 走付费独享通道）：
- `GET /stubs/handler_api.php?api_key=<KEY>&action=getNumberV2&service=dr&costTier=paid` → 返回含 `activationId` 与 `phoneNumber` 的 JSON
- `GET /stubs/handler_api.php?api_key=<KEY>&action=getStatus&id=<activationId>` → 返回纯文本 `STATUS_WAIT_CODE` / `STATUS_OK:<验证码>` / `STATUS_CANCEL`
- `GET /stubs/handler_api.php?api_key=<KEY>&action=getStatusV2&id=<activationId>` → 返回结构化 JSON 状态
- `GET /stubs/handler_api.php?api_key=<KEY>&action=setStatus&id=<activationId>&status=6` → 更新状态（`3`=请求下一条验证码，`6`=完成激活，`8`=取消激活并退款）
- `GET /stubs/handler_api.php?api_key=<KEY>&action=getCountries&costTier=paid` / `getPrices&service=dr&costTier=paid` / `getTopCountriesByService&service=dr&costTier=paid`

---

## 6. 运维诊断与可观测接口（供 AI 排查异常）

当遇到取号失败或需要查看当前服务状态时，AI 可调用以下只读诊断接口（需携带 `Bearer <EASYSMS_API_KEY>`）：

- `GET /providers/health`：查看所有通道当前的实时健康状态（`active` / `cooling` / `temporarily_disabled`）及最近失败原因。
- `GET /sms/query/stats`：查看全局会话统计、收码成功率与持久化状态。
- `GET /sms/query/sessions?limit=20&newestFirst=true`：查询最近的接码会话列表与生命周期状态。
- `GET /providers/hero_sms/top-countries?service=dr&ranked=true`：查看指定业务在 HeroSMS 上的实时库存、价格与成功率排名。

### 常见 HTTP 错误码处理决策表

| HTTP 状态码 | 含义 | AI 推荐处理动作 |
| --- | --- | --- |
| `400` | 请求参数格式不合法 | 检查参数是否放在 JSON 顶层、`costTier` 是否为 `"paid"`/`"free"`、`country` 是否为整数 |
| `401` | 缺少或错误的 `EASYSMS_API_KEY` | **立即停止重试**，检查环境变量 `EASYSMS_API_KEY` 是否正确注入 |
| `404` | 会话 ID 不存在或路径错误 | 核对 `sessionId` 是否拼写正确，或读取 `/openapi.json` 校验路由路径 |
| `502` / `503` | 上游暂时无可用号码库存或网络波动 | 放宽 `country` / `maxPrice` 限制，退避 `3 ~ 5 秒` 后重试（最多 3 次） |
