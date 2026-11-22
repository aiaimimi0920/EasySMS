export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CookieFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: FetchLike;
}

function splitSetCookieHeader(rawHeader: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inExpires = false;

  for (let index = 0; index < rawHeader.length; index += 1) {
    const slice = rawHeader.slice(index);
    if (/^expires=/i.test(slice)) {
      inExpires = true;
    } else if (inExpires && rawHeader[index] === ";") {
      inExpires = false;
    }

    if (rawHeader[index] === "," && !inExpires) {
      const nextToken = rawHeader.slice(index + 1).trimStart();
      if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+=/.test(nextToken)) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += rawHeader[index];
  }

  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function readSetCookieHeaders(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") {
    const values = maybeGetSetCookie.call(headers);
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  }

  const combined = headers.get("set-cookie");
  return combined ? splitSetCookieHeader(combined) : [];
}

export class WebCookieJar {
  private readonly cookies = new Map<string, string>();

  absorbResponse(response: Response): void {
    for (const entry of readSetCookieHeaders(response.headers)) {
      const firstPair = entry.split(";", 1)[0]?.trim();
      if (!firstPair) {
        continue;
      }
      const separatorIndex = firstPair.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const name = firstPair.slice(0, separatorIndex).trim();
      const value = firstPair.slice(separatorIndex + 1).trim();
      if (!name) {
        continue;
      }
      if (!value || /^deleted$/i.test(value)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  hasCookiePrefix(prefix: string): boolean {
    for (const name of this.cookies.keys()) {
      if (name.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  toHeaderValue(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

export class WebHttpSession {
  readonly cookies = new WebCookieJar();
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl
      ? (input, init) => fetchImpl(input, init)
      : (input, init) => globalThis.fetch(input, init);
  }

  async request(url: string, options: CookieFetchOptions = {}): Promise<Response> {
    const maxRedirects = options.maxRedirects ?? 5;
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
    let currentUrl = url;
    let currentMethod = (options.method ?? "GET").toUpperCase();
    let currentBody = options.body;
    const baseHeaders = { ...(options.headers ?? {}) };

    for (let redirectIndex = 0; redirectIndex <= maxRedirects; redirectIndex += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      const requestHeaders: Record<string, string> = { ...baseHeaders };
      if (currentMethod === "GET" || currentMethod === "HEAD") {
        delete requestHeaders["Content-Type"];
        delete requestHeaders["content-type"];
      }

      const cookieHeader = this.cookies.toHeaderValue();
      if (cookieHeader) {
        requestHeaders.Cookie = cookieHeader;
      }

      let response: Response;
      try {
        const invokeFetch: FetchLike = options.fetchImpl
          ? (input, init) => options.fetchImpl!(input, init)
          : this.fetchImpl;
        response = await invokeFetch(currentUrl, {
          method: currentMethod,
          headers: requestHeaders,
          body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`HTTP request timed out after ${timeoutMs}ms for ${currentUrl}`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
      }

      this.cookies.absorbResponse(response);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return response;
        }
        if (redirectIndex === maxRedirects) {
          throw new Error(`Exceeded maximum redirects (${maxRedirects}) for ${url}`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          currentMethod = "GET";
          currentBody = undefined;
        }
        continue;
      }

      return response;
    }

    throw new Error(`Failed to resolve HTTP response for ${url}`);
  }

  async getText(url: string, options: Omit<CookieFetchOptions, "method" | "body"> = {}): Promise<string> {
    const response = await this.request(url, { ...options, method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText || "Upstream failure"}`);
    }
    const text = await response.text();
    if (!text.trim()) {
      throw new Error(`Upstream returned an empty response for ${url}.`);
    }
    return text;
  }
}
