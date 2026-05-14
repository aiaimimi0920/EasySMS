const SMS_TO_ME_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
const SMS_TO_ME_VERIFICATION_KEYWORD_PATTERN =
  /\b(?:code|verification|verify|otp|pin|passcode|codigo|c[oó]digo|codice|login code)\b|验证码|驗證碼|認證碼|認証|код/i;
const SMS_TO_ME_ACCESS_GATE_PATTERN =
  /please log in to view messages for this number|require a free account to access/i;

export function extractSmsToMeLoginChallenge(html) {
  const csrfToken = String(html ?? "").match(/name="_token"\s+value="([^"]+)"/i)?.[1]?.trim();
  const csrfV = String(html ?? "").match(/name="csrf_v"\s+value="([^"]+)"/i)?.[1]?.trim();
  const captchaPrompt = String(html ?? "").match(/What is\s+\d+\s*[+\-]\s*\d+\?/i)?.[0]?.trim();

  if (!csrfToken || !csrfV || !captchaPrompt) {
    throw new Error("smstome login challenge is missing expected form fields.");
  }

  const numbers = Array.from(captchaPrompt.matchAll(/\d+/g), (match) => Number.parseInt(match[0], 10));
  if (numbers.length < 2 || numbers.some((value) => !Number.isFinite(value))) {
    throw new Error(`Unable to parse smstome captcha challenge: ${captchaPrompt}`);
  }

  const captchaAnswer = captchaPrompt.includes("-")
    ? String(numbers[0] - numbers[1])
    : String(numbers[0] + numbers[1]);

  return {
    csrfToken,
    csrfV,
    captchaPrompt,
    captchaAnswer,
  };
}

export function isSmsToMeAccessGateHtml(html) {
  return SMS_TO_ME_ACCESS_GATE_PATTERN.test(String(html ?? ""));
}

export function isSmsToMeVerificationLikeMessage(message) {
  const text = String(message?.content || "").trim();
  if (!text) {
    return false;
  }
  const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
  if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) {
    return true;
  }
  return SMS_TO_ME_VERIFICATION_KEYWORD_PATTERN.test(text);
}

export function parseSmsToMeRelativeAgeMs(value) {
  if (!value) {
    return undefined;
  }

  const text = String(value).trim().toLowerCase();
  if (text.includes("just now")) {
    return 0;
  }

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

export function hasRecentSmsToMeVerificationActivity(
  messages,
  freshnessWindowMs = SMS_TO_ME_VERIFICATION_WINDOW_MS,
) {
  const latestVerificationMessage = (messages || []).find((message) =>
    isSmsToMeVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) {
    return false;
  }

  const ageMs = parseSmsToMeRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined && ageMs <= freshnessWindowMs;
}
