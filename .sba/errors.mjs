// Safe SBA error codes & structured diagnostics (never expose raw exception text or secrets).

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
const PROVIDER_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export class SbaActionError extends Error {
  constructor(errorCode, options = {}) {
    const safeCode = typeof errorCode === "string" && ERROR_CODE_PATTERN.test(errorCode)
      ? errorCode
      : "EASYSMS_SBA_INTERNAL_FAILURE";
    super(safeCode);
    this.name = "SbaActionError";
    this.errorCode = safeCode;
    this.failedStep = typeof options.failedStep === "string" && STEP_ID_PATTERN.test(options.failedStep)
      ? options.failedStep
      : undefined;
    this.providerStatus = Number.isSafeInteger(options.providerStatus)
      && options.providerStatus >= 100
      && options.providerStatus <= 599
      ? options.providerStatus
      : undefined;
    this.providerCode = (Number.isSafeInteger(options.providerCode) && options.providerCode >= 0 && options.providerCode <= 999_999_999)
      || (typeof options.providerCode === "string" && PROVIDER_CODE_PATTERN.test(options.providerCode))
      ? options.providerCode
      : undefined;
    this.uncertain = Boolean(options.uncertain);
  }

  toDiagnostics(durationMs) {
    const out = {};
    if (this.failedStep) {
      out.failedStep = this.failedStep;
    }
    if (this.providerStatus !== undefined) {
      out.providerStatus = this.providerStatus;
    }
    if (this.providerCode !== undefined) {
      out.providerCode = this.providerCode;
    }
    if (Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 3_600_000) {
      out.durationMs = durationMs;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}

export function requireCondition(condition, errorCode, options = {}) {
  if (!condition) {
    throw new SbaActionError(errorCode, options);
  }
}
