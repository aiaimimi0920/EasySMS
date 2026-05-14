export class EasySmsError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "EasySmsError";
    this.statusCode = statusCode;
  }
}

export class ProviderNotFoundError extends EasySmsError {
  constructor(providerKey: string) {
    super(`Provider not found or disabled: ${providerKey}`, 404);
    this.name = "ProviderNotFoundError";
  }
}

export class ValidationError extends EasySmsError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

export class ProviderFetchError extends EasySmsError {
  constructor(providerKey: string, message: string) {
    super(`Failed to fetch provider "${providerKey}": ${message}`, 502);
    this.name = "ProviderFetchError";
  }
}

export class ProviderRouteUnavailableError extends EasySmsError {
  constructor(providerKey: string, message: string) {
    super(`Provider "${providerKey}" is currently unavailable: ${message}`, 503);
    this.name = "ProviderRouteUnavailableError";
  }
}

export class ActivationProviderError extends EasySmsError {
  constructor(providerKey: string, message: string, statusCode = 502) {
    super(`Activation provider "${providerKey}" failed: ${message}`, statusCode);
    this.name = "ActivationProviderError";
  }
}

export class ActivationSessionNotFoundError extends EasySmsError {
  constructor(activationId: number) {
    super(`Activation session not found: ${activationId}`, 404);
    this.name = "ActivationSessionNotFoundError";
  }
}

export class SmsSessionNotFoundError extends EasySmsError {
  constructor(sessionId: string) {
    super(`SMS session not found: ${sessionId}`, 404);
    this.name = "SmsSessionNotFoundError";
  }
}

export class SmsObservedMessageNotFoundError extends EasySmsError {
  constructor(messageId: string) {
    super(`SMS observed message not found: ${messageId}`, 404);
    this.name = "SmsObservedMessageNotFoundError";
  }
}
