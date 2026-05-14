const ONLINE_SIM_VERIFICATION_WINDOW_MS = 20 * 60 * 1000;
const ONLINE_SIM_VERIFICATION_KEYWORD_PATTERN =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;

export function buildOnlineSimApiUrl(url, apiKey) {
  const normalizedApiKey = String(apiKey ?? "").trim();
  if (!normalizedApiKey) {
    return url;
  }

  const target = new URL(url);
  if (!target.searchParams.has("apikey")) {
    target.searchParams.set("apikey", normalizedApiKey);
  }
  return target.toString();
}

export function isOnlineSimVerificationLikeMessage(message) {
  const rawText = "text" in message ? message.text : message.content;
  const text = String(rawText ?? "").trim();
  if (!text) {
    return false;
  }

  const condensed = text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
  if (/^\d{4,8}$/.test(condensed)) {
    return true;
  }

  if (!/\d{4,8}/.test(condensed)) {
    return false;
  }

  return ONLINE_SIM_VERIFICATION_KEYWORD_PATTERN.test(text);
}

export function parseOnlineSimNaiveTimestamp(value) {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "0", 10);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function parseOnlineSimRelativeAgeMs(value) {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim().toLowerCase();
  const amountMatch = /(\d+)/.exec(text);
  const amount = amountMatch ? Number.parseInt(amountMatch[1] ?? "", 10) : 1;

  if (text.includes("минут")) return amount * 60 * 1000;
  if (text.includes("час")) return amount * 60 * 60 * 1000;
  if (text.includes("дн")) return amount * 24 * 60 * 60 * 1000;
  if (text.includes("недел")) return amount * 7 * 24 * 60 * 60 * 1000;
  if (text.includes("меся")) return amount * 30 * 24 * 60 * 60 * 1000;
  if (text.includes("год") || text.includes("лет")) return amount * 365 * 24 * 60 * 60 * 1000;
  return undefined;
}

export function findLatestOnlineSimVerificationMessage(messages) {
  return (messages || []).find((message) => isOnlineSimVerificationLikeMessage(message));
}

export function hasRecentOnlineSimVerificationActivity(
  response,
  freshnessWindowMs = ONLINE_SIM_VERIFICATION_WINDOW_MS,
) {
  const latestVerificationMessage = findLatestOnlineSimVerificationMessage(response?.messages?.data ?? []);
  if (!latestVerificationMessage) {
    return false;
  }

  const relativeAgeMs = parseOnlineSimRelativeAgeMs(latestVerificationMessage.data_humans);
  if (relativeAgeMs !== undefined) {
    return relativeAgeMs <= freshnessWindowMs;
  }

  const referenceTimestamp =
    parseOnlineSimNaiveTimestamp(response?.number?.updated_at) ??
    parseOnlineSimNaiveTimestamp((response?.messages?.data ?? [])[0]?.created_at);
  const verificationTimestamp = parseOnlineSimNaiveTimestamp(latestVerificationMessage.created_at);

  if (referenceTimestamp !== undefined && verificationTimestamp !== undefined) {
    return referenceTimestamp - verificationTimestamp <= freshnessWindowMs;
  }

  return false;
}
