// ==UserScript==
// @name         EasySMS Browser Runtime
// @namespace    local.easysms.runtime
// @version      0.2.0
// @description  Browser-native EasySMS runtime: fetch public phone numbers, read SMS inboxes, extract OTP, and fill forms.
// @match        *://*/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_PREFIX = "easysms.runtime.";
  const ROOT_ID = "esms-root";
  const PANEL_ID = "esms-panel";
  const MINI_BAR_ID = "esms-mini-bar";
  const MAX_HISTORY = 20;
  const DEFAULTS = {
    providerMode: "auto",
    explicitProviderKey: "onlinesim",
    selectedProvidersCsv: "onlinesim,smstome,receive_smss,receive_sms_free_cc,sms24,yunduanxin",
    countryName: "",
    countryCode: "",
    overallLimit: "8",
    pollSeconds: "5",
    timeoutSeconds: "180",
    senderContains: "",
    codeRegex: "(?:^|[^\\d])(\\d{4,8})(?!\\d)",
    newestFirst: "true",
    autoFillPhoneOnAcquire: "false",
    autoFillCodeOnRead: "false",
    forceFillNonEmpty: "false",
    highlightTargets: "false",
    onlineSimApiKey: "",
    smsToMeEmail: "",
    smsToMePassword: "",
    receiveSmssUsername: "",
    receiveSmssPassword: "",
    receiveSmsFreeCcEmail: "",
    receiveSmsFreeCcPassword: "",
    heroSmsApiKey: "",
    heroSmsBaseUrl: "https://hero-sms.com/stubs/handler_api.php",
    heroSmsService: "dr",
    heroSmsCountry: "16",
    heroSmsOperator: "",
    heroSmsSelectionMode: "balanced",
    heroSmsAllowReuse: "true",
    heroSmsBusinessKey: "default",
    heroSmsMaxBindingsPerPhone: "1",
  };

  const COUNTRY_CODE_HINTS = [
    { names: ["united states", "usa", "美国"], code: "+1" },
    { names: ["canada", "加拿大"], code: "+1" },
    { names: ["united kingdom", "great britain", "英国"], code: "+44" },
    { names: ["finland", "芬兰"], code: "+358" },
    { names: ["netherlands", "荷兰"], code: "+31" },
    { names: ["slovenia", "斯洛文尼亚"], code: "+386" },
    { names: ["germany", "德国"], code: "+49" },
    { names: ["france", "法国"], code: "+33" },
    { names: ["sweden", "瑞典"], code: "+46" },
    { names: ["spain", "西班牙"], code: "+34" },
    { names: ["china", "中国"], code: "+86" },
    { names: ["hong kong", "香港"], code: "+852" },
    { names: ["puerto rico"], code: "+1" },
    { names: ["south africa"], code: "+27" },
  ];

  const state = {
    busy: false,
    polling: false,
    stopRequested: false,
    panelCollapsed: true,
    statusMessage: "就绪。先点右侧“号”，再点“码”。",
    statusTone: "info",
    currentNumber: null,
    availableNumbers: [],
    currentMessages: [],
    lastCode: "",
    history: [],
    providerStats: {},
    detectedTargets: {
      phone: null,
      code: [],
      kind: "single",
    },
  };

  let menuBound = false;
  let dockTimer = 0;

  function sk(key) {
    return `${STORAGE_PREFIX}${key}`;
  }

  function loadSetting(key) {
    try {
      const value = GM_getValue(sk(key), DEFAULTS[key]);
      return value === undefined ? DEFAULTS[key] : value;
    } catch {
      return DEFAULTS[key];
    }
  }

  function saveSetting(key, value) {
    GM_setValue(sk(key), value);
  }

  function loadJson(key, fallback) {
    try {
      const raw = GM_getValue(sk(key), "");
      if (!raw || typeof raw !== "string") return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    GM_setValue(sk(key), JSON.stringify(value));
  }

  function boolSetting(key) {
    return String(loadSetting(key)) === "true";
  }

  function intSetting(key, fallback) {
    const value = Number.parseInt(String(loadSetting(key) || ""), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function currentSettings() {
    const out = {};
    Object.keys(DEFAULTS).forEach((key) => {
      out[key] = loadSetting(key);
    });
    return out;
  }

  function splitCsv(value) {
    return String(value || "")
      .split(/[\s,;\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clipText(value, max = 180) {
    const text = normalizeText(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatDateTime(value) {
    if (!value) return "未记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function toArray(list) {
    return Array.from(list || []);
  }

  function textOf(node) {
    return normalizeText(node?.textContent || "");
  }

  function absoluteUrl(base, href) {
    try {
      return new URL(href, base).toString();
    } catch {
      return "";
    }
  }

  function padBase64(value) {
    const padding = (4 - (value.length % 4)) % 4;
    return value + "=".repeat(padding);
  }

  function encodeRef(payload) {
    const binary = Array.from(new TextEncoder().encode(JSON.stringify(payload)), (byte) => String.fromCharCode(byte)).join("");
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeRef(value) {
    const binary = atob(padBase64(String(value || "").replace(/-/g, "+").replace(/_/g, "/")));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function inferCountryCode(countryName, phoneNumber) {
    const normalizedName = normalizeText(countryName).toLowerCase();
    const matched = COUNTRY_CODE_HINTS.find((entry) => entry.names.some((name) => normalizedName.includes(name)));
    if (matched) return matched.code;

    const phone = normalizeText(phoneNumber).replace(/\s+/g, "");
    const prefixes = ["+852", "+358", "+386", "+86", "+49", "+46", "+44", "+34", "+33", "+31", "+27", "+1"];
    return prefixes.find((prefix) => phone.startsWith(prefix)) || undefined;
  }

  function matchesCountryFilter(countryCode, countryName, filterCode, filterName) {
    const wantedCode = normalizeText(filterCode).replace(/\s+/g, "");
    const wantedName = normalizeText(filterName).toLowerCase();
    const currentCode = normalizeText(countryCode).replace(/\s+/g, "");
    const currentName = normalizeText(countryName).toLowerCase();

    if (wantedCode && currentCode && currentCode !== wantedCode) return false;
    if (wantedName && currentName && !currentName.includes(wantedName) && !wantedName.includes(currentName)) return false;
    if (wantedName && !currentName) return false;
    return true;
  }

  function dedupeNumbers(items, limit) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const key = item.sourceUrl || item.numberId;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output.slice(0, limit);
  }

  function setStatus(message, tone = "info") {
    state.statusMessage = String(message || "").trim() || "就绪。";
    state.statusTone = tone;
    const logger = tone === "error" ? console.error : tone === "warn" ? console.warn : console.log;
    logger("[EasySMS]", state.statusMessage);
    render();
  }

  function persistRuntime() {
    saveJson("history", state.history);
    saveJson("currentNumber", state.currentNumber);
    saveJson("providerStats", state.providerStats);
    saveSetting("panelCollapsed", state.panelCollapsed ? "true" : "false");
  }

  function restoreRuntime() {
    const storedCollapsed = GM_getValue(sk("panelCollapsed"), "");
    state.panelCollapsed = storedCollapsed === "" ? true : String(storedCollapsed) === "true";
    state.history = Array.isArray(loadJson("history", [])) ? loadJson("history", []) : [];
    state.currentNumber = loadJson("currentNumber", null);
    state.providerStats = loadJson("providerStats", {}) || {};
    if (state.currentNumber?.lastCode) {
      state.lastCode = String(state.currentNumber.lastCode || "");
    }
  }

  function providerStat(key) {
    if (!state.providerStats[key] || typeof state.providerStats[key] !== "object") {
      state.providerStats[key] = {
        failures: 0,
        cooldownUntil: 0,
        lastError: "",
        lastErrorKind: "",
        lastSuccessAt: "",
        lastFailureAt: "",
      };
    }
    return state.providerStats[key];
  }

  function classifyProviderError(error) {
    const message = normalizeText(error?.message || error);
    if (/cloudflare|challenge|captcha|verification|attention required|just a moment/i.test(message)) {
      return { kind: "challenge", cooldownMs: 15 * 60 * 1000 };
    }
    if (/timeout|network|failed|unable to load|http 5/i.test(message)) {
      return { kind: "network", cooldownMs: 5 * 60 * 1000 };
    }
    if (/empty|no available|not found|暂无|没有/i.test(message)) {
      return { kind: "empty", cooldownMs: 2 * 60 * 1000 };
    }
    return { kind: "generic", cooldownMs: 8 * 60 * 1000 };
  }

  function providerCoolingRemainingMs(key) {
    return Math.max(0, Number(providerStat(key).cooldownUntil || 0) - Date.now());
  }

  function providerIsCooling(key) {
    return providerCoolingRemainingMs(key) > 0;
  }

  function providerScore(key) {
    const stat = providerStat(key);
    let score = 120 - Number(stat.failures || 0) * 15;
    if (providerIsCooling(key)) score -= 1000;
    if (stat.lastErrorKind === "challenge") score -= 20;
    if (stat.lastErrorKind === "network") score -= 10;
    if (stat.lastErrorKind === "empty") score -= 6;
    return score;
  }

  function recordProviderSuccess(key) {
    const stat = providerStat(key);
    stat.failures = 0;
    stat.cooldownUntil = 0;
    stat.lastError = "";
    stat.lastErrorKind = "";
    stat.lastSuccessAt = new Date().toISOString();
    persistRuntime();
  }

  function recordProviderFailure(key, error) {
    const stat = providerStat(key);
    const info = classifyProviderError(error);
    stat.failures = Number(stat.failures || 0) + 1;
    stat.cooldownUntil = Date.now() + info.cooldownMs;
    stat.lastError = clipText(error?.message || error, 160);
    stat.lastErrorKind = info.kind;
    stat.lastFailureAt = new Date().toISOString();
    persistRuntime();
  }

  function requestText(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        data: options.data,
        anonymous: options.anonymous ?? false,
        headers: Object.assign({
          Accept: options.accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        }, options.headers || {}),
        timeout: options.timeoutMs || 30000,
        onload(response) {
          resolve({
            status: response.status,
            text: response.responseText || "",
            finalUrl: response.finalUrl || url,
          });
        },
        onerror() {
          reject(new Error(`Network request failed for ${url}`));
        },
        ontimeout() {
          reject(new Error(`Request timed out for ${url}`));
        },
      });
    });
  }

  async function requestDocument(url, options = {}) {
    const response = await requestText(url, options);
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return {
      document: new DOMParser().parseFromString(response.text, "text/html"),
      finalUrl: response.finalUrl,
      text: response.text,
    };
  }

  async function requestJson(url, options = {}) {
    const response = await requestText(url, {
      ...options,
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    });
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    const text = String(response.text || "").trim();
    if (!text) {
      throw new Error(`Empty JSON response for ${url}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function buildPublicNumber(provider, fields) {
    const countryCode = fields.countryCode || inferCountryCode(fields.countryName, fields.phoneNumber);
    const result = {
      providerKey: provider.key,
      providerDisplayName: provider.displayName,
      numberId: fields.numberId || encodeRef({
        providerKey: provider.key,
        sourceUrl: fields.sourceUrl,
        phoneNumber: fields.phoneNumber,
        countryName: fields.countryName || "",
        countryCode: countryCode || "",
      }),
      sourceUrl: fields.sourceUrl,
      phoneNumber: fields.phoneNumber,
      countryName: fields.countryName || "",
      countryCode: countryCode || "",
      latestActivityText: fields.latestActivityText || "",
    };
    [
      "activationId",
      "activationCost",
      "businessKey",
      "assignmentIndex",
      "maxBindingsPerPhone",
      "refundableCancelAvailableAtIso",
      "leaseExpiresAtIso",
      "costTier",
      "sessionMode",
    ].forEach((key) => {
      if (fields[key] !== undefined) {
        result[key] = fields[key];
      }
    });
    return result;
  }

  function buildInboxMessage(phoneNumber, idPart, fields) {
    return {
      id: `${phoneNumber}-${idPart}`,
      sender: fields.sender || "",
      receivedAtText: fields.receivedAtText || "",
      receivedAtIso: fields.receivedAtIso || "",
      content: fields.content || "",
      sourceUrl: fields.sourceUrl,
    };
  }

  function isHeroSmsCancelableNow(currentNumber, now = Date.now()) {
    const refundableAt = Date.parse(String(currentNumber?.refundableCancelAvailableAtIso || ""));
    if (!Number.isFinite(refundableAt)) return false;
    return refundableAt <= now && !currentNumber?.cancelledAtIso;
  }

  function buildHeroSmsLeaseSummary(currentNumber, now = Date.now()) {
    if (!currentNumber || currentNumber.providerKey !== "hero_sms") {
      return [];
    }

    const rows = [];
    const assignmentIndex = Number(currentNumber.assignmentIndex || 0);
    const maxBindingsPerPhone = Number(currentNumber.maxBindingsPerPhone || 0);
    if (assignmentIndex > 0 && maxBindingsPerPhone > 0) {
      rows.push(`租约席位 ${assignmentIndex}/${maxBindingsPerPhone}`);
    }
    if (currentNumber.businessKey) {
      rows.push(`业务键 ${currentNumber.businessKey}`);
    }
    if (currentNumber.activationCost !== undefined && currentNumber.activationCost !== null && currentNumber.activationCost !== "") {
      rows.push(`费用 ${currentNumber.activationCost}`);
    }

    const refundableAt = Date.parse(String(currentNumber.refundableCancelAvailableAtIso || ""));
    if (Number.isFinite(refundableAt)) {
      rows.push(refundableAt <= now ? "已到可退款取消窗口" : `退款取消时间 ${new Date(refundableAt).toLocaleString("zh-CN", { hour12: false })}`);
    }

    const leaseExpiresAt = Date.parse(String(currentNumber.leaseExpiresAtIso || ""));
    if (Number.isFinite(leaseExpiresAt)) {
      rows.push(`租约到期 ${new Date(leaseExpiresAt).toLocaleString("zh-CN", { hour12: false })}`);
    }

    if (currentNumber.cancelledAtIso) {
      rows.push(`已取消 ${formatDateTime(currentNumber.cancelledAtIso)}`);
    }

    return rows;
  }

  function isPaidProviderKey(providerKey) {
    return String(providerKey || "").trim() === "hero_sms";
  }

  function buildUserscriptModeUiModel(settings, currentNumber) {
    const providerMode = String(settings?.providerMode || "auto").trim() === "explicit"
      ? "explicit"
      : "auto";
    const currentProviderKey = String(currentNumber?.providerKey || settings?.explicitProviderKey || "").trim();
    const paid = isPaidProviderKey(currentProviderKey);

    const modeLabel = providerMode === "explicit" ? "EXPLICIT" : "AUTO";
    const modeTone = providerMode === "explicit" ? "warn" : "success";
    const tierLabel = paid ? "PAID" : "FREE";
    const tierTone = paid ? "paid" : "free";

    let warningText = "";
    if (paid && providerMode === "auto") {
      warningText = "当前号码来自付费 provider；自动模式仍默认优先 free。";
    } else if (paid) {
      warningText = "当前正在使用付费 provider，请留意成本、租约和退款窗口。";
    } else if (providerMode === "explicit") {
      warningText = "当前为指定模式，只会优先尝试当前选中的 provider。";
    }

    return {
      providerMode,
      currentProviderKey,
      modeLabel,
      modeTone,
      tierLabel,
      tierTone,
      paid,
      warningText,
    };
  }

  function parseTempLikeDirectory(document, provider, listUrl, linkMatcher, filters) {
    const results = [];
    toArray(document.querySelectorAll("a[href]")).forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href || !linkMatcher.test(href)) return;

      const sourceUrl = absoluteUrl(listUrl, href);
      const raw = normalizeText(anchor.textContent);
      const phoneMatch = raw.match(/\+\d[\d\s]+/);
      const phoneNumber = normalizeText(phoneMatch?.[0] || "");
      if (!phoneNumber) return;

      const countryName = normalizeText(raw.replace(phoneNumber, "").replace(/Latest:.+$/i, "").replace(/Online.+$/i, ""));
      const countryCode = inferCountryCode(countryName, phoneNumber);
      if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;

      results.push(buildPublicNumber(provider, {
        sourceUrl,
        phoneNumber,
        countryName,
        countryCode,
        latestActivityText: normalizeText(raw.replace(`${countryName} ${phoneNumber}`, "")),
      }));
    });

    return dedupeNumbers(results, filters.limit);
  }

  function parseDirectChatMessages(document, sourceUrl, phoneNumber) {
    return toArray(document.querySelectorAll(".direct-chat-msg")).map((node, index) => {
      const content = textOf(node.querySelector(".direct-chat-text"));
      if (!content) return null;
      const senderRaw = textOf(node.querySelector(".direct-chat-info .pull-right"));
      const sender = senderRaw.replace(/^From\s+/i, "") || textOf(node.querySelector(".direct-chat-name"));
      return buildInboxMessage(phoneNumber, `direct-${index}`, {
        sender,
        receivedAtText: textOf(node.querySelector(".direct-chat-timestamp")),
        content,
        sourceUrl,
      });
    }).filter(Boolean);
  }

  function parseCardMessages(document, sourceUrl, phoneNumber) {
    return toArray(document.querySelectorAll(".sms-item")).map((node, index) => {
      const content = textOf(node.querySelector(".sms-content"));
      if (!content) return null;
      return buildInboxMessage(phoneNumber, `card-${index}`, {
        sender: textOf(node.querySelector(".sender-badge")),
        receivedAtText: textOf(node.querySelector(".time-text")),
        content,
        sourceUrl,
      });
    }).filter(Boolean);
  }

  const ONLINE_SIM_API_URL = "https://onlinesim.io/api/getFreeList?lang=en";
  const ONLINE_SIM_HIDDEN_API_URL = "https://onlinesim.io/api/v1/free_numbers_content/countries";
  const ONLINE_SIM_HOMEPAGE_URL = "https://onlinesim.io/free_numbers";
  const ONLINE_SIM_HIDDEN_CATALOG_SEED_SLUG = "germany";
  const ONLINE_SIM_VERIFICATION_WINDOW_MS = 20 * 60 * 1000;
  const ONLINE_SIM_VERIFICATION_KEYWORD_PATTERN =
    /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;

  function buildOnlineSimApiUrl(url, apiKey) {
    const normalizedApiKey = String(apiKey || "").trim();
    if (!normalizedApiKey) return url;
    const target = new URL(url);
    if (!target.searchParams.has("apikey")) {
      target.searchParams.set("apikey", normalizedApiKey);
    }
    return target.toString();
  }

  function normalizePhoneNumber(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return digits ? `+${digits}` : undefined;
  }

  function humanizeSlug(value) {
    return String(value || "")
      .split("_")
      .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "")
      .join(" ");
  }

  function parseOnlineSimNaiveTimestamp(value) {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
    if (!match) return undefined;
    return Date.UTC(
      Number.parseInt(match[1] || "", 10),
      Number.parseInt(match[2] || "", 10) - 1,
      Number.parseInt(match[3] || "", 10),
      Number.parseInt(match[4] || "", 10),
      Number.parseInt(match[5] || "", 10),
      Number.parseInt(match[6] || "0", 10),
    );
  }

  function parseOnlineSimRelativeAgeMs(value) {
    if (!value) return undefined;
    const text = String(value).trim().toLowerCase();
    const amountMatch = /(\d+)/.exec(text);
    const amount = amountMatch ? Number.parseInt(amountMatch[1] || "", 10) : 1;
    if (text.includes("минут")) return amount * 60 * 1000;
    if (text.includes("час")) return amount * 60 * 60 * 1000;
    if (text.includes("дн")) return amount * 24 * 60 * 60 * 1000;
    if (text.includes("недел")) return amount * 7 * 24 * 60 * 60 * 1000;
    if (text.includes("меся")) return amount * 30 * 24 * 60 * 60 * 1000;
    if (text.includes("год") || text.includes("лет")) return amount * 365 * 24 * 60 * 60 * 1000;
    return undefined;
  }

  function isOnlineSimVerificationLikeMessage(message) {
    const rawText = Object.prototype.hasOwnProperty.call(message || {}, "text")
      ? message.text
      : message?.content;
    const text = String(rawText || "").trim();
    if (!text) return false;
    const condensed = text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
    if (/^\d{4,8}$/.test(condensed)) return true;
    if (!/\d{4,8}/.test(condensed)) return false;
    return ONLINE_SIM_VERIFICATION_KEYWORD_PATTERN.test(text);
  }

  function findLatestOnlineSimVerificationMessage(messages) {
    return (messages || []).find((message) => isOnlineSimVerificationLikeMessage(message));
  }

  function hasRecentOnlineSimVerificationActivity(response) {
    const latestVerificationMessage = findLatestOnlineSimVerificationMessage(response?.messages?.data || []);
    if (!latestVerificationMessage) return false;
    const relativeAgeMs = parseOnlineSimRelativeAgeMs(latestVerificationMessage.data_humans);
    if (relativeAgeMs !== undefined) {
      return relativeAgeMs <= ONLINE_SIM_VERIFICATION_WINDOW_MS;
    }

    const referenceTimestamp =
      parseOnlineSimNaiveTimestamp(response?.number?.updated_at) ??
      parseOnlineSimNaiveTimestamp((response?.messages?.data || [])[0]?.created_at);
    const verificationTimestamp = parseOnlineSimNaiveTimestamp(latestVerificationMessage.created_at);
    if (referenceTimestamp !== undefined && verificationTimestamp !== undefined) {
      return referenceTimestamp - verificationTimestamp <= ONLINE_SIM_VERIFICATION_WINDOW_MS;
    }
    return false;
  }

  function buildOnlineSimPublicPageUrl(countrySlug, fullNumber) {
    return `${ONLINE_SIM_HOMEPAGE_URL}/${encodeURIComponent(countrySlug)}/${encodeURIComponent(String(fullNumber || "").replace(/^\+/, ""))}`;
  }

  function extractOnlineSimCountrySlug(sourceUrl) {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      throw new Error("OnlineSIM numberId 缺少国家 slug。");
    }
    return parts[1];
  }

  const RECEIVE_SMSS_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
  const RECEIVE_SMSS_VERIFICATION_KEYWORD_PATTERN =
    /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;
  const RECEIVE_SMSS_ACCESS_GATE_PATTERN =
    /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|正在进行安全验证/i;
  const receiveSmssSessionState = {
    loginSignature: "",
    loggedInAtMs: 0,
  };

  function buildReceiveSmssLoginPayload(username, password) {
    return {
      log: String(username || "").trim(),
      pwd: String(password || ""),
      redirect_to: "/",
      instance: "",
      action: "login",
    };
  }

  function resolveReceiveSmssAuthConfig(settings) {
    const username = String(settings.receiveSmssUsername || "").trim();
    const password = String(settings.receiveSmssPassword || "").trim();
    if (!username || !password) return null;
    return { username, password };
  }

  function detectReceiveSmssAccessGateHtml(html) {
    return RECEIVE_SMSS_ACCESS_GATE_PATTERN.test(String(html || ""));
  }

  function isReceiveSmssVerificationLikeMessage(message) {
    const text = String(message?.content || "").trim();
    if (!text) return false;
    const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
    if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) return true;
    return RECEIVE_SMSS_VERIFICATION_KEYWORD_PATTERN.test(text);
  }

  function parseReceiveSmssRelativeAgeMs(value) {
    if (!value) return undefined;
    const text = String(value).trim().toLowerCase();
    const amountMatch = text.match(/(\d+)/);
    const amount = amountMatch ? Number.parseInt(amountMatch[1] || "", 10) : 1;
    if (text.includes("sec")) return amount * 1000;
    if (text.includes("min")) return amount * 60 * 1000;
    if (text.includes("hour")) return amount * 60 * 60 * 1000;
    if (text.includes("day")) return amount * 24 * 60 * 60 * 1000;
    if (text.includes("month")) return amount * 30 * 24 * 60 * 60 * 1000;
    if (text.includes("year")) return amount * 365 * 24 * 60 * 60 * 1000;
    return undefined;
  }

  function hasRecentReceiveSmssVerificationActivity(messages) {
    const latestVerificationMessage = (messages || []).find((message) =>
      isReceiveSmssVerificationLikeMessage(message)
    );
    if (!latestVerificationMessage) return false;
    const ageMs = parseReceiveSmssRelativeAgeMs(latestVerificationMessage.receivedAtText);
    return ageMs !== undefined && ageMs <= RECEIVE_SMSS_VERIFICATION_WINDOW_MS;
  }

  async function ensureReceiveSmssLoggedIn(settings, force = false) {
    const auth = resolveReceiveSmssAuthConfig(settings);
    if (!auth) {
      return;
    }

    const signature = `${auth.username}\n${auth.password}`;
    if (!force && receiveSmssSessionState.loginSignature === signature && Date.now() - receiveSmssSessionState.loggedInAtMs < 10 * 60 * 1000) {
      return;
    }

    await requestText("https://receive-smss.com/login/", {
      headers: {
        Referer: "https://receive-smss.com/login/",
      },
    });
    const payload = new URLSearchParams(buildReceiveSmssLoginPayload(auth.username, auth.password)).toString();
    const response = await requestText("https://receive-smss.com/login/", {
      method: "POST",
      data: payload,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: "https://receive-smss.com/login/",
      },
    });
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`Receive-SMSS 登录失败：HTTP ${response.status}`);
    }

    receiveSmssSessionState.loginSignature = signature;
    receiveSmssSessionState.loggedInAtMs = Date.now();
  }

  async function fetchReceiveSmssDocument(url, settings) {
    await ensureReceiveSmssLoggedIn(settings);
    let response = await requestDocument(url, {
      headers: {
        Referer: "https://receive-smss.com/",
      },
    });
    if (detectReceiveSmssAccessGateHtml(response.text)) {
      await ensureReceiveSmssLoggedIn(settings, true);
      response = await requestDocument(url, {
        headers: {
          Referer: "https://receive-smss.com/",
        },
      });
    }
    if (detectReceiveSmssAccessGateHtml(response.text)) {
      throw new Error(`Receive-SMSS 页面仍被 challenge 拦截：${url}`);
    }
    return response;
  }

  function parseReceiveSmssDirectoryCards(document, provider) {
    const results = [];
    toArray(document.querySelectorAll(".number-boxes-item")).forEach((card) => {
      const anchor = card.querySelector("a[href*='/sms/']") || card.closest("a[href*='/sms/']");
      const href = anchor?.getAttribute("href");
      const sourceUrl = href ? absoluteUrl("https://receive-smss.com/", href) : "";
      const phoneNumber = normalizeText(textOf(card.querySelector(".number-boxes-itemm-number, .number-boxes-item-number")));
      const countryName = normalizeText(textOf(card.querySelector(".number-boxes-item-country, .number-boxess-item-country")));
      const countryCode = inferCountryCode(countryName, phoneNumber);
      if (!sourceUrl || !phoneNumber || !countryName) return;
      results.push(buildPublicNumber(provider, {
        sourceUrl,
        phoneNumber,
        countryName,
        countryCode,
      }));
    });
    return dedupeNumbers(results, Number.MAX_SAFE_INTEGER);
  }

  function parseReceiveSmssInboxMessages(document, sourceUrl, phoneNumber) {
    return toArray(document.querySelectorAll(".message_details")).map((node, index) => {
      const content =
        normalizeText(textOf(node.querySelector(".msg > span, .msgg > span"))) ||
        normalizeText(textOf(node.querySelector(".msg, .msgg")).replace(/^Message\s*/i, ""));
      if (!content) return null;
      const sender =
        normalizeText(textOf(node.querySelector(".sender > a, .senderr > a"))) ||
        normalizeText(textOf(node.querySelector(".sender, .senderr")).replace(/^Sender\s*/i, ""));
      const receivedAtText = normalizeText(textOf(node.querySelector(".time")).replace(/^Time\s*/i, ""));
      return buildInboxMessage(phoneNumber, `receive-smss-${index}`, {
        sender,
        receivedAtText,
        content,
        sourceUrl,
      });
    }).filter(Boolean);
  }

  const HERO_SMS_DEFAULT_LEASE_WINDOW_SECONDS = 20 * 60;
  const HERO_SMS_DEFAULT_REFUNDABLE_CANCEL_WINDOW_SECONDS = 120;

  function heroSmsLeaseStorageKey() {
    return "heroSmsLeases";
  }

  function loadHeroSmsLeases() {
    const leases = Array.isArray(loadJson(heroSmsLeaseStorageKey(), [])) ? loadJson(heroSmsLeaseStorageKey(), []) : [];
    const now = Date.now();
    return leases.filter((lease) => {
      if (!lease || typeof lease !== "object") return false;
      if (lease.cancelledAtIso || lease.completedAtIso) return false;
      return Date.parse(lease.leaseExpiresAtIso || "") > now;
    });
  }

  function saveHeroSmsLeases(leases) {
    saveJson(heroSmsLeaseStorageKey(), leases);
  }

  function resolveHeroSmsSettings(settings) {
    const apiKey = String(settings.heroSmsApiKey || "").trim();
    if (!apiKey) {
      throw new Error("HeroSMS 需要配置 API key。");
    }
    const service = String(settings.heroSmsService || "dr").trim() || "dr";
    const countryId = Number.parseInt(String(settings.heroSmsCountry || "16"), 10);
    if (!Number.isFinite(countryId)) {
      throw new Error("HeroSMS 国家 ID 配置无效。");
    }
    const maxBindingsPerPhone = Math.max(1, Number.parseInt(String(settings.heroSmsMaxBindingsPerPhone || "1"), 10) || 1);
    return {
      apiKey,
      baseUrl: String(settings.heroSmsBaseUrl || "https://hero-sms.com/stubs/handler_api.php").trim(),
      service,
      countryId,
      operator: String(settings.heroSmsOperator || "").trim(),
      selectionMode: String(settings.heroSmsSelectionMode || "balanced").trim(),
      allowReuse: String(settings.heroSmsAllowReuse || "true") === "true",
      businessKey: String(settings.heroSmsBusinessKey || "default").trim() || "default",
      maxBindingsPerPhone,
      leaseWindowSeconds: HERO_SMS_DEFAULT_LEASE_WINDOW_SECONDS,
      refundableCancelWindowSeconds: HERO_SMS_DEFAULT_REFUNDABLE_CANCEL_WINDOW_SECONDS,
    };
  }

  async function requestHeroSms(action, params, settings) {
    const resolved = resolveHeroSmsSettings(settings);
    const url = new URL(resolved.baseUrl);
    url.searchParams.set("api_key", resolved.apiKey);
    url.searchParams.set("action", action);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
    return requestJson(url.toString());
  }

  function parseHeroSmsNumberResponse(payload) {
    const activationId = Number.parseInt(String(payload?.activationId ?? payload?.id ?? ""), 10);
    const phoneNumber = String(payload?.phoneNumber ?? payload?.number ?? "").trim();
    const activationCost = Number.parseFloat(String(payload?.activationCost ?? payload?.cost ?? "0"));
    if (!Number.isFinite(activationId) || !phoneNumber) {
      throw new Error(`HeroSMS 创建号码失败：${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
    }
    return {
      activationId,
      phoneNumber,
      activationCost: Number.isFinite(activationCost) ? activationCost : 0,
    };
  }

  async function selectHeroSmsOperator(settings) {
    const resolved = resolveHeroSmsSettings(settings);
    if (resolved.operator) {
      return resolved.operator;
    }

    const operatorsPayload = await requestHeroSms("getOperators", { country: resolved.countryId }, settings);
    const operatorList = Array.isArray(operatorsPayload?.countryOperators?.[String(resolved.countryId)])
      ? operatorsPayload.countryOperators[String(resolved.countryId)]
      : [];
    if (!operatorList.length) {
      return "";
    }

    const quotes = [];
    for (const operator of operatorList) {
      try {
        const pricePayload = await requestHeroSms("getPrices", {
          service: resolved.service,
          country: resolved.countryId,
          operator,
        }, settings);
        const bucket = pricePayload?.[String(resolved.countryId)]?.[resolved.service] ?? pricePayload?.[resolved.countryId]?.[resolved.service];
        quotes.push({
          operator,
          price: Number.parseFloat(String(bucket?.cost ?? bucket?.price ?? Number.MAX_SAFE_INTEGER)),
          count: Number.parseInt(String(bucket?.count ?? "0"), 10) || 0,
        });
      } catch (error) {
        console.warn("HeroSMS quote fetch failed", operator, error);
      }
    }

    if (!quotes.length) {
      return String(operatorList[0] || "");
    }

    const ranked = quotes.sort((left, right) => {
      switch (resolved.selectionMode) {
        case "price-first":
          if (left.price !== right.price) return left.price - right.price;
          return right.count - left.count;
        case "stock-first":
          if (left.count !== right.count) return right.count - left.count;
          return left.price - right.price;
        case "success-first":
        case "balanced":
        default:
          if (left.price !== right.price) return left.price - right.price;
          return right.count - left.count;
      }
    });
    return ranked[0]?.operator || String(operatorList[0] || "");
  }

  async function resolveHeroSmsCountryMeta(settings) {
    const resolved = resolveHeroSmsSettings(settings);
    try {
      const countries = await requestHeroSms("getCountries", {}, settings);
      const payload = countries?.[String(resolved.countryId)] ?? countries?.[resolved.countryId];
      if (payload) {
        return {
          countryName: String(payload.chn ?? payload.eng ?? payload.rus ?? payload.name ?? `Country ${resolved.countryId}`).trim(),
          countryCode: String(payload.dialCode ?? payload.phoneCode ?? payload.prefix ?? "").trim() || undefined,
        };
      }
    } catch (error) {
      console.warn("HeroSMS country lookup failed", error);
    }
    return {
      countryName: `Country ${resolved.countryId}`,
      countryCode: undefined,
    };
  }

  function findReusableHeroSmsLease(settings) {
    const resolved = resolveHeroSmsSettings(settings);
    return loadHeroSmsLeases().find((lease) =>
      lease.businessKey === resolved.businessKey
      && lease.service === resolved.service
      && lease.countryId === resolved.countryId
      && (!resolved.operator || lease.operator === resolved.operator)
      && Number(lease.assignmentCount || 0) < Math.max(1, Number(lease.maxBindingsPerPhone || 1))
    );
  }

  function reserveHeroSmsLease(lease) {
    const leases = loadHeroSmsLeases();
    const matchIndex = leases.findIndex((item) => Number(item.activationId) === Number(lease.activationId));
    if (matchIndex === -1) {
      lease.assignmentCount = 1;
      leases.push(lease);
      saveHeroSmsLeases(leases);
      return lease;
    }

    const current = leases[matchIndex];
    current.assignmentCount = Number(current.assignmentCount || 0) + 1;
    current.maxBindingsPerPhone = Math.max(Number(current.maxBindingsPerPhone || 1), Number(lease.maxBindingsPerPhone || 1));
    leases[matchIndex] = current;
    saveHeroSmsLeases(leases);
    return current;
  }

  function markHeroSmsLeaseCancelled(activationId) {
    const leases = loadHeroSmsLeases();
    const matchIndex = leases.findIndex((item) => Number(item.activationId) === Number(activationId));
    if (matchIndex === -1) {
      return;
    }
    leases[matchIndex].cancelledAtIso = new Date().toISOString();
    saveHeroSmsLeases(leases);
  }

  const RECEIVE_SMS_FREE_CC_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
  const RECEIVE_SMS_FREE_CC_VERIFICATION_KEYWORD_PATTERN =
    /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;
  const RECEIVE_SMS_FREE_CC_ACCESS_GATE_PATTERN =
    /virtual numbers are required to .*register.*or .*login.*before accessing the content/i;
  const RECEIVE_SMS_FREE_CC_COUNTRY_DIRECTORY_LINK_PATTERN = /\/Free-[A-Za-z-]+-Phone-Number\/$/i;
  const receiveSmsFreeCcSessionState = {
    loginSignature: "",
    loggedInAtMs: 0,
  };

  function rotateLeft(value, shift) {
    return (value << shift) | (value >>> (32 - shift));
  }

  function addUnsigned(x, y) {
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const result = (x & 0x3fffffff) + (y & 0x3fffffff);
    if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (result & 0x40000000) return result ^ 0xc0000000 ^ x8 ^ y8;
      return result ^ 0x40000000 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  }

  function md5F(x, y, z) { return (x & y) | ((~x) & z); }
  function md5G(x, y, z) { return (x & z) | (y & (~z)); }
  function md5H(x, y, z) { return x ^ y ^ z; }
  function md5I(x, y, z) { return y ^ (x | (~z)); }

  function md5FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(md5F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function md5GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(md5G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function md5HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(md5H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function md5II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(md5I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function md5ConvertToWordArray(text) {
    const utf8 = new TextEncoder().encode(String(text || ""));
    const messageLength = utf8.length;
    const words = [];
    let byteCount;
    for (byteCount = 0; byteCount < messageLength; byteCount += 1) {
      const wordCount = (byteCount - (byteCount % 4)) / 4;
      const bytePosition = (byteCount % 4) * 8;
      words[wordCount] = words[wordCount] | (utf8[byteCount] << bytePosition);
    }
    const wordCount = (byteCount - (byteCount % 4)) / 4;
    const bytePosition = (byteCount % 4) * 8;
    words[wordCount] = words[wordCount] | (0x80 << bytePosition);
    words[(((byteCount + 8) - ((byteCount + 8) % 64)) / 64) * 16 + 14] = messageLength * 8;
    return words;
  }

  function md5WordToHex(value) {
    let output = "";
    for (let count = 0; count <= 3; count += 1) {
      output += (`0${((value >>> (count * 8)) & 255).toString(16)}`).slice(-2);
    }
    return output;
  }

  function md5Hex(text) {
    const x = md5ConvertToWordArray(text);
    let a = 0x67452301;
    let b = 0xefcdab89;
    let c = 0x98badcfe;
    let d = 0x10325476;

    for (let k = 0; k < x.length; k += 16) {
      const aa = a;
      const bb = b;
      const cc = c;
      const dd = d;
      a = md5FF(a, b, c, d, x[k + 0], 7, 0xd76aa478); d = md5FF(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
      c = md5FF(c, d, a, b, x[k + 2], 17, 0x242070db); b = md5FF(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
      a = md5FF(a, b, c, d, x[k + 4], 7, 0xf57c0faf); d = md5FF(d, a, b, c, x[k + 5], 12, 0x4787c62a);
      c = md5FF(c, d, a, b, x[k + 6], 17, 0xa8304613); b = md5FF(b, c, d, a, x[k + 7], 22, 0xfd469501);
      a = md5FF(a, b, c, d, x[k + 8], 7, 0x698098d8); d = md5FF(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
      c = md5FF(c, d, a, b, x[k + 10], 17, 0xffff5bb1); b = md5FF(b, c, d, a, x[k + 11], 22, 0x895cd7be);
      a = md5FF(a, b, c, d, x[k + 12], 7, 0x6b901122); d = md5FF(d, a, b, c, x[k + 13], 12, 0xfd987193);
      c = md5FF(c, d, a, b, x[k + 14], 17, 0xa679438e); b = md5FF(b, c, d, a, x[k + 15], 22, 0x49b40821);

      a = md5GG(a, b, c, d, x[k + 1], 5, 0xf61e2562); d = md5GG(d, a, b, c, x[k + 6], 9, 0xc040b340);
      c = md5GG(c, d, a, b, x[k + 11], 14, 0x265e5a51); b = md5GG(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
      a = md5GG(a, b, c, d, x[k + 5], 5, 0xd62f105d); d = md5GG(d, a, b, c, x[k + 10], 9, 0x02441453);
      c = md5GG(c, d, a, b, x[k + 15], 14, 0xd8a1e681); b = md5GG(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
      a = md5GG(a, b, c, d, x[k + 9], 5, 0x21e1cde6); d = md5GG(d, a, b, c, x[k + 14], 9, 0xc33707d6);
      c = md5GG(c, d, a, b, x[k + 3], 14, 0xf4d50d87); b = md5GG(b, c, d, a, x[k + 8], 20, 0x455a14ed);
      a = md5GG(a, b, c, d, x[k + 13], 5, 0xa9e3e905); d = md5GG(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
      c = md5GG(c, d, a, b, x[k + 7], 14, 0x676f02d9); b = md5GG(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

      a = md5HH(a, b, c, d, x[k + 5], 4, 0xfffa3942); d = md5HH(d, a, b, c, x[k + 8], 11, 0x8771f681);
      c = md5HH(c, d, a, b, x[k + 11], 16, 0x6d9d6122); b = md5HH(b, c, d, a, x[k + 14], 23, 0xfde5380c);
      a = md5HH(a, b, c, d, x[k + 1], 4, 0xa4beea44); d = md5HH(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
      c = md5HH(c, d, a, b, x[k + 7], 16, 0xf6bb4b60); b = md5HH(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
      a = md5HH(a, b, c, d, x[k + 13], 4, 0x289b7ec6); d = md5HH(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
      c = md5HH(c, d, a, b, x[k + 3], 16, 0xd4ef3085); b = md5HH(b, c, d, a, x[k + 6], 23, 0x04881d05);
      a = md5HH(a, b, c, d, x[k + 9], 4, 0xd9d4d039); d = md5HH(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
      c = md5HH(c, d, a, b, x[k + 15], 16, 0x1fa27cf8); b = md5HH(b, c, d, a, x[k + 2], 23, 0xc4ac5665);

      a = md5II(a, b, c, d, x[k + 0], 6, 0xf4292244); d = md5II(d, a, b, c, x[k + 7], 10, 0x432aff97);
      c = md5II(c, d, a, b, x[k + 14], 15, 0xab9423a7); b = md5II(b, c, d, a, x[k + 5], 21, 0xfc93a039);
      a = md5II(a, b, c, d, x[k + 12], 6, 0x655b59c3); d = md5II(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
      c = md5II(c, d, a, b, x[k + 10], 15, 0xffeff47d); b = md5II(b, c, d, a, x[k + 1], 21, 0x85845dd1);
      a = md5II(a, b, c, d, x[k + 8], 6, 0x6fa87e4f); d = md5II(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
      c = md5II(c, d, a, b, x[k + 6], 15, 0xa3014314); b = md5II(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
      a = md5II(a, b, c, d, x[k + 4], 6, 0xf7537e82); d = md5II(d, a, b, c, x[k + 11], 10, 0xbd3af235);
      c = md5II(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb); b = md5II(b, c, d, a, x[k + 9], 21, 0xeb86d391);

      a = addUnsigned(a, aa);
      b = addUnsigned(b, bb);
      c = addUnsigned(c, cc);
      d = addUnsigned(d, dd);
    }

    return `${md5WordToHex(a)}${md5WordToHex(b)}${md5WordToHex(c)}${md5WordToHex(d)}`;
  }

  function buildReceiveSmsFreeCcLoginPayload(email, password) {
    return {
      mail: String(email || "").trim(),
      password: md5Hex(String(password || "")),
    };
  }

  function resolveReceiveSmsFreeCcAuthConfig(settings) {
    const email = String(settings.receiveSmsFreeCcEmail || "").trim();
    const password = String(settings.receiveSmsFreeCcPassword || "").trim();
    if (!email || !password) return null;
    return { email, password };
  }

  function isReceiveSmsFreeCcAccessGateHtml(html) {
    return RECEIVE_SMS_FREE_CC_ACCESS_GATE_PATTERN.test(String(html || ""));
  }

  async function ensureReceiveSmsFreeCcLoggedIn(settings, force = false) {
    const auth = resolveReceiveSmsFreeCcAuthConfig(settings);
    if (!auth) return;
    const signature = `${auth.email}\n${auth.password}`;
    if (!force && receiveSmsFreeCcSessionState.loginSignature === signature && Date.now() - receiveSmsFreeCcSessionState.loggedInAtMs < 10 * 60 * 1000) {
      return;
    }

    await requestText("https://receive-sms-free.cc/auth/login", {
      headers: {
        Referer: "https://receive-sms-free.cc/auth/login",
      },
    });
    const payload = buildReceiveSmsFreeCcLoginPayload(auth.email, auth.password);
    const response = await requestText("https://receive-sms-free.cc/ajax/login", {
      method: "POST",
      data: JSON.stringify(payload),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://receive-sms-free.cc",
        Referer: "https://receive-sms-free.cc/auth/login",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`Receive-SMS-Free.cc 登录失败：HTTP ${response.status}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.text || "{}");
    } catch {
      throw new Error("Receive-SMS-Free.cc 登录返回了非 JSON 响应。");
    }
    if (parsed?.status !== true) {
      throw new Error(`Receive-SMS-Free.cc 登录失败：${parsed?.Msg || parsed?.result || "unknown error"}`);
    }
    receiveSmsFreeCcSessionState.loginSignature = signature;
    receiveSmsFreeCcSessionState.loggedInAtMs = Date.now();
  }

  async function fetchReceiveSmsFreeCcDocument(url, settings) {
    const auth = resolveReceiveSmsFreeCcAuthConfig(settings);
    if (auth) {
      await ensureReceiveSmsFreeCcLoggedIn(settings);
    }
    let response = await requestDocument(url, {
      headers: {
        Referer: "https://receive-sms-free.cc/",
      },
    });
    if (auth && isReceiveSmsFreeCcAccessGateHtml(response.text)) {
      await ensureReceiveSmsFreeCcLoggedIn(settings, true);
      response = await requestDocument(url, {
        headers: {
          Referer: "https://receive-sms-free.cc/",
        },
      });
    }
    return response;
  }

  async function resolveReceiveSmsFreeCcListUrl(settings, filters) {
    if (!filters.countryCode && !filters.countryName) {
      return "https://receive-sms-free.cc/";
    }
    const { document } = await fetchReceiveSmsFreeCcDocument("https://receive-sms-free.cc/regions/", settings);
    let matchedUrl = "";
    toArray(document.querySelectorAll("a[href]")).forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href || !RECEIVE_SMS_FREE_CC_COUNTRY_DIRECTORY_LINK_PATTERN.test(href)) return;
      const sourceUrl = absoluteUrl("https://receive-sms-free.cc/regions/", href);
      const text = normalizeText(anchor.textContent);
      const countryName = normalizeText(text.replace(/Phone Number.+$/i, ""));
      const countryCode = inferCountryCode(countryName);
      if (!matchedUrl && matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) {
        matchedUrl = sourceUrl;
      }
    });
    return matchedUrl || "https://receive-sms-free.cc/";
  }

  function isReceiveSmsFreeCcVerificationLikeMessage(message) {
    const text = String(message?.content || "").trim();
    if (!text) return false;
    const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
    if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) return true;
    return RECEIVE_SMS_FREE_CC_VERIFICATION_KEYWORD_PATTERN.test(text);
  }

  function parseReceiveSmsFreeCcRelativeAgeMs(value) {
    if (!value) return undefined;
    const text = String(value).trim().toLowerCase();
    const amountMatch = text.match(/(\d+)/);
    const amount = amountMatch ? Number.parseInt(amountMatch[1] || "", 10) : 1;
    if (text.includes("sec")) return amount * 1000;
    if (text.includes("min")) return amount * 60 * 1000;
    if (text.includes("hour")) return amount * 60 * 60 * 1000;
    if (text.includes("day")) return amount * 24 * 60 * 60 * 1000;
    if (text.includes("month")) return amount * 30 * 24 * 60 * 60 * 1000;
    if (text.includes("year")) return amount * 365 * 24 * 60 * 60 * 1000;
    return undefined;
  }

  async function filterReceiveSmsFreeCcLiveNumbers(provider, numbers, limit) {
    const output = [];
    for (const number of numbers) {
      const listedAgeMs = parseReceiveSmsFreeCcRelativeAgeMs(number.latestActivityText);
      if (listedAgeMs !== undefined && listedAgeMs > RECEIVE_SMS_FREE_CC_VERIFICATION_WINDOW_MS) continue;
      try {
        const messages = await provider.readInbox(number);
        const latestVerificationMessage = messages.find((message) => isReceiveSmsFreeCcVerificationLikeMessage(message));
        if (!latestVerificationMessage) continue;
        const ageMs = parseReceiveSmsFreeCcRelativeAgeMs(latestVerificationMessage.receivedAtText);
        if (ageMs === undefined || ageMs > RECEIVE_SMS_FREE_CC_VERIFICATION_WINDOW_MS) continue;
        output.push({
          ...number,
          latestActivityText: latestVerificationMessage.receivedAtText || number.latestActivityText,
        });
        if (output.length >= limit) break;
      } catch (error) {
        console.warn("Receive-SMS-Free.cc liveness probe failed", number, error);
      }
    }
    return output;
  }

  const YUNDUANXIN_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
  const YUNDUANXIN_VERIFICATION_KEYWORD_PATTERN =
    /\b(?:code|verification|verify|otp|pin|passcode|codigo|c[oó]digo|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;

  function isYunduanxinVerificationLikeMessage(message) {
    const text = String(message?.content || "").trim();
    if (!text) return false;
    const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
    if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) return true;
    return YUNDUANXIN_VERIFICATION_KEYWORD_PATTERN.test(text);
  }

  function parseYunduanxinRelativeAgeMs(value) {
    const text = String(value || "").trim();
    const match = text.match(/(\d+)\s*(秒|分钟|分鐘|小时|小時|天|月|年)前/);
    if (!match) return undefined;
    const amount = Number.parseInt(match[1] || "", 10);
    if (!Number.isFinite(amount)) return undefined;
    const unit = match[2];
    const multiplier = unit === "秒"
      ? 1000
      : unit === "分钟" || unit === "分鐘"
        ? 60 * 1000
        : unit === "小时" || unit === "小時"
          ? 60 * 60 * 1000
          : unit === "天"
            ? 24 * 60 * 60 * 1000
            : unit === "月"
              ? 30 * 24 * 60 * 60 * 1000
              : 365 * 24 * 60 * 60 * 1000;
    return amount * multiplier;
  }

  const SMS_TO_ME_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
  const SMS_TO_ME_VERIFICATION_KEYWORD_PATTERN =
    /\b(?:code|verification|verify|otp|pin|passcode|codigo|c[oó]digo|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;
  const SMS_TO_ME_ACCESS_GATE_PATTERN =
    /please log in to view messages for this number|require a free account to access/i;
  const smsToMeSessionState = {
    loginSignature: "",
    loggedInAtMs: 0,
  };

  function resolveSmsToMeAuthConfig(settings) {
    const email = String(settings.smsToMeEmail || "").trim();
    const password = String(settings.smsToMePassword || "").trim();
    if (!email || !password) {
      return null;
    }
    return { email, password };
  }

  function extractSmsToMeLoginChallenge(html) {
    const csrfToken = String(html || "").match(/name="_token"\s+value="([^"]+)"/i)?.[1]?.trim();
    const csrfV = String(html || "").match(/name="csrf_v"\s+value="([^"]+)"/i)?.[1]?.trim();
    const captchaPrompt = String(html || "").match(/What is\s+\d+\s*[+\-]\s*\d+\?/i)?.[0]?.trim();
    if (!csrfToken || !csrfV || !captchaPrompt) {
      throw new Error("SMSToMe 登录页缺少预期字段。");
    }

    const numbers = Array.from(captchaPrompt.matchAll(/\d+/g), (match) => Number.parseInt(match[0], 10));
    if (numbers.length < 2 || numbers.some((value) => !Number.isFinite(value))) {
      throw new Error(`无法解析 SMSToMe 算术验证码：${captchaPrompt}`);
    }

    return {
      csrfToken,
      csrfV,
      captchaPrompt,
      captchaAnswer: captchaPrompt.includes("-")
        ? String(numbers[0] - numbers[1])
        : String(numbers[0] + numbers[1]),
    };
  }

  function isSmsToMeAccessGateHtml(html) {
    return SMS_TO_ME_ACCESS_GATE_PATTERN.test(String(html || ""));
  }

  function isSmsToMeVerificationLikeMessage(message) {
    const text = String(message?.content || "").trim();
    if (!text) return false;
    const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
    if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) return true;
    return SMS_TO_ME_VERIFICATION_KEYWORD_PATTERN.test(text);
  }

  function parseSmsToMeRelativeAgeMs(value) {
    if (!value) return undefined;
    const text = String(value).trim().toLowerCase();
    if (text.includes("just now")) return 0;
    const amountMatch = text.match(/(\d+)/);
    const amount = amountMatch ? Number.parseInt(amountMatch[1] || "", 10) : 1;
    if (text.includes("sec")) return amount * 1000;
    if (text.includes("min")) return amount * 60 * 1000;
    if (text.includes("hour")) return amount * 60 * 60 * 1000;
    if (text.includes("day")) return amount * 24 * 60 * 60 * 1000;
    if (text.includes("month")) return amount * 30 * 24 * 60 * 60 * 1000;
    if (text.includes("year")) return amount * 365 * 24 * 60 * 60 * 1000;
    return undefined;
  }

  async function ensureSmsToMeLoggedIn(settings, force = false) {
    const auth = resolveSmsToMeAuthConfig(settings);
    if (!auth) {
      throw new Error("SMSToMe 需要配置登录邮箱和密码。");
    }

    const signature = `${auth.email}\n${auth.password}`;
    if (!force && smsToMeSessionState.loginSignature === signature && Date.now() - smsToMeSessionState.loggedInAtMs < 10 * 60 * 1000) {
      return;
    }

    const loginPage = await requestText("https://smstome.com/sign-in", {
      headers: {
        Referer: "https://smstome.com/",
      },
    });
    if (loginPage.status < 200 || loginPage.status >= 400) {
      throw new Error(`SMSToMe 登录页返回 HTTP ${loginPage.status}`);
    }

    const challenge = extractSmsToMeLoginChallenge(loginPage.text);
    const formData = new URLSearchParams({
      _token: challenge.csrfToken,
      csrf_v: challenge.csrfV,
      email: auth.email,
      password: auth.password,
      captcha: challenge.captchaAnswer,
    }).toString();

    const loginResponse = await requestText("https://smstome.com/sign-in", {
      method: "POST",
      data: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://smstome.com",
        Referer: "https://smstome.com/sign-in",
      },
    });
    if (loginResponse.status < 200 || loginResponse.status >= 400) {
      throw new Error(`SMSToMe 登录失败：HTTP ${loginResponse.status}`);
    }

    smsToMeSessionState.loginSignature = signature;
    smsToMeSessionState.loggedInAtMs = Date.now();
  }

  async function fetchSmsToMeDocument(url, settings) {
    await ensureSmsToMeLoggedIn(settings);
    let response = await requestDocument(url, {
      headers: {
        Referer: "https://smstome.com/",
      },
    });

    if (isSmsToMeAccessGateHtml(response.text)) {
      await ensureSmsToMeLoggedIn(settings, true);
      response = await requestDocument(url, {
        headers: {
          Referer: "https://smstome.com/",
        },
      });
    }

    if (isSmsToMeAccessGateHtml(response.text)) {
      throw new Error(`SMSToMe 号码页仍被登录墙拦截：${url}`);
    }

    return response;
  }

  async function filterSmsToMeLiveNumbers(provider, numbers, limit) {
    const output = [];
    for (const number of numbers) {
      try {
        const messages = await provider.readInbox(number);
        const latestVerificationMessage = messages.find((message) => isSmsToMeVerificationLikeMessage(message));
        if (!latestVerificationMessage) continue;
        const ageMs = parseSmsToMeRelativeAgeMs(latestVerificationMessage.receivedAtText);
        if (ageMs === undefined || ageMs > SMS_TO_ME_VERIFICATION_WINDOW_MS) continue;
        output.push({
          ...number,
          latestActivityText: latestVerificationMessage.receivedAtText || number.latestActivityText,
        });
        if (output.length >= limit) break;
      } catch (error) {
        console.warn("SMSToMe liveness probe failed", number, error);
      }
    }
    return output;
  }

  const PROVIDERS = {
    onlinesim: {
      key: "onlinesim",
      displayName: "OnlineSIM Free Numbers",
      async listNumbers(filters) {
        const settings = currentSettings();
        const officialCatalog = await requestJson(buildOnlineSimApiUrl(ONLINE_SIM_API_URL, settings.onlineSimApiKey));
        const hiddenCatalog = await requestJson(
          buildOnlineSimApiUrl(`${ONLINE_SIM_HIDDEN_API_URL}/${encodeURIComponent(ONLINE_SIM_HIDDEN_CATALOG_SEED_SLUG)}?page=1`, settings.onlineSimApiKey),
        );
        const officialByCode = new Map((officialCatalog?.countries || []).map((country) => [country.country, country]));
        const countries = (hiddenCatalog?.counties || [])
          .filter((country) => country.online)
          .map((country) => ({
            dialCode: `+${country.country}`,
            displayName: officialByCode.get(country.country)?.country_text || humanizeSlug(country.name),
            slug: country.name,
          }))
          .filter((country) => matchesCountryFilter(country.dialCode, country.displayName, filters.countryCode, filters.countryName));

        const items = [];
        for (const country of countries) {
          const response = await requestJson(
            buildOnlineSimApiUrl(`${ONLINE_SIM_HIDDEN_API_URL}/${encodeURIComponent(country.slug)}?page=1`, settings.onlineSimApiKey),
          );
          const phoneNumber = normalizePhoneNumber(response?.number?.full_number);
          if (!phoneNumber || !hasRecentOnlineSimVerificationActivity(response)) continue;
          const latestVerificationMessage = findLatestOnlineSimVerificationMessage(response?.messages?.data || []);
          items.push(buildPublicNumber(this, {
            sourceUrl: buildOnlineSimPublicPageUrl(country.slug, response?.number?.full_number || phoneNumber),
            phoneNumber,
            countryName: country.displayName,
            countryCode: country.dialCode,
            latestActivityText: latestVerificationMessage?.data_humans || response?.number?.data_humans || "",
          }));
          if (items.length >= (filters.limit || 8)) break;
        }
        return dedupeNumbers(items, filters.limit || 8);
      },
      async readInbox(reference) {
        const settings = currentSettings();
        const slug = extractOnlineSimCountrySlug(reference.sourceUrl);
        const response = await requestJson(
          buildOnlineSimApiUrl(`${ONLINE_SIM_HIDDEN_API_URL}/${encodeURIComponent(slug)}?page=1`, settings.onlineSimApiKey),
        );
        const resolvedPhoneNumber = normalizePhoneNumber(response?.number?.full_number);
        if (!resolvedPhoneNumber || resolvedPhoneNumber !== normalizePhoneNumber(reference.phoneNumber)) {
          throw new Error("OnlineSIM 当前只对国家页里的主号公开 inbox。");
        }
        return (response?.messages?.data || [])
          .filter((message) => normalizeText(message?.text))
          .map((message) => buildInboxMessage(reference.phoneNumber, `onlinesim-${message.id}`, {
            sender: normalizeText(message.in_number),
            receivedAtText: normalizeText(message.created_at || message.data_humans),
            content: normalizeText(message.text),
            sourceUrl: reference.sourceUrl,
          }));
      },
    },
    smstome: {
      key: "smstome",
      displayName: "SMSToMe",
      async listNumbers(filters) {
        const settings = currentSettings();
        const { document } = await fetchSmsToMeDocument("https://smstome.com", settings);
        const countryPages = [];
        toArray(document.querySelectorAll("a[href^='/country/']")).forEach((anchor) => {
          const href = anchor.getAttribute("href");
          const text = normalizeText(anchor.textContent);
          if (!href || !text) return;
          const countryName = normalizeText(text.replace(/\(\+\d+\)|\+\d+/g, ""));
          const countryCode = inferCountryCode(countryName) || text.match(/\+\d+/)?.[0] || "";
          countryPages.push({
            sourceUrl: absoluteUrl("https://smstome.com", href),
            countryName,
            countryCode,
          });
        });

        const dedupedCountryPages = [];
        const seenCountryUrls = new Set();
        for (const page of countryPages) {
          if (!page.sourceUrl || seenCountryUrls.has(page.sourceUrl)) continue;
          seenCountryUrls.add(page.sourceUrl);
          if (!matchesCountryFilter(page.countryCode, page.countryName, filters.countryCode, filters.countryName)) continue;
          dedupedCountryPages.push(page);
        }

        const candidates = [];
        for (const page of dedupedCountryPages) {
          const { document: countryDocument } = await fetchSmsToMeDocument(page.sourceUrl, settings);
          toArray(countryDocument.querySelectorAll("article.cp-phone-card")).forEach((card) => {
            const phoneAnchor = card.querySelector("a.cp-phone-card__number[href]");
            const href = phoneAnchor?.getAttribute("href");
            const phoneNumber = textOf(phoneAnchor);
            const latestActivityText = textOf(card.querySelector(".cp-phone-card__meta"));
            if (!href || !phoneNumber) return;
            candidates.push(buildPublicNumber(this, {
              sourceUrl: absoluteUrl("https://smstome.com", href),
              phoneNumber,
              countryName: page.countryName,
              countryCode: page.countryCode,
              latestActivityText,
            }));
          });
        }

        return await filterSmsToMeLiveNumbers(
          this,
          dedupeNumbers(candidates, Math.max(filters.limit || 8, 30)),
          filters.limit || 8,
        );
      },
      async readInbox(reference) {
        const settings = currentSettings();
        const { document } = await fetchSmsToMeDocument(reference.sourceUrl, settings);
        return toArray(document.querySelectorAll(".mp-table tbody tr")).map((row, index) => {
          const columns = toArray(row.children);
          const content = textOf(columns[2]);
          if (!content) return null;
          return buildInboxMessage(reference.phoneNumber, `smstome-${index}`, {
            sender: textOf(columns[0]),
            receivedAtText: textOf(columns[1]),
            content,
            sourceUrl: reference.sourceUrl,
          });
        }).filter(Boolean);
      },
    },
    receive_smss: {
      key: "receive_smss",
      displayName: "Receive SMSS",
      async listNumbers(filters) {
        const settings = currentSettings();
        const { document } = await fetchReceiveSmssDocument("https://receive-smss.com/", settings);
        const candidates = dedupeNumbers(
          parseReceiveSmssDirectoryCards(document, this).filter((item) =>
            matchesCountryFilter(item.countryCode, item.countryName, filters.countryCode, filters.countryName)
          ),
          Math.max(filters.limit || 8, 20),
        );
        const output = [];
        for (const number of candidates) {
          try {
            const messages = await this.readInbox(number);
            if (!hasRecentReceiveSmssVerificationActivity(messages)) continue;
            const latestVerificationMessage = messages.find((message) => isReceiveSmssVerificationLikeMessage(message));
            output.push({
              ...number,
              latestActivityText: latestVerificationMessage?.receivedAtText || number.latestActivityText,
            });
            if (output.length >= (filters.limit || 8)) break;
          } catch (error) {
            console.warn("Receive-SMSS liveness probe failed", number, error);
          }
        }
        return output;
      },
      async readInbox(reference) {
        const settings = currentSettings();
        const { document } = await fetchReceiveSmssDocument(reference.sourceUrl, settings);
        return parseReceiveSmssInboxMessages(document, reference.sourceUrl, reference.phoneNumber);
      },
    },
    receive_sms_free_cc: {
      key: "receive_sms_free_cc",
      displayName: "Receive SMS Free",
      async listNumbers(filters) {
        const settings = currentSettings();
        const listUrl = await resolveReceiveSmsFreeCcListUrl(settings, filters);
        const { document } = await fetchReceiveSmsFreeCcDocument(listUrl, settings);
        const numbers = parseTempLikeDirectory(
          document,
          this,
          listUrl,
          /\/[A-Za-z-]+-Phone-Number\/\d+\/$/i,
          filters,
        );
        return await filterReceiveSmsFreeCcLiveNumbers(this, numbers, filters.limit || 8);
      },
      async readInbox(reference) {
        const settings = currentSettings();
        const { document } = await fetchReceiveSmsFreeCcDocument(reference.sourceUrl, settings);
        return [
          ...parseDirectChatMessages(document, reference.sourceUrl, reference.phoneNumber),
          ...parseCardMessages(document, reference.sourceUrl, reference.phoneNumber),
        ];
      },
    },
    yunduanxin: {
      key: "yunduanxin",
      displayName: "云短信",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://yunduanxin.net/");
        const results = [];
        toArray(document.querySelectorAll(".number-boxes-item")).forEach((card) => {
          const href = card.querySelector("a[href*='/info/']")?.getAttribute("href");
          const phoneNumber = textOf(card.querySelector(".number-boxes-item-number"));
          const countryName = textOf(card.querySelector(".number-boxes-item-country"));
          const countryCode = inferCountryCode(countryName, phoneNumber);
          if (!href || !phoneNumber) return;
          if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;
          results.push(buildPublicNumber(this, {
            sourceUrl: absoluteUrl("https://yunduanxin.net/", href),
            phoneNumber,
            countryName,
            countryCode,
          }));
        });
        const candidates = dedupeNumbers(results, filters.limit);
        const live = [];
        for (const number of candidates) {
          try {
            const messages = await this.readInbox(number);
            const latestVerification = messages.find((message) => isYunduanxinVerificationLikeMessage(message));
            if (!latestVerification) continue;
            const ageMs = parseYunduanxinRelativeAgeMs(latestVerification.receivedAtText);
            if (ageMs === undefined || ageMs > YUNDUANXIN_VERIFICATION_WINDOW_MS) continue;
            live.push({
              ...number,
              latestActivityText: latestVerification.receivedAtText || number.latestActivityText,
            });
            if (live.length >= (filters.limit || candidates.length)) break;
          } catch (error) {
            console.warn("YunDuanXin liveness probe failed", number, error);
          }
        }
        return live;
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        return toArray(document.querySelectorAll(".row.border-bottom.table-hover")).map((row, index) => {
          const columns = toArray(row.children);
          const content = textOf(columns[2]);
          if (!content) return null;
          return buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(columns[0]?.querySelector(".mobile_hide")),
            receivedAtText: textOf(columns[1]),
            content,
            sourceUrl: reference.sourceUrl,
          });
        }).filter(Boolean);
      },
    },
    sms24: {
      key: "sms24",
      displayName: "SMS24",
      async listNumbers(filters) {
        const { document } = await requestDocument("https://sms24.me/en/numbers");
        const results = [];
        toArray(document.querySelectorAll("a[href*='/en/numbers/']")).forEach((anchor) => {
          const href = anchor.getAttribute("href");
          const raw = normalizeText(anchor.textContent);
          const phoneNumber = normalizeText(raw.match(/\+\d[\d\s]*/)?.[0] || "");
          const countryName = normalizeText(raw.replace(phoneNumber, ""));
          const countryCode = inferCountryCode(countryName, phoneNumber);
          if (!href || !phoneNumber) return;
          if (!matchesCountryFilter(countryCode, countryName, filters.countryCode, filters.countryName)) return;
          results.push(buildPublicNumber(this, {
            sourceUrl: absoluteUrl("https://sms24.me/en", href),
            phoneNumber,
            countryName,
            countryCode,
          }));
        });
        return dedupeNumbers(results, filters.limit);
      },
      async readInbox(reference) {
        const { document } = await requestDocument(reference.sourceUrl);
        const messages = [];
        toArray(document.querySelectorAll("dt")).forEach((dt, index) => {
          const dd = dt.nextElementSibling;
          if (!dd || dd.tagName.toLowerCase() !== "dd") return;
          const content = textOf(dd.querySelector(".text-break"));
          if (!content || /messages not yet received/i.test(content)) return;
          messages.push(buildInboxMessage(reference.phoneNumber, index, {
            sender: textOf(dd.querySelector("a[title^='SMS From']")).replace(/^From:\s*/i, ""),
            receivedAtIso: dd.querySelector("[data-created]")?.getAttribute("data-created") || "",
            content,
            sourceUrl: reference.sourceUrl,
          }));
        });
        return messages;
      },
    },
    hero_sms: {
      key: "hero_sms",
      displayName: "HeroSMS",
      async listNumbers(filters) {
        const settings = currentSettings();
        const resolved = resolveHeroSmsSettings(settings);
        const countryMeta = await resolveHeroSmsCountryMeta(settings);
        if (!matchesCountryFilter(countryMeta.countryCode, countryMeta.countryName, filters.countryCode, filters.countryName)) {
          return [];
        }

        let lease = resolved.allowReuse ? findReusableHeroSmsLease(settings) : undefined;
        if (!lease) {
          const operator = await selectHeroSmsOperator(settings);
          const payload = await requestHeroSms("getNumberV2", {
            service: resolved.service,
            country: resolved.countryId,
            operator,
          }, settings);
          const created = parseHeroSmsNumberResponse(payload);
          lease = {
            activationId: created.activationId,
            phoneNumber: created.phoneNumber,
            activationCost: created.activationCost,
            service: resolved.service,
            countryId: resolved.countryId,
            countryCode: countryMeta.countryCode,
            countryName: countryMeta.countryName,
            operator,
            businessKey: resolved.businessKey,
            maxBindingsPerPhone: resolved.maxBindingsPerPhone,
            assignmentCount: 0,
            openedAtIso: new Date().toISOString(),
            leaseExpiresAtIso: new Date(Date.now() + resolved.leaseWindowSeconds * 1000).toISOString(),
            refundableCancelAvailableAtIso: new Date(Date.now() + resolved.refundableCancelWindowSeconds * 1000).toISOString(),
          };
        }

        lease = reserveHeroSmsLease(lease);
        const assignmentIndex = Number(lease.assignmentCount || 1);
        return [buildPublicNumber(this, {
          sourceUrl: `${resolved.baseUrl}?action=getStatusV2&id=${encodeURIComponent(String(lease.activationId))}`,
          phoneNumber: lease.phoneNumber,
          countryName: lease.countryName,
          countryCode: lease.countryCode,
          latestActivityText: `Paid lease ${assignmentIndex}/${lease.maxBindingsPerPhone}`,
          activationId: lease.activationId,
          activationCost: lease.activationCost,
          businessKey: lease.businessKey,
          assignmentIndex,
          maxBindingsPerPhone: lease.maxBindingsPerPhone,
          refundableCancelAvailableAtIso: lease.refundableCancelAvailableAtIso,
          leaseExpiresAtIso: lease.leaseExpiresAtIso,
          numberId: encodeRef({
            providerKey: this.key,
            sourceUrl: `${resolved.baseUrl}?action=getStatusV2&id=${encodeURIComponent(String(lease.activationId))}`,
            phoneNumber: lease.phoneNumber,
            countryName: lease.countryName || "",
            countryCode: lease.countryCode || "",
            activationId: lease.activationId,
            businessKey: lease.businessKey,
            assignmentIndex,
            maxBindingsPerPhone: lease.maxBindingsPerPhone,
          }),
        })];
      },
      async readInbox(reference) {
        const settings = currentSettings();
        const payload = decodeRef(reference.numberId);
        const activationId = Number.parseInt(String(payload.activationId || ""), 10);
        if (!Number.isFinite(activationId)) {
          throw new Error("HeroSMS numberId 缺少 activationId。");
        }
        const status = await requestHeroSms("getStatusV2", { id: activationId }, settings);
        const messages = [];
        if (normalizeText(status?.sms?.text)) {
          messages.push(buildInboxMessage(reference.phoneNumber, `hero-sms-sms-${activationId}`, {
            sender: "HeroSMS",
            receivedAtIso: status.sms.dateTime || "",
            content: normalizeText(status.sms.text),
            sourceUrl: reference.sourceUrl,
          }));
        }
        if (normalizeText(status?.call?.text)) {
          messages.push(buildInboxMessage(reference.phoneNumber, `hero-sms-call-${activationId}`, {
            sender: normalizeText(status.call.from || "HeroSMS Call"),
            receivedAtIso: status.call.dateTime || "",
            content: normalizeText(status.call.text),
            sourceUrl: status.call.url || reference.sourceUrl,
          }));
        }
        return messages;
      },
      async cancelCurrent(reference) {
        const settings = currentSettings();
        const payload = decodeRef(reference.numberId);
        const activationId = Number.parseInt(String(payload.activationId || ""), 10);
        if (!Number.isFinite(activationId)) {
          throw new Error("HeroSMS numberId 缺少 activationId。");
        }
        await requestHeroSms("setStatus", { id: activationId, status: 8 }, settings);
        markHeroSmsLeaseCancelled(activationId);
      },
    },
  };

  function orderedProviderKeys(settings) {
    const explicit = String(settings.explicitProviderKey || "").trim();
    const selected = splitCsv(settings.selectedProvidersCsv || DEFAULTS.selectedProvidersCsv).filter((key) => PROVIDERS[key]);
    const pool = settings.providerMode === "explicit" && explicit
      ? [explicit]
      : (selected.length ? selected : Object.keys(PROVIDERS));

    return [...new Set(pool)].sort((left, right) => providerScore(right) - providerScore(left));
  }

  function currentNumberKey(item) {
    return item ? `${item.providerKey}:${item.numberId}` : "";
  }

  function upsertHistory(entry) {
    const key = currentNumberKey(entry);
    state.history = state.history.filter((item) => currentNumberKey(item) !== key);
    state.history.unshift(entry);
    state.history = state.history.slice(0, MAX_HISTORY);
    persistRuntime();
  }

  function setCurrentNumber(item, source = "available") {
    if (!item) return;
    const decodedRef = item.numberId ? (() => {
      try {
        return decodeRef(item.numberId);
      } catch {
        return {};
      }
    })() : {};
    state.currentNumber = {
      providerKey: item.providerKey,
      providerDisplayName: item.providerDisplayName || PROVIDERS[item.providerKey]?.displayName || item.providerKey,
      numberId: item.numberId,
      sourceUrl: item.sourceUrl,
      phoneNumber: item.phoneNumber,
      countryName: item.countryName || "",
      countryCode: item.countryCode || "",
      selectedAtIso: new Date().toISOString(),
      selectedFrom: source,
      messageCount: 0,
      lastCode: "",
      lastFetchedAtIso: "",
      activationId: item.activationId ?? decodedRef.activationId,
      activationCost: item.activationCost,
      businessKey: item.businessKey ?? decodedRef.businessKey,
      assignmentIndex: item.assignmentIndex ?? decodedRef.assignmentIndex,
      maxBindingsPerPhone: item.maxBindingsPerPhone ?? decodedRef.maxBindingsPerPhone,
      refundableCancelAvailableAtIso: item.refundableCancelAvailableAtIso,
      leaseExpiresAtIso: item.leaseExpiresAtIso,
    };
    state.currentMessages = [];
    state.lastCode = "";
    upsertHistory(state.currentNumber);
    render();
  }

  function updateCurrentNumber(patch) {
    if (!state.currentNumber) return;
    state.currentNumber = Object.assign({}, state.currentNumber, patch || {});
    upsertHistory(state.currentNumber);
  }

  async function loadAvailableNumbers(options = {}) {
    if (state.busy) return null;
    state.busy = true;
    render();

    const settings = currentSettings();
    const filters = {
      countryName: String(settings.countryName || "").trim(),
      countryCode: String(settings.countryCode || "").trim(),
      limit: intSetting("overallLimit", 8),
    };

    try {
      const ordered = orderedProviderKeys(settings);
      const output = [];
      const errors = [];

      for (const key of ordered) {
        const provider = PROVIDERS[key];
        if (!provider) continue;
        if (providerIsCooling(key)) {
          const seconds = Math.ceil(providerCoolingRemainingMs(key) / 1000);
          errors.push(`${provider.displayName} 冷却中，约 ${seconds} 秒后恢复。`);
          continue;
        }

        try {
          const items = await provider.listNumbers(filters);
          recordProviderSuccess(key);
          output.push(...items);
          if (output.length >= filters.limit) break;
        } catch (error) {
          recordProviderFailure(key, error);
          errors.push(`${provider.displayName}：${error.message}`);
          if (settings.providerMode === "explicit") break;
        }
      }

      state.availableNumbers = dedupeNumbers(output, filters.limit);
      if (!state.availableNumbers.length) {
        setStatus(errors[0] || "当前没有可用手机号。", "warn");
        return null;
      }

      if (options.selectFirst !== false) {
        setCurrentNumber(state.availableNumbers[0], "fetch");
        setStatus(`已获取手机号：${state.availableNumbers[0].phoneNumber}`, "success");
        if (options.fillPhone || boolSetting("autoFillPhoneOnAcquire")) {
          await fillPhoneIntoPage(state.availableNumbers[0].phoneNumber);
        }
      } else {
        setStatus(`已获取 ${state.availableNumbers.length} 个候选手机号。`, "success");
        render();
      }

      return state.availableNumbers[0] || null;
    } finally {
      state.busy = false;
      render();
    }
  }

  function compileCodeRegex() {
    const pattern = String(loadSetting("codeRegex") || DEFAULTS.codeRegex).trim() || DEFAULTS.codeRegex;
    try {
      return new RegExp(pattern, "g");
    } catch {
      return new RegExp(DEFAULTS.codeRegex, "g");
    }
  }

  function extractCodeCandidates(text) {
    const regex = compileCodeRegex();
    const content = String(text || "");
    const found = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const candidate = String(match[1] || match[0] || "").replace(/[^\da-zA-Z]/g, "");
      if (!candidate) continue;
      if (!found.includes(candidate)) found.push(candidate);
      if (!regex.global || found.length >= 8) break;
    }

    return found;
  }

  function sortMessages(messages) {
    const newestFirst = boolSetting("newestFirst");
    return [...messages].sort((left, right) => {
      const leftTime = Date.parse(left.receivedAtIso || left.receivedAtText || "") || 0;
      const rightTime = Date.parse(right.receivedAtIso || right.receivedAtText || "") || 0;
      return newestFirst ? (rightTime - leftTime) : (leftTime - rightTime);
    });
  }

  function selectOtpMessage(messages, current) {
    const sorted = sortMessages(messages);
    const senderNeedle = normalizeText(loadSetting("senderContains")).toLowerCase();
    const selectedAtMs = Date.parse(current?.selectedAtIso || "") || 0;
    let historicalOnly = false;

    for (const message of sorted) {
      const haystack = `${message.sender || ""}\n${message.content || ""}`.toLowerCase();
      if (senderNeedle && !haystack.includes(senderNeedle)) continue;

      const codes = extractCodeCandidates(message.content || "");
      if (!codes.length) continue;

      const messageMs = Date.parse(message.receivedAtIso || message.receivedAtText || "") || 0;
      if (selectedAtMs && messageMs && messageMs + 30000 < selectedAtMs) {
        historicalOnly = true;
        continue;
      }

      return {
        code: codes[0],
        message,
      };
    }

    return historicalOnly ? { code: "", message: null, historicalOnly: true } : null;
  }

  async function readCurrentInbox(options = {}) {
    if (!state.currentNumber) {
      setStatus("当前还没有活动手机号，请先获取一个手机号。", "warn");
      return null;
    }

    const provider = PROVIDERS[state.currentNumber.providerKey];
    if (!provider) {
      setStatus("当前号码对应的 provider 不存在。", "error");
      return null;
    }

    if (!state.polling) {
      state.busy = true;
      render();
    }

    try {
      const reference = decodeRef(state.currentNumber.numberId);
      const messages = await provider.readInbox(reference);
      recordProviderSuccess(provider.key);
      state.currentMessages = sortMessages(messages);
      updateCurrentNumber({
        lastFetchedAtIso: new Date().toISOString(),
        messageCount: state.currentMessages.length,
      });

      const selected = selectOtpMessage(state.currentMessages, state.currentNumber);
      if (selected?.code) {
        state.lastCode = selected.code;
        updateCurrentNumber({
          lastCode: selected.code,
        });
        setStatus(`已读到验证码：${selected.code}`, "success");
        if (options.fillCode || boolSetting("autoFillCodeOnRead")) {
          await fillCodeIntoPage(selected.code);
        } else {
          render();
        }
        return selected;
      }

      if (selected?.historicalOnly) {
        setStatus("当前只找到旧短信里的验证码，已忽略。", "warn");
      } else if (!options.silentNoCode) {
        setStatus("当前还没有读到验证码。", "info");
      }
      render();
      return null;
    } catch (error) {
      recordProviderFailure(provider.key, error);
      setStatus(`读取短信失败：${error.message}`, "error");
      return null;
    } finally {
      if (!state.polling) {
        state.busy = false;
      }
      render();
    }
  }

  async function pollForCode(fillCode) {
    if (state.polling) return;
    if (!state.currentNumber) {
      setStatus("当前还没有活动手机号，请先获取一个手机号。", "warn");
      return;
    }

    state.polling = true;
    state.stopRequested = false;
    render();

    const timeoutMs = intSetting("timeoutSeconds", 180) * 1000;
    const intervalMs = intSetting("pollSeconds", 5) * 1000;
    const deadline = Date.now() + timeoutMs;
    setStatus(`开始轮询：${state.currentNumber.phoneNumber}`, "info");

    try {
      while (!state.stopRequested && Date.now() < deadline) {
        const result = await readCurrentInbox({ fillCode, silentNoCode: true });
        if (result?.code) return result;
        if (state.stopRequested) break;

        const waitSeconds = Math.ceil(Math.min(intervalMs, deadline - Date.now()) / 1000);
        if (waitSeconds > 0) {
          setStatus(`未读到验证码，${waitSeconds} 秒后继续轮询。`, "info");
          await sleep(waitSeconds * 1000);
        }
      }

      if (state.stopRequested) {
        setStatus("轮询已停止。", "warn");
      } else {
        setStatus("轮询超时，未读到新的验证码。", "warn");
      }
    } finally {
      state.polling = false;
      state.stopRequested = false;
      render();
    }
  }

  function stopPolling() {
    if (!state.polling) return;
    state.stopRequested = true;
    setStatus("已请求停止轮询。", "warn");
    render();
  }

  function editableFields() {
    return toArray(document.querySelectorAll("input, textarea")).filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest(`#${ROOT_ID}`)) return false;
      if (!document.contains(node)) return false;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (node.disabled || node.readOnly) return false;
      return true;
    });
  }

  function scorePhoneField(node) {
    const text = [
      node.type,
      node.name,
      node.id,
      node.placeholder,
      node.getAttribute("aria-label"),
      node.getAttribute("autocomplete"),
      node.getAttribute("inputmode"),
    ].join(" ").toLowerCase();

    let score = 0;
    if (node.type === "tel") score += 7;
    if ((node.getAttribute("autocomplete") || "").toLowerCase().includes("tel")) score += 6;
    if ((node.getAttribute("inputmode") || "").toLowerCase() === "tel") score += 3;
    ["phone", "mobile", "tel", "手机号", "手机", "电话", "联系号码"].forEach((keyword) => {
      if (text.includes(keyword)) score += 4;
    });
    if (text.includes("email")) score -= 8;
    if (text.includes("code") || text.includes("otp") || text.includes("验证码")) score -= 10;
    return score;
  }

  function scoreCodeField(node) {
    const text = [
      node.type,
      node.name,
      node.id,
      node.placeholder,
      node.getAttribute("aria-label"),
      node.getAttribute("autocomplete"),
      node.getAttribute("inputmode"),
    ].join(" ").toLowerCase();

    let score = 0;
    if ((node.getAttribute("autocomplete") || "").toLowerCase() === "one-time-code") score += 10;
    if ((node.getAttribute("inputmode") || "").toLowerCase() === "numeric") score += 4;
    ["code", "otp", "pin", "验证码", "短信码", "校验码", "动态码"].forEach((keyword) => {
      if (text.includes(keyword)) score += 5;
    });
    if (String(node.maxLength || "") === "1") score += 3;
    if (text.includes("email") || text.includes("phone")) score -= 6;
    return score;
  }

  function detectPhoneField() {
    const candidates = editableFields()
      .map((node) => ({ node, score: scorePhoneField(node) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.node || null;
  }

  function detectCodeFields() {
    const fields = editableFields();
    const bestSingle = fields
      .map((node) => ({ node, score: scoreCodeField(node) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const segmented = fields
      .filter((node) => scoreCodeField(node) > 0)
      .filter((node) => String(node.maxLength || "") === "1" || (node.getAttribute("inputmode") || "").toLowerCase() === "numeric");

    const grouped = new Map();
    segmented.forEach((node) => {
      const container = node.closest("form, [role='dialog'], section, main, div") || node.parentElement;
      if (!container) return;
      const key = `${container.tagName}:${container.className}:${container.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(node);
    });

    let bestGroup = [];
    grouped.forEach((nodes) => {
      if (nodes.length >= 4 && nodes.length <= 8 && nodes.length > bestGroup.length) {
        bestGroup = nodes;
      }
    });

    if (bestGroup.length >= 4) {
      return { kind: "segmented", nodes: bestGroup };
    }

    return { kind: "single", nodes: bestSingle[0] ? [bestSingle[0].node] : [] };
  }

  function clearHighlights() {
    document.querySelectorAll(".esms-highlight-phone, .esms-highlight-code").forEach((node) => {
      node.classList.remove("esms-highlight-phone", "esms-highlight-code");
    });
  }

  function applyHighlights() {
    clearHighlights();
    if (!boolSetting("highlightTargets")) return;
    if (state.detectedTargets.phone && document.contains(state.detectedTargets.phone)) {
      state.detectedTargets.phone.classList.add("esms-highlight-phone");
    }
    state.detectedTargets.code.forEach((node) => {
      if (node && document.contains(node)) {
        node.classList.add("esms-highlight-code");
      }
    });
  }

  function describeElement(node) {
    if (!node) return "未找到";
    const bits = [
      node.tagName?.toLowerCase?.() || "element",
      node.id ? `#${node.id}` : "",
      node.name ? `[name="${node.name}"]` : "",
      node.placeholder ? `placeholder="${node.placeholder}"` : "",
    ].filter(Boolean);
    return bits.join(" ");
  }

  function refreshDetectedTargets() {
    state.detectedTargets.phone = detectPhoneField();
    const code = detectCodeFields();
    state.detectedTargets.code = code.nodes;
    state.detectedTargets.kind = code.kind;
    applyHighlights();
    setStatus(`已刷新字段检测：手机号 -> ${describeElement(state.detectedTargets.phone)}；验证码 -> ${state.detectedTargets.code.length ? state.detectedTargets.code.map(describeElement).join(" / ") : "未找到"}`, "info");
  }

  function canOverwrite(node) {
    if (boolSetting("forceFillNonEmpty")) return true;
    return !String(node.value || "").trim();
  }

  function setControlValue(node, value) {
    const setter = Object.getOwnPropertyDescriptor(node.constructor.prototype, "value")?.set;
    if (setter) {
      setter.call(node, value);
    } else {
      node.value = value;
    }
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillPhoneIntoPage(phoneOverride) {
    const phone = String(phoneOverride || state.currentNumber?.phoneNumber || "").trim();
    if (!phone) {
      setStatus("当前没有可填入的手机号。", "warn");
      return false;
    }

    let target = state.detectedTargets.phone;
    if (!target || !document.contains(target)) {
      target = detectPhoneField();
      state.detectedTargets.phone = target;
      applyHighlights();
    }

    if (!target) {
      setStatus("当前页面没有检测到可写的手机号输入框。", "warn");
      return false;
    }
    if (!canOverwrite(target)) {
      setStatus("手机号输入框已有内容，当前未开启覆盖模式。", "warn");
      return false;
    }

    target.focus();
    setControlValue(target, phone);
    setStatus(`已填入手机号：${describeElement(target)}`, "success");
    return true;
  }

  async function fillCodeIntoPage(codeOverride) {
    const code = String(codeOverride || state.lastCode || state.currentNumber?.lastCode || "").trim();
    if (!code) {
      setStatus("当前没有可填入的验证码。", "warn");
      return false;
    }

    let targets = state.detectedTargets.code.filter((node) => document.contains(node));
    let kind = state.detectedTargets.kind;

    if (!targets.length) {
      const detected = detectCodeFields();
      targets = detected.nodes;
      kind = detected.kind;
      state.detectedTargets.code = targets;
      state.detectedTargets.kind = kind;
      applyHighlights();
    }

    if (!targets.length) {
      setStatus("当前页面没有检测到可写的验证码输入框。", "warn");
      return false;
    }

    if (kind === "segmented" && targets.length >= 4) {
      const chars = code.split("");
      let filled = 0;
      targets.forEach((node, index) => {
        if (!canOverwrite(node)) return;
        setControlValue(node, chars[index] || "");
        filled += 1;
      });
      setStatus(`已把验证码拆分填入 ${filled} 个格子。`, "success");
      return true;
    }

    const target = targets[0];
    if (!canOverwrite(target)) {
      setStatus("验证码输入框已有内容，当前未开启覆盖模式。", "warn");
      return false;
    }

    target.focus();
    setControlValue(target, code);
    setStatus(`已填入验证码：${describeElement(target)}`, "success");
    return true;
  }

  async function copyText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch {}
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    return false;
  }

  function renderProviderOptions() {
    const current = String(loadSetting("explicitProviderKey") || "");
    return Object.keys(PROVIDERS).map((key) => `
      <option value="${escapeHtml(key)}"${key === current ? " selected" : ""}>${escapeHtml(PROVIDERS[key].displayName)}</option>
    `).join("");
  }

  function renderModeControls() {
    const settings = currentSettings();
    const mode = buildUserscriptModeUiModel(settings, state.currentNumber);
    return `
      <div class="esms-mode-card">
        <div class="esms-mode-row">
          <span class="esms-runtime-pill is-${escapeHtml(mode.modeTone)}">${escapeHtml(mode.modeLabel)}</span>
          <span class="esms-runtime-pill is-${escapeHtml(mode.tierTone)}">${escapeHtml(mode.tierLabel)}</span>
          <span class="esms-runtime-pill">${escapeHtml(mode.currentProviderKey || "未指定 Provider")}</span>
        </div>
        <div class="esms-mode-actions">
          <button type="button" data-action="set-mode-auto"${mode.providerMode === "auto" ? " disabled" : ""}>自动模式</button>
          <button type="button" data-action="set-mode-explicit"${mode.providerMode === "explicit" ? " disabled" : ""}>指定模式</button>
          <select data-setting="explicitProviderKey">
            ${renderProviderOptions()}
          </select>
        </div>
        ${mode.warningText ? `<div class="esms-mode-warning${mode.paid ? " is-paid" : ""}">${escapeHtml(mode.warningText)}</div>` : ""}
      </div>
    `;
  }

  function renderMiniBar() {
    const currentPhone = String(state.currentNumber?.phoneNumber || "").trim();
    const currentCode = String(state.lastCode || state.currentNumber?.lastCode || "").trim();

    return `
      <div id="${MINI_BAR_ID}">
        <div class="esms-side-row">
          <button type="button" class="esms-side-btn" data-action="toggle-panel" title="${state.panelCollapsed ? "展开面板" : "收起面板"}">设</button>
        </div>
        <div class="esms-side-row">
          ${currentPhone ? `<button type="button" class="esms-mini-chip" data-action="copy-phone" title="复制手机号">${escapeHtml(currentPhone)}</button>` : ""}
          <button type="button" class="esms-side-btn" data-action="acquire-fill-phone" title="获取并填手机号"${state.busy ? " disabled" : ""}>号</button>
        </div>
        <div class="esms-side-row">
          ${currentCode ? `<button type="button" class="esms-mini-chip" data-action="copy-code" title="复制验证码">${escapeHtml(currentCode)}</button>` : ""}
          <button type="button" class="esms-side-btn" data-action="${state.polling ? "stop-polling" : "poll-fill"}" title="${state.polling ? "停止轮询" : "轮询并填码"}"${state.currentNumber || state.polling ? "" : " disabled"}>${state.polling ? "停" : "码"}</button>
        </div>
      </div>
    `;
  }

  function renderSummary() {
    const current = state.currentNumber;
    const heroSmsLeaseSummary = buildHeroSmsLeaseSummary(current);
    const currentProviderSupportsCancel = Boolean(current && PROVIDERS[current.providerKey] && typeof PROVIDERS[current.providerKey].cancelCurrent === "function");
    const modeUi = buildUserscriptModeUiModel(currentSettings(), current);
    return `
      <div class="esms-summary-card">
        <div class="esms-summary-top">
          <div>
            <div class="esms-card-title">当前手机号</div>
            <div class="esms-current-phone">${escapeHtml(current?.phoneNumber || "未选择")}</div>
          </div>
          <div class="esms-code-box">
            <span>验证码</span>
            <strong>${escapeHtml(state.lastCode || current?.lastCode || "暂无")}</strong>
          </div>
        </div>
        <div class="esms-current-meta">
          <span>${escapeHtml(current?.providerDisplayName || "暂无服务商")}</span>
          <span class="esms-inline-badge is-${escapeHtml(modeUi.tierTone)}">${escapeHtml(modeUi.tierLabel)}</span>
          <span>${escapeHtml(current?.countryName || current?.countryCode || "地区未知")}</span>
          <span>短信 ${escapeHtml(String(current?.messageCount || 0))}</span>
        </div>
        <div class="esms-current-meta">
          <span>取号：${escapeHtml(formatDateTime(current?.selectedAtIso || ""))}</span>
          <span>最近读取：${escapeHtml(formatDateTime(current?.lastFetchedAtIso || ""))}</span>
        </div>
        ${heroSmsLeaseSummary.length ? `
        <div class="esms-current-meta">
          ${heroSmsLeaseSummary.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>` : ""}
        <div class="esms-mini-actions">
          <button type="button" data-action="fill-phone"${current?.phoneNumber ? "" : " disabled"}>填手机号</button>
          <button type="button" data-action="fill-code"${state.lastCode || current?.lastCode ? "" : " disabled"}>填验证码</button>
          <button type="button" data-action="copy-phone"${current?.phoneNumber ? "" : " disabled"}>复制手机号</button>
          <button type="button" data-action="copy-code"${state.lastCode || current?.lastCode ? "" : " disabled"}>复制验证码</button>
          <button type="button" data-action="cancel-current"${current?.phoneNumber && currentProviderSupportsCancel ? "" : " disabled"}>${current?.providerKey === "hero_sms" && isHeroSmsCancelableNow(current) ? "退款取消当前号" : "取消当前号"}</button>
          <button type="button" data-action="detect-targets">刷新定位</button>
        </div>
      </div>
    `;
  }

  function renderActionGrid() {
    const currentProviderSupportsCancel = Boolean(state.currentNumber && PROVIDERS[state.currentNumber.providerKey] && typeof PROVIDERS[state.currentNumber.providerKey].cancelCurrent === "function");
    return `
      <div class="esms-action-grid">
        <button type="button" data-action="acquire-number"${state.busy ? " disabled" : ""}>获取手机号</button>
        <button type="button" data-action="acquire-fill-phone"${state.busy ? " disabled" : ""}>获取并填手机号</button>
        <button type="button" data-action="read-once"${state.currentNumber ? "" : " disabled"}>读取一次</button>
        <button type="button" data-action="${state.polling ? "stop-polling" : "poll-fill"}"${state.currentNumber || state.polling ? "" : " disabled"}>${state.polling ? "停止轮询" : "轮询并填码"}</button>
        <button type="button" data-action="cancel-current"${state.currentNumber && currentProviderSupportsCancel ? "" : " disabled"}>${state.currentNumber?.providerKey === "hero_sms" && isHeroSmsCancelableNow(state.currentNumber) ? "退款取消当前号" : "取消当前号"}</button>
      </div>
    `;
  }

  function renderAvailableNumbers() {
    if (!state.availableNumbers.length) {
      return `<div class="esms-empty">暂无候选号码。点击“获取手机号”开始抓取。</div>`;
    }

    const currentKey = currentNumberKey(state.currentNumber);
    return state.availableNumbers.slice(0, 6).map((item, index) => {
      const active = currentNumberKey(item) === currentKey;
      return `
        <div class="esms-list-card${active ? " is-active" : ""}">
          <div class="esms-list-main">
            <div class="esms-list-title">${escapeHtml(item.phoneNumber || "未知号码")}</div>
            <div class="esms-list-meta">
              <span>${escapeHtml(item.providerDisplayName || item.providerKey)}</span>
              <span>${escapeHtml(item.countryName || item.countryCode || "地区未知")}</span>
              <span>${escapeHtml(item.latestActivityText || "暂无活动时间")}</span>
            </div>
          </div>
          <div class="esms-list-actions">
            <button type="button" data-action="use-available" data-index="${index}">设为当前</button>
            <button type="button" data-action="read-available" data-index="${index}">读取</button>
            <button type="button" data-action="poll-available" data-index="${index}">轮询</button>
            <a href="${escapeHtml(item.sourceUrl || "#")}" target="_blank" rel="noreferrer">源站</a>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderMessages() {
    if (!state.currentMessages.length) {
      return `<div class="esms-empty">暂无短信。先选择号码，再点击“读取一次”或“轮询并填码”。</div>`;
    }

    return state.currentMessages.slice(0, 6).map((message) => {
      const codes = extractCodeCandidates(message.content || "");
      return `
        <div class="esms-message-card">
          <div class="esms-message-head">
            <strong>${escapeHtml(message.sender || "未知发送方")}</strong>
            <span>${escapeHtml(message.receivedAtText || formatDateTime(message.receivedAtIso || ""))}</span>
          </div>
          <div class="esms-message-codes">
            ${codes.length
              ? codes.map((code) => `<span class="esms-code-pill">${escapeHtml(code)}</span>`).join("")
              : `<span class="esms-code-pill is-muted">未识别到验证码</span>`}
          </div>
          <div class="esms-message-preview">${escapeHtml(clipText(message.content || "", 180))}</div>
          <div class="esms-message-foot">
            <a href="${escapeHtml(message.sourceUrl || "#")}" target="_blank" rel="noreferrer">查看源短信</a>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderHistory() {
    if (!state.history.length) {
      return `<div class="esms-empty">暂无历史记录。</div>`;
    }

    const currentKey = currentNumberKey(state.currentNumber);
    return state.history.slice(0, 6).map((item, index) => {
      const active = currentNumberKey(item) === currentKey;
      return `
        <div class="esms-list-card${active ? " is-active" : ""}">
          <div class="esms-list-main">
            <div class="esms-list-title">${escapeHtml(item.phoneNumber || "未知号码")}</div>
            <div class="esms-list-meta">
              <span>${escapeHtml(item.providerDisplayName || item.providerKey)}</span>
              <span>${escapeHtml(item.countryName || item.countryCode || "地区未知")}</span>
              <span>验证码：${escapeHtml(item.lastCode || "暂无")}</span>
              <span>${escapeHtml(formatDateTime(item.selectedAtIso || ""))}</span>
            </div>
          </div>
          <div class="esms-list-actions">
            <button type="button" data-action="use-history" data-index="${index}">设为当前</button>
            <button type="button" data-action="history-fill-phone" data-index="${index}">填手机号</button>
            <button type="button" data-action="history-read" data-index="${index}">读取</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderSettings() {
    const settings = currentSettings();
    return `
      <details class="esms-block">
        <summary>设置</summary>
        <div class="esms-form-grid">
          <label class="esms-field">
            <span>运行模式</span>
            <select data-setting="providerMode">
              <option value="auto"${settings.providerMode === "auto" ? " selected" : ""}>自动</option>
              <option value="explicit"${settings.providerMode === "explicit" ? " selected" : ""}>指定</option>
            </select>
          </label>
          <label class="esms-field">
            <span>指定服务商</span>
            <select data-setting="explicitProviderKey"${settings.providerMode === "explicit" ? "" : " disabled"}>
              ${renderProviderOptions()}
            </select>
          </label>
          <label class="esms-field">
            <span>国家名称</span>
            <input type="text" data-setting="countryName" value="${escapeHtml(settings.countryName || "")}" placeholder="如 United States / 香港" />
          </label>
          <label class="esms-field">
            <span>国家区号</span>
            <input type="text" data-setting="countryCode" value="${escapeHtml(settings.countryCode || "")}" placeholder="如 +1 / +44" />
          </label>
          <label class="esms-field">
            <span>候选数量</span>
            <input type="number" min="1" data-setting="overallLimit" value="${escapeHtml(settings.overallLimit || "")}" />
          </label>
          <label class="esms-field">
            <span>轮询间隔（秒）</span>
            <input type="number" min="1" data-setting="pollSeconds" value="${escapeHtml(settings.pollSeconds || "")}" />
          </label>
          <label class="esms-field">
            <span>轮询超时（秒）</span>
            <input type="number" min="1" data-setting="timeoutSeconds" value="${escapeHtml(settings.timeoutSeconds || "")}" />
          </label>
          <label class="esms-field">
            <span>发送方过滤</span>
            <input type="text" data-setting="senderContains" value="${escapeHtml(settings.senderContains || "")}" placeholder="如 Google / Telegram" />
          </label>
          <label class="esms-field esms-field-wide">
            <span>验证码正则</span>
            <input type="text" data-setting="codeRegex" value="${escapeHtml(settings.codeRegex || "")}" />
          </label>
          <label class="esms-field">
            <span>OnlineSIM API Key</span>
            <input type="text" data-setting="onlineSimApiKey" value="${escapeHtml(settings.onlineSimApiKey || "")}" placeholder="可选，优先走官方 API" />
          </label>
          <label class="esms-field">
            <span>SMSToMe 邮箱</span>
            <input type="text" data-setting="smsToMeEmail" value="${escapeHtml(settings.smsToMeEmail || "")}" placeholder="用于登录 smstome.com" />
          </label>
          <label class="esms-field">
            <span>SMSToMe 密码</span>
            <input type="password" data-setting="smsToMePassword" value="${escapeHtml(settings.smsToMePassword || "")}" placeholder="用于登录 smstome.com" />
          </label>
          <label class="esms-field">
            <span>Receive-SMSS 用户名</span>
            <input type="text" data-setting="receiveSmssUsername" value="${escapeHtml(settings.receiveSmssUsername || "")}" placeholder="用于登录 receive-smss.com" />
          </label>
          <label class="esms-field">
            <span>Receive-SMSS 密码</span>
            <input type="password" data-setting="receiveSmssPassword" value="${escapeHtml(settings.receiveSmssPassword || "")}" placeholder="用于登录 receive-smss.com" />
          </label>
          <label class="esms-field">
            <span>Receive-SMS-Free 邮箱</span>
            <input type="text" data-setting="receiveSmsFreeCcEmail" value="${escapeHtml(settings.receiveSmsFreeCcEmail || "")}" placeholder="用于登录 receive-sms-free.cc" />
          </label>
          <label class="esms-field">
            <span>Receive-SMS-Free 密码</span>
            <input type="password" data-setting="receiveSmsFreeCcPassword" value="${escapeHtml(settings.receiveSmsFreeCcPassword || "")}" placeholder="用于登录 receive-sms-free.cc" />
          </label>
          <label class="esms-field esms-field-wide">
            <span>HeroSMS API Key</span>
            <input type="text" data-setting="heroSmsApiKey" value="${escapeHtml(settings.heroSmsApiKey || "")}" placeholder="仅在显式选择 hero_sms 时使用" />
          </label>
          <label class="esms-field">
            <span>HeroSMS 业务</span>
            <input type="text" data-setting="heroSmsService" value="${escapeHtml(settings.heroSmsService || "")}" placeholder="如 dr" />
          </label>
          <label class="esms-field">
            <span>HeroSMS 国家 ID</span>
            <input type="number" min="1" data-setting="heroSmsCountry" value="${escapeHtml(settings.heroSmsCountry || "")}" />
          </label>
          <label class="esms-field">
            <span>HeroSMS 运营商</span>
            <input type="text" data-setting="heroSmsOperator" value="${escapeHtml(settings.heroSmsOperator || "")}" placeholder="留空则按策略选择" />
          </label>
          <label class="esms-field">
            <span>HeroSMS 策略</span>
            <select data-setting="heroSmsSelectionMode">
              <option value="balanced"${settings.heroSmsSelectionMode === "balanced" ? " selected" : ""}>balanced</option>
              <option value="price-first"${settings.heroSmsSelectionMode === "price-first" ? " selected" : ""}>price-first</option>
              <option value="success-first"${settings.heroSmsSelectionMode === "success-first" ? " selected" : ""}>success-first</option>
              <option value="stock-first"${settings.heroSmsSelectionMode === "stock-first" ? " selected" : ""}>stock-first</option>
            </select>
          </label>
          <label class="esms-field">
            <span>HeroSMS 业务键</span>
            <input type="text" data-setting="heroSmsBusinessKey" value="${escapeHtml(settings.heroSmsBusinessKey || "")}" placeholder="如 openai-bind" />
          </label>
          <label class="esms-field">
            <span>HeroSMS 单号席位</span>
            <input type="number" min="1" data-setting="heroSmsMaxBindingsPerPhone" value="${escapeHtml(settings.heroSmsMaxBindingsPerPhone || "")}" />
          </label>
        </div>
        <div class="esms-toggle-grid">
          <label><input type="checkbox" data-setting="newestFirst"${boolSetting("newestFirst") ? " checked" : ""} /> 优先看最新</label>
          <label><input type="checkbox" data-setting="autoFillPhoneOnAcquire"${boolSetting("autoFillPhoneOnAcquire") ? " checked" : ""} /> 获取手机号后自动填入</label>
          <label><input type="checkbox" data-setting="autoFillCodeOnRead"${boolSetting("autoFillCodeOnRead") ? " checked" : ""} /> 读到验证码后自动填入</label>
          <label><input type="checkbox" data-setting="forceFillNonEmpty"${boolSetting("forceFillNonEmpty") ? " checked" : ""} /> 允许覆盖已有内容</label>
          <label><input type="checkbox" data-setting="highlightTargets"${boolSetting("highlightTargets") ? " checked" : ""} /> 高亮检测到的输入框</label>
          <label><input type="checkbox" data-setting="heroSmsAllowReuse"${boolSetting("heroSmsAllowReuse") ? " checked" : ""} /> HeroSMS 允许复用</label>
        </div>
      </details>
    `;
  }

  function renderPanel() {
    if (state.panelCollapsed) return "";
    const settings = currentSettings();
    const modeUi = buildUserscriptModeUiModel(settings, state.currentNumber);
    return `
      <section id="${PANEL_ID}">
        <div class="esms-header">
          <div>
            <div class="esms-title">EasySMS</div>
            <div class="esms-subtitle">${escapeHtml(state.statusMessage)}</div>
          </div>
          <div class="esms-header-actions">
            <span class="esms-runtime-pill is-${escapeHtml(state.statusTone)}">${state.polling ? "轮询中" : state.busy ? "处理中" : "就绪"}</span>
            <span class="esms-runtime-pill is-${escapeHtml(modeUi.modeTone)}">${escapeHtml(modeUi.modeLabel)}</span>
            <span class="esms-runtime-pill is-${escapeHtml(modeUi.tierTone)}">${escapeHtml(modeUi.tierLabel)}</span>
            <button type="button" data-action="toggle-panel">收起</button>
          </div>
        </div>
        ${renderModeControls()}
        ${renderSummary()}
        ${renderActionGrid()}
        <details class="esms-block" open>
          <summary>候选号码</summary>
          ${renderAvailableNumbers()}
        </details>
        <details class="esms-block"${state.currentMessages.length ? " open" : ""}>
          <summary>最新短信</summary>
          ${renderMessages()}
        </details>
        ${renderSettings()}
        <details class="esms-block">
          <summary>历史</summary>
          ${renderHistory()}
        </details>
      </section>
    `;
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    document.body.appendChild(root);
    return root;
  }

  function render() {
    const root = ensureRoot();
    root.innerHTML = `${renderPanel()}${renderMiniBar()}`;
    applyHighlights();
    requestAnimationFrame(syncDockOffsets);
  }

  function onClick(event) {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action || "";
    const index = Number(actionNode.dataset.index);

    const run = async () => {
      switch (action) {
        case "toggle-panel":
          state.panelCollapsed = !state.panelCollapsed;
          persistRuntime();
          render();
          return;
        case "set-mode-auto":
          saveSetting("providerMode", "auto");
          setStatus("已切换到自动模式。", "info");
          render();
          return;
        case "set-mode-explicit":
          saveSetting("providerMode", "explicit");
          setStatus("已切换到指定模式。", "info");
          render();
          return;
        case "detect-targets":
          refreshDetectedTargets();
          return;
        case "acquire-number":
          await loadAvailableNumbers({ selectFirst: true, fillPhone: false });
          return;
        case "acquire-fill-phone":
          await loadAvailableNumbers({ selectFirst: true, fillPhone: true });
          return;
        case "read-once":
          await readCurrentInbox({ fillCode: false });
          return;
        case "poll-fill":
          await pollForCode(true);
          return;
        case "stop-polling":
          stopPolling();
          return;
        case "fill-phone":
          await fillPhoneIntoPage();
          return;
        case "fill-code":
          await fillCodeIntoPage();
          return;
        case "copy-phone":
          if (await copyText(state.currentNumber?.phoneNumber || "")) setStatus("已复制手机号。", "success");
          return;
        case "copy-code":
          if (await copyText(state.lastCode || state.currentNumber?.lastCode || "")) setStatus("已复制验证码。", "success");
          return;
        case "cancel-current":
          if (!state.currentNumber) {
            setStatus("当前没有活动号码可取消。", "warn");
            return;
          }
          {
            const provider = PROVIDERS[state.currentNumber.providerKey];
            if (!provider || typeof provider.cancelCurrent !== "function") {
              setStatus("当前服务商不支持取消当前号。", "warn");
              return;
            }
            const reference = decodeRef(state.currentNumber.numberId);
            await provider.cancelCurrent(reference);
            updateCurrentNumber({
              cancelledAtIso: new Date().toISOString(),
            });
            setStatus("已请求取消当前号。", "success");
          }
          return;
        case "use-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            setStatus(`已切换到号码：${state.availableNumbers[index].phoneNumber}`, "success");
          }
          return;
        case "read-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            await readCurrentInbox({ fillCode: false });
          }
          return;
        case "poll-available":
          if (state.availableNumbers[index]) {
            setCurrentNumber(state.availableNumbers[index], "available");
            await pollForCode(true);
          }
          return;
        case "use-history":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            render();
            setStatus(`已切换到历史号码：${state.currentNumber.phoneNumber}`, "success");
          }
          return;
        case "history-fill-phone":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            await fillPhoneIntoPage(state.currentNumber.phoneNumber);
          }
          return;
        case "history-read":
          if (state.history[index]) {
            state.currentNumber = Object.assign({}, state.history[index]);
            state.lastCode = String(state.currentNumber.lastCode || "");
            await readCurrentInbox({ fillCode: false });
          }
          return;
        default:
          return;
      }
    };

    run().catch((error) => {
      setStatus(`操作失败：${error.message}`, "error");
    });
  }

  function onChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    const key = target.dataset.setting;
    if (!key) return;

    const value = target instanceof HTMLInputElement && target.type === "checkbox"
      ? (target.checked ? "true" : "false")
      : target.value;

    saveSetting(key, value);
    if (key === "providerMode") {
      setStatus(`已切换运行模式：${value === "explicit" ? "指定" : "自动"}`, "info");
    } else {
      setStatus("配置已保存。", "info");
    }
    render();
  }

  function syncDockOffsets() {
    const root = ensureRoot();
    const emailBar = document.getElementById("eep-mini-bar");
    let dockRight = 16;

    if (emailBar) {
      const rect = emailBar.getBoundingClientRect();
      if (rect.width > 0) {
        dockRight = Math.max(16, Math.ceil(window.innerWidth - rect.left + 10));
      }
    }

    root.style.setProperty("--esms-dock-right", `${dockRight}px`);
    root.style.setProperty("--esms-panel-right", `${dockRight + 42}px`);
  }

  function bindMenu() {
    if (menuBound || typeof GM_registerMenuCommand !== "function") return;
    menuBound = true;
    GM_registerMenuCommand("EasySMS：展开/收起面板", () => {
      state.panelCollapsed = !state.panelCollapsed;
      persistRuntime();
      render();
    });
    GM_registerMenuCommand("EasySMS：获取手机号", () => {
      loadAvailableNumbers({ selectFirst: true, fillPhone: false }).catch((error) => setStatus(error.message, "error"));
    });
    GM_registerMenuCommand("EasySMS：轮询并填码", () => {
      pollForCode(true).catch((error) => setStatus(error.message, "error"));
    });
    GM_registerMenuCommand("EasySMS：刷新输入框定位", () => refreshDetectedTargets());
  }

  function installStyles() {
    GM_addStyle(`
      #${ROOT_ID} { --esms-dock-right: 16px; --esms-panel-right: 58px; z-index: 2147483645; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; color: #f6f8f3; }
      #${ROOT_ID} button, #${ROOT_ID} input, #${ROOT_ID} select, #${ROOT_ID} textarea { font: inherit; }
      #${PANEL_ID} { position: fixed; top: 16px; right: var(--esms-panel-right); width: min(400px, calc(100vw - 92px)); max-height: calc(100vh - 32px); overflow: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 22px; background: radial-gradient(circle at top left, rgba(30,129,176,0.38), transparent 40%), radial-gradient(circle at bottom right, rgba(242,146,66,0.22), transparent 35%), linear-gradient(160deg, rgba(12,18,24,0.96), rgba(18,29,36,0.95)); box-shadow: 0 16px 48px rgba(0,0,0,0.38); backdrop-filter: blur(16px); overflow-x: hidden; }
      #${ROOT_ID} button, #${ROOT_ID} select, #${ROOT_ID} input { border-radius: 12px; }
      #${ROOT_ID} button { border: 1px solid rgba(255,255,255,0.12); background: linear-gradient(135deg, rgba(31,92,119,0.96), rgba(207,122,46,0.86)); color: #fffaf2; padding: 10px 12px; cursor: pointer; transition: transform 0.16s ease, opacity 0.16s ease; }
      #${ROOT_ID} button:hover { transform: translateY(-1px); }
      #${ROOT_ID} button:disabled { cursor: not-allowed; opacity: 0.5; }
      #${ROOT_ID} .esms-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 16px 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      #${ROOT_ID} .esms-title { font-size: 17px; font-weight: 700; }
      #${ROOT_ID} .esms-subtitle { margin-top: 4px; color: rgba(236,241,232,0.76); font-size: 12px; line-height: 1.45; }
      #${ROOT_ID} .esms-header-actions { display: flex; align-items: center; gap: 8px; }
      #${ROOT_ID} .esms-runtime-pill { padding: 6px 10px; border-radius: 999px; background: rgba(78,102,115,0.42); color: #e6f0ed; font-size: 12px; }
      #${ROOT_ID} .esms-runtime-pill.is-success { background: rgba(39,153,123,0.3); }
      #${ROOT_ID} .esms-runtime-pill.is-warn { background: rgba(197,132,51,0.3); }
      #${ROOT_ID} .esms-runtime-pill.is-error { background: rgba(182,66,66,0.3); }
      #${ROOT_ID} .esms-runtime-pill.is-free { background: rgba(46,110,185,0.28); }
      #${ROOT_ID} .esms-runtime-pill.is-paid { background: rgba(189,101,39,0.34); color: #fff4e8; }
      #${ROOT_ID} .esms-inline-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: rgba(255,255,255,0.1); }
      #${ROOT_ID} .esms-inline-badge.is-free { background: rgba(46,110,185,0.28); color: #e8f3ff; }
      #${ROOT_ID} .esms-inline-badge.is-paid { background: rgba(189,101,39,0.34); color: #fff4e8; }
      #${ROOT_ID} .esms-mode-card { margin: 14px 16px 0; padding: 12px 14px; border-radius: 18px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); }
      #${ROOT_ID} .esms-mode-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      #${ROOT_ID} .esms-mode-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
      #${ROOT_ID} .esms-mode-actions select { border: 1px solid rgba(255,255,255,0.1); background: rgba(3,9,14,0.36); color: #f4f7ef; padding: 10px 12px; }
      #${ROOT_ID} .esms-mode-warning { margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: rgba(74,99,118,0.22); color: rgba(236,241,232,0.86); font-size: 12px; line-height: 1.45; }
      #${ROOT_ID} .esms-mode-warning.is-paid { background: rgba(189,101,39,0.2); color: #fff2e5; border: 1px solid rgba(189,101,39,0.25); }
      #${ROOT_ID} .esms-summary-card { margin: 14px 16px 0; padding: 14px; border-radius: 18px; background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.08); }
      #${ROOT_ID} .esms-summary-top { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; }
      #${ROOT_ID} .esms-card-title { font-size: 12px; color: rgba(236,241,232,0.7); margin-bottom: 6px; }
      #${ROOT_ID} .esms-current-phone { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; word-break: break-word; }
      #${ROOT_ID} .esms-code-box { min-width: 88px; padding: 10px 12px; border-radius: 14px; background: rgba(6,18,24,0.42); border: 1px solid rgba(255,255,255,0.08); text-align: right; }
      #${ROOT_ID} .esms-code-box span { display: block; font-size: 11px; color: rgba(236,241,232,0.68); }
      #${ROOT_ID} .esms-code-box strong { display: block; margin-top: 6px; font-size: 18px; }
      #${ROOT_ID} .esms-current-meta, #${ROOT_ID} .esms-list-meta, #${ROOT_ID} .esms-message-head, #${ROOT_ID} .esms-message-foot { display: flex; flex-wrap: wrap; gap: 8px 10px; margin-top: 8px; font-size: 12px; color: rgba(236,241,232,0.74); }
      #${ROOT_ID} .esms-mini-actions, #${ROOT_ID} .esms-list-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${ROOT_ID} .esms-action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px 16px 0; }
      #${ROOT_ID} .esms-block { margin: 14px 16px 0; padding: 0; border-radius: 18px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
      #${ROOT_ID} .esms-block summary { cursor: pointer; padding: 12px 14px; font-weight: 700; background: rgba(255,255,255,0.03); }
      #${ROOT_ID} .esms-form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 14px 14px 0; }
      #${ROOT_ID} .esms-field { display: flex; flex-direction: column; gap: 6px; }
      #${ROOT_ID} .esms-field-wide { grid-column: 1 / -1; }
      #${ROOT_ID} .esms-field span { font-size: 12px; color: rgba(236,241,232,0.72); }
      #${ROOT_ID} .esms-field input, #${ROOT_ID} .esms-field select { border: 1px solid rgba(255,255,255,0.1); background: rgba(3,9,14,0.36); color: #f4f7ef; padding: 10px 12px; }
      #${ROOT_ID} .esms-toggle-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 14px; font-size: 13px; }
      #${ROOT_ID} .esms-toggle-grid label { display: flex; gap: 8px; align-items: center; }
      #${ROOT_ID} .esms-list-card, #${ROOT_ID} .esms-message-card { margin: 10px 12px; padding: 12px; border-radius: 14px; background: rgba(5,12,17,0.34); border: 1px solid rgba(255,255,255,0.07); }
      #${ROOT_ID} .esms-list-card.is-active { border-color: rgba(74,187,179,0.62); box-shadow: inset 0 0 0 1px rgba(74,187,179,0.2); }
      #${ROOT_ID} .esms-list-title { font-size: 15px; font-weight: 700; }
      #${ROOT_ID} .esms-list-actions a, #${ROOT_ID} .esms-message-foot a { color: #9ad6ec; text-decoration: none; }
      #${ROOT_ID} .esms-code-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 12px; }
      #${ROOT_ID} .esms-code-pill.is-muted { opacity: 0.7; }
      #${ROOT_ID} .esms-message-preview { margin-top: 10px; color: rgba(244,247,239,0.86); font-size: 13px; line-height: 1.5; }
      #${MINI_BAR_ID} { position: fixed; right: var(--esms-dock-right); top: 50%; transform: translateY(-50%); z-index: 2147483646; display: flex; flex-direction: column; gap: 10px; align-items: flex-end; }
      #${ROOT_ID} .esms-side-row { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      #${ROOT_ID} .esms-side-btn { width: 32px; height: 32px; padding: 0; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(180deg,#ffffff,#eef5ff) !important; color: #d76f33 !important; font-weight: 700; box-shadow: 0 8px 18px rgba(0,0,0,0.18); }
      #${ROOT_ID} .esms-mini-chip { max-width: 220px; border: none; border-radius: 999px; padding: 9px 12px; background: rgba(9,15,27,0.94) !important; color: #edf5ff !important; box-shadow: 0 14px 28px rgba(0,0,0,0.28); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #${ROOT_ID} .esms-empty { padding: 14px; color: rgba(236,241,232,0.7); font-size: 13px; }
      .esms-highlight-phone { outline: 2px solid rgba(77,191,180,0.95) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(77,191,180,0.18) !important; }
      .esms-highlight-code { outline: 2px solid rgba(236,164,91,0.96) !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(236,164,91,0.16) !important; }
      @media (max-width: 920px) {
        #${PANEL_ID} { top: 12px; left: 12px; right: 56px; width: auto; max-height: calc(100vh - 24px); }
        #${ROOT_ID} .esms-summary-top, #${ROOT_ID} .esms-form-grid, #${ROOT_ID} .esms-toggle-grid, #${ROOT_ID} .esms-action-grid, #${ROOT_ID} .esms-mode-actions { grid-template-columns: 1fr; }
        #${MINI_BAR_ID} { right: 10px; }
      }
    `);
  }

  function startDockWatcher() {
    if (dockTimer) return;
    dockTimer = window.setInterval(syncDockOffsets, 1000);
    window.addEventListener("resize", syncDockOffsets, { passive: true });
  }

  function bootstrap() {
    if (typeof GM_xmlhttpRequest !== "function") {
      console.warn("EasySMS Browser Runtime requires GM_xmlhttpRequest.");
      return;
    }

    restoreRuntime();
    installStyles();
    ensureRoot();
    bindMenu();
    startDockWatcher();
    render();
    requestAnimationFrame(syncDockOffsets);
    refreshDetectedTargets();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
