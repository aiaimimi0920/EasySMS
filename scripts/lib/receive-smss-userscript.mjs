const RECEIVE_SMSS_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
const RECEIVE_SMSS_VERIFICATION_KEYWORD_PATTERN =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;
const RECEIVE_SMSS_ACCESS_GATE_PATTERN =
  /attention required! \| cloudflare|just a moment|enable javascript and cookies to continue|正在进行安全验证/i;

export function buildReceiveSmssLoginPayload(username, password) {
  return {
    log: String(username).trim(),
    pwd: String(password),
    redirect_to: "/",
    instance: "",
    action: "login",
  };
}

export function detectReceiveSmssAccessGateHtml(html) {
  return RECEIVE_SMSS_ACCESS_GATE_PATTERN.test(String(html ?? ""));
}

export function isReceiveSmssVerificationLikeMessage(message) {
  const text = String(message?.content ?? "").trim();
  if (!text) {
    return false;
  }

  const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
  if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) {
    return true;
  }

  return RECEIVE_SMSS_VERIFICATION_KEYWORD_PATTERN.test(text);
}

export function parseReceiveSmssRelativeAgeMs(value) {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim().toLowerCase();
  const amountMatch = text.match(/(\d+)/);
  const amount = amountMatch ? Number.parseInt(amountMatch[1] ?? "", 10) : 1;

  if (text.includes("sec")) return amount * 1000;
  if (text.includes("min")) return amount * 60 * 1000;
  if (text.includes("hour")) return amount * 60 * 60 * 1000;
  if (text.includes("day")) return amount * 24 * 60 * 60 * 1000;
  if (text.includes("month")) return amount * 30 * 24 * 60 * 60 * 1000;
  if (text.includes("year")) return amount * 365 * 24 * 60 * 60 * 1000;
  return undefined;
}

export function hasRecentReceiveSmssVerificationActivity(
  messages,
  freshnessWindowMs = RECEIVE_SMSS_VERIFICATION_WINDOW_MS,
) {
  const latestVerificationMessage = (messages || []).find((message) =>
    isReceiveSmssVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseReceiveSmssRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined && ageMs <= freshnessWindowMs;
}
