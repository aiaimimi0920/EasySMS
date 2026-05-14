const SUPPORTED_LEETCODE_COUNTRY_OPTIONS = new Map([
  ["+33", "(+33) 法国"],
  ["+34", "(+34) 西班牙"],
  ["+41", "(+41) 瑞士"],
  ["+44", "(+44) 英国"],
  ["+49", "(+49) 德国"],
  ["+60", "(+60) 马来西亚"],
  ["+61", "(+61) 澳大利亚"],
  ["+62", "(+62) 印度尼西亚"],
  ["+64", "(+64) 新西兰"],
  ["+65", "(+65) 新加坡"],
  ["+66", "(+66) 泰国"],
  ["+81", "(+81) 日本"],
  ["+82", "(+82) 韩国"],
  ["+86", "(+86) 中国"],
  ["+91", "(+91) 印度"],
  ["+352", "(+352) 卢森堡"],
  ["+853", "(+853) 中国澳门"],
  ["+852", "(+852) 中国香港"],
  ["+886", "(+886) 中国台湾"],
]);

export function normalizeDigits(input) {
  return String(input ?? "").replace(/\D/g, "");
}

export function deriveLocalNumber(number) {
  const phoneDigits = normalizeDigits(number.phoneNumber);
  const countryDigits = normalizeDigits(number.countryCode);
  if (!phoneDigits || !countryDigits || !phoneDigits.startsWith(countryDigits)) {
    throw new Error(`Cannot derive local number from ${number.phoneNumber} / ${number.countryCode}`);
  }
  return phoneDigits.slice(countryDigits.length);
}

export function chooseLeetCodeCountryOption(number) {
  if (number.countryCode === "+1") {
    if (/canada/i.test(String(number.countryName ?? ""))) {
      return "(+1) 加拿大";
    }
    return "(+1) 美国";
  }

  const option = SUPPORTED_LEETCODE_COUNTRY_OPTIONS.get(number.countryCode);
  if (!option) {
    throw new Error(
      `Unsupported LeetCode signup country for ${number.countryCode} (${number.countryName ?? "unknown"})`,
    );
  }
  return option;
}

export function getLeetCodeCountryOptionPrefix(countryCode) {
  const normalized = String(countryCode ?? "").trim();
  if (!normalized.startsWith("+")) {
    throw new Error(`Invalid country code for LeetCode prefix mapping: ${countryCode}`);
  }
  return `(${normalized})`;
}

export function supportsLeetCodeSignup(number) {
  try {
    chooseLeetCodeCountryOption(number);
    return true;
  } catch {
    return false;
  }
}

export function filterNumbersByCountryCode(numbers, targetCountryCode) {
  if (!targetCountryCode) {
    return numbers;
  }

  return numbers.filter((number) => number.countryCode === targetCountryCode);
}

export function errorMessageFromUnknown(error) {
  return error instanceof Error ? error.message : String(error);
}

export function chooseClickableTextCandidate(candidates) {
  const ranked = [...candidates].sort((left, right) => {
    const leftPointerLike = left.cursor === "pointer" || left.tagName === "BUTTON" || left.role === "button";
    const rightPointerLike = right.cursor === "pointer" || right.tagName === "BUTTON" || right.role === "button";
    if (leftPointerLike !== rightPointerLike) {
      return rightPointerLike ? 1 : -1;
    }
    return (right.depth ?? 0) - (left.depth ?? 0);
  });
  return ranked[0] ?? null;
}

export function resolveBrowserConnectionMode(modeArg) {
  const normalized = String(modeArg ?? "").trim();
  if (!normalized) {
    return {
      connection: "launch",
      headless: false,
      remoteDebuggingPort: null,
    };
  }

  if (normalized === "headless") {
    return {
      connection: "launch",
      headless: true,
      remoteDebuggingPort: null,
    };
  }

  const attachMatch = /^attach:(\d+)$/.exec(normalized);
  if (attachMatch) {
    return {
      connection: "attach",
      headless: false,
      remoteDebuggingPort: Number.parseInt(attachMatch[1] ?? "", 10),
    };
  }

  if (/^\d+$/.test(normalized)) {
    return {
      connection: "attach",
      headless: false,
      remoteDebuggingPort: Number.parseInt(normalized, 10),
    };
  }

  throw new Error(`Unsupported browser connection mode: ${normalized}`);
}

export function extractNewMessages(messages, baselineIds) {
  const baselineNumericIds = Array.from(baselineIds)
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value));
  const baselineNumericCeiling =
    baselineNumericIds.length > 0 ? Math.max(...baselineNumericIds) : null;

  return messages.filter((message) => {
    if (baselineIds.has(message.id)) {
      return false;
    }

    const candidateNumericId = Number.parseInt(String(message.id), 10);
    if (baselineNumericCeiling !== null && Number.isFinite(candidateNumericId)) {
      return candidateNumericId > baselineNumericCeiling;
    }

    return true;
  });
}
