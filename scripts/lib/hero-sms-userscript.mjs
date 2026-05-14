export function isHeroSmsCancelableNow(currentNumber, now = Date.now()) {
  const refundableAt = Date.parse(String(currentNumber?.refundableCancelAvailableAtIso || ""));
  if (!Number.isFinite(refundableAt)) {
    return false;
  }
  return refundableAt <= now && !currentNumber?.cancelledAtIso;
}

export function buildHeroSmsLeaseSummary(currentNumber, now = Date.now()) {
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
    rows.push(refundableAt <= now ? "已到可退款取消窗口" : `退款取消时间 ${new Date(refundableAt).toISOString()}`);
  }

  const leaseExpiresAt = Date.parse(String(currentNumber.leaseExpiresAtIso || ""));
  if (Number.isFinite(leaseExpiresAt)) {
    rows.push(`租约到期 ${new Date(leaseExpiresAt).toISOString()}`);
  }

  if (currentNumber.cancelledAtIso) {
    rows.push(`已取消 ${String(currentNumber.cancelledAtIso)}`);
  }

  return rows;
}
