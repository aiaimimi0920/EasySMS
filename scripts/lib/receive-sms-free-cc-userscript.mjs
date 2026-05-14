const RECEIVE_SMS_FREE_CC_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
const RECEIVE_SMS_FREE_CC_VERIFICATION_KEYWORD_PATTERN =
  /\b(?:code|verify|verification|passcode|otp|pin|codigo|código|codice)\b|验证码|驗證碼|認證碼|認証|код/i;
const RECEIVE_SMS_FREE_CC_ACCESS_GATE_PATTERN =
  /virtual numbers are required to .*register.*or .*login.*before accessing the content/i;

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

function f(x, y, z) { return (x & y) | ((~x) & z); }
function g(x, y, z) { return (x & z) | (y & (~z)); }
function h(x, y, z) { return x ^ y ^ z; }
function i(x, y, z) { return y ^ (x | (~z)); }

function ff(a, b, c, d, x, s, ac) {
  a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function gg(a, b, c, d, x, s, ac) {
  a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function hh(a, b, c, d, x, s, ac) {
  a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}
function ii(a, b, c, d, x, s, ac) {
  a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
  return addUnsigned(rotateLeft(a, s), b);
}

function convertToWordArray(text) {
  const utf8 = new TextEncoder().encode(String(text ?? ""));
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

function wordToHex(value) {
  let output = "";
  for (let count = 0; count <= 3; count += 1) {
    output += (`0${((value >>> (count * 8)) & 255).toString(16)}`).slice(-2);
  }
  return output;
}

export function md5Hex(text) {
  const x = convertToWordArray(text);
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let k = 0; k < x.length; k += 16) {
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;
    a = ff(a, b, c, d, x[k + 0], 7, 0xd76aa478);
    d = ff(d, a, b, c, x[k + 1], 12, 0xe8c7b756);
    c = ff(c, d, a, b, x[k + 2], 17, 0x242070db);
    b = ff(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = ff(a, b, c, d, x[k + 4], 7, 0xf57c0faf);
    d = ff(d, a, b, c, x[k + 5], 12, 0x4787c62a);
    c = ff(c, d, a, b, x[k + 6], 17, 0xa8304613);
    b = ff(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = ff(a, b, c, d, x[k + 8], 7, 0x698098d8);
    d = ff(d, a, b, c, x[k + 9], 12, 0x8b44f7af);
    c = ff(c, d, a, b, x[k + 10], 17, 0xffff5bb1);
    b = ff(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = ff(a, b, c, d, x[k + 12], 7, 0x6b901122);
    d = ff(d, a, b, c, x[k + 13], 12, 0xfd987193);
    c = ff(c, d, a, b, x[k + 14], 17, 0xa679438e);
    b = ff(b, c, d, a, x[k + 15], 22, 0x49b40821);

    a = gg(a, b, c, d, x[k + 1], 5, 0xf61e2562);
    d = gg(d, a, b, c, x[k + 6], 9, 0xc040b340);
    c = gg(c, d, a, b, x[k + 11], 14, 0x265e5a51);
    b = gg(b, c, d, a, x[k + 0], 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, x[k + 5], 5, 0xd62f105d);
    d = gg(d, a, b, c, x[k + 10], 9, 0x02441453);
    c = gg(c, d, a, b, x[k + 15], 14, 0xd8a1e681);
    b = gg(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, x[k + 9], 5, 0x21e1cde6);
    d = gg(d, a, b, c, x[k + 14], 9, 0xc33707d6);
    c = gg(c, d, a, b, x[k + 3], 14, 0xf4d50d87);
    b = gg(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = gg(a, b, c, d, x[k + 13], 5, 0xa9e3e905);
    d = gg(d, a, b, c, x[k + 2], 9, 0xfcefa3f8);
    c = gg(c, d, a, b, x[k + 7], 14, 0x676f02d9);
    b = gg(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);

    a = hh(a, b, c, d, x[k + 5], 4, 0xfffa3942);
    d = hh(d, a, b, c, x[k + 8], 11, 0x8771f681);
    c = hh(c, d, a, b, x[k + 11], 16, 0x6d9d6122);
    b = hh(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = hh(a, b, c, d, x[k + 1], 4, 0xa4beea44);
    d = hh(d, a, b, c, x[k + 4], 11, 0x4bdecfa9);
    c = hh(c, d, a, b, x[k + 7], 16, 0xf6bb4b60);
    b = hh(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = hh(a, b, c, d, x[k + 13], 4, 0x289b7ec6);
    d = hh(d, a, b, c, x[k + 0], 11, 0xeaa127fa);
    c = hh(c, d, a, b, x[k + 3], 16, 0xd4ef3085);
    b = hh(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = hh(a, b, c, d, x[k + 9], 4, 0xd9d4d039);
    d = hh(d, a, b, c, x[k + 12], 11, 0xe6db99e5);
    c = hh(c, d, a, b, x[k + 15], 16, 0x1fa27cf8);
    b = hh(b, c, d, a, x[k + 2], 23, 0xc4ac5665);

    a = ii(a, b, c, d, x[k + 0], 6, 0xf4292244);
    d = ii(d, a, b, c, x[k + 7], 10, 0x432aff97);
    c = ii(c, d, a, b, x[k + 14], 15, 0xab9423a7);
    b = ii(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = ii(a, b, c, d, x[k + 12], 6, 0x655b59c3);
    d = ii(d, a, b, c, x[k + 3], 10, 0x8f0ccc92);
    c = ii(c, d, a, b, x[k + 10], 15, 0xffeff47d);
    b = ii(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = ii(a, b, c, d, x[k + 8], 6, 0x6fa87e4f);
    d = ii(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, x[k + 6], 15, 0xa3014314);
    b = ii(b, c, d, a, x[k + 13], 21, 0x4e0811a1);
    a = ii(a, b, c, d, x[k + 4], 6, 0xf7537e82);
    d = ii(d, a, b, c, x[k + 11], 10, 0xbd3af235);
    c = ii(c, d, a, b, x[k + 2], 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, x[k + 9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`;
}

export function buildReceiveSmsFreeCcLoginPayload(email, password) {
  return {
    mail: String(email ?? "").trim(),
    password: md5Hex(String(password ?? "")),
  };
}

export function isReceiveSmsFreeCcAccessGateHtml(html) {
  return RECEIVE_SMS_FREE_CC_ACCESS_GATE_PATTERN.test(String(html ?? ""));
}

export function isReceiveSmsFreeCcVerificationLikeMessage(message) {
  const text = String(message?.content || "").trim();
  if (!text) return false;
  const squashedDigits = text.replace(/[\s\u200b-\u200d\u2060-]/g, "");
  if (/^\D*\d{4,8}\D*$/.test(squashedDigits)) return true;
  return RECEIVE_SMS_FREE_CC_VERIFICATION_KEYWORD_PATTERN.test(text);
}

export function parseReceiveSmsFreeCcRelativeAgeMs(value) {
  if (!value) return undefined;
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

export function hasRecentReceiveSmsFreeCcVerificationActivity(
  messages,
  freshnessWindowMs = RECEIVE_SMS_FREE_CC_VERIFICATION_WINDOW_MS,
) {
  const latestVerificationMessage = (messages || []).find((message) =>
    isReceiveSmsFreeCcVerificationLikeMessage(message)
  );
  if (!latestVerificationMessage) return false;
  const ageMs = parseReceiveSmsFreeCcRelativeAgeMs(latestVerificationMessage.receivedAtText);
  return ageMs !== undefined && ageMs <= freshnessWindowMs;
}
