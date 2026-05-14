const PAID_PROVIDER_KEYS = new Set(["hero_sms"]);

export function isPaidProviderKey(providerKey) {
  return PAID_PROVIDER_KEYS.has(String(providerKey || "").trim());
}

export function buildUserscriptModeUiModel(settings, currentNumber) {
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
