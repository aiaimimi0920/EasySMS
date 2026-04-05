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
