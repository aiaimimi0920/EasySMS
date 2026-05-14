import { buildOpenApiDocument } from "../openapi.js";
import {
  parseActivationActionRequest,
  parseActivationCreateRequest,
  parseActivationCreateInputFromUrl,
  parseActivationProviderSelectorFromUrl,
  parseGetInboxOptions,
  parseHandlerApiAction,
  parseHeroSmsActivationId,
  parseHeroSmsCountryQuery,
  parseHeroSmsRankedQuery,
  parseHeroSmsServiceQuery,
  parseListPublicNumbersOptions,
  parseProviderCatalogQuery,
  parseProviderHealthQuery,
  parseTemporaryDisableInput,
} from "../contracts.js";
import type { EasySmsHttpHandler } from "../handler.js";
import type { ServerResponse } from "node:http";

function shouldUsePaidFacade(selector: { providerKey?: string; costTier?: "free" | "paid" }): boolean {
  return selector.providerKey === "hero_sms" || selector.costTier === "paid";
}

function writeText(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  response.end(body);
}

export interface EasySmsLegacyRouteContext {
  method: string;
  path: string;
  url: URL;
  handler: EasySmsHttpHandler;
  response: ServerResponse;
  readJsonBody<T>(): Promise<T>;
}

export async function handleLegacyRoute(context: EasySmsLegacyRouteContext): Promise<unknown | undefined> {
  const { method, path, url, handler, response, readJsonBody } = context;

  if (
    method === "GET"
    && path === "/stubs/handler_api.php"
  ) {
    const action = parseHandlerApiAction(url);
    const serviceKey = parseHeroSmsServiceQuery(url) ?? "dr";
    const selector = parseActivationProviderSelectorFromUrl(url);
    const freeFacadeProviderKeys = new Set(
      handler.queryProviders({ costTier: "free", capability: "create-activation" }).providers.map((provider) => provider.key),
    );

    if (!selector.providerKey && selector.costTier !== "paid") {
      const operatorAsProviderKey = url.searchParams.get("operator")?.trim();
      if (operatorAsProviderKey && freeFacadeProviderKeys.has(operatorAsProviderKey as never)) {
        selector.providerKey = operatorAsProviderKey;
      }
    }

    if (action === "getCountries") {
      const items = await handler.listFacadeCountries(selector);
      return Object.fromEntries(
        items.map((item) => [
          String(item.countryId),
          {
            id: item.countryId,
            eng: item.apiName,
            chn: item.apiName,
            visible: item.visible === false ? 0 : 1,
            retry: item.retry === false ? 0 : 1,
          },
        ]),
      );
    }

    if (action === "getPrices") {
      return handler.getFacadePrices(serviceKey, selector);
    }

    if (action === "getTopCountriesByService" || action === "getTopCountriesByServiceRank") {
      const items = await handler.listFacadeTopCountries(
        serviceKey,
        action === "getTopCountriesByServiceRank",
        selector,
      );
      return Object.fromEntries(
        items.map((item) => [
          String(item.countryId),
          {
            country: item.countryId,
            price: item.price,
            count: item.count ?? 0,
            name: item.apiName,
            isoCode: item.isoCode,
            dialCode: item.dialCode,
          },
        ]),
      );
    }

    if (action === "getOperators") {
      const country = parseHeroSmsCountryQuery(url);
      const items = await handler.listFacadeOperatorQuotes(country, serviceKey, selector);
      return {
        status: "success",
        countryOperators: {
          [String(country)]: items.map((item) => item.operator),
        },
      };
    }

    if (action === "getNumberV2") {
      const createInput = parseActivationCreateInputFromUrl(url);
      if (!createInput.service) {
        createInput.service = serviceKey;
      }
      if (
        !shouldUsePaidFacade(selector)
        && createInput.country !== undefined
        && !createInput.countryCode
        && !createInput.countryName
      ) {
        const resolvedCountry = await handler.resolveFacadeCountry(createInput.country, selector);
        createInput.countryCode = resolvedCountry.countryCode;
        createInput.countryName = resolvedCountry.countryName;
      }
      return handler.createActivation(createInput, selector);
    }

    if (action === "getStatusV2") {
      const activationId = parseHeroSmsActivationId(url.searchParams.get("id") ?? undefined);
      return handler.getActivationStatus(activationId, selector);
    }

    if (action === "getStatus") {
      const activationId = parseHeroSmsActivationId(url.searchParams.get("id") ?? undefined);
      const status = await handler.getActivationStatus(activationId, selector);
      const body = status.cancelled
        ? "STATUS_CANCEL"
        : status.code
          ? `STATUS_OK:${status.code}`
          : "STATUS_WAIT_CODE";
      writeText(response, 200, body);
      return null;
    }

    if (action === "setStatus") {
      const activationId = parseHeroSmsActivationId(url.searchParams.get("id") ?? undefined);
      const statusCode = Number.parseInt(url.searchParams.get("status") ?? "", 10);
      const mappedAction = statusCode === 8
        ? "cancel"
        : statusCode === 6
          ? "complete"
          : "request-code";
      const result = await handler.setActivationStatus(activationId, mappedAction, selector);
      writeText(response, 200, result.resultText);
      return null;
    }
  }

  if (method === "GET" && path === "/healthz") {
    return handler.getHealthz();
  }

  if (method === "GET" && path === "/openapi.json") {
    return buildOpenApiDocument();
  }

  if (method === "GET" && path === "/providers") {
    return handler.getLegacyProviderCatalog(parseProviderCatalogQuery(url));
  }

  if (method === "GET" && path === "/providers/health") {
    const { providerKey } = parseProviderHealthQuery(url);
    return handler.getLegacyProviderHealth(providerKey);
  }

  if (method === "GET" && path === "/providers/probe-history") {
    const { providerKey } = parseProviderHealthQuery(url);
    return handler.getLegacyProbeHistory(providerKey);
  }

  if (method === "GET" && path === "/providers/selection-plan") {
    return handler.getLegacySelectionPlan(parseListPublicNumbersOptions(url));
  }

  if (method === "POST" && path === "/providers/probe") {
    const providerKey = url.searchParams.get("providerKey") ?? undefined;
    return handler.legacyProbe(providerKey);
  }

  if (method === "GET" && path === "/sms/public-numbers") {
    return handler.listPublicNumbers(parseListPublicNumbersOptions(url));
  }

  if (method === "GET" && path === "/sms/inbox") {
    return handler.getInbox(parseGetInboxOptions(url));
  }

  if (method === "GET" && path === "/providers/hero_sms/countries") {
    return {
      provider: "hero_sms",
      items: await handler.listHeroSmsCountries(),
    };
  }

  if (method === "GET" && path === "/providers/hero_sms/top-countries") {
    const heroService = parseHeroSmsServiceQuery(url) ?? "dr";
    const ranked = parseHeroSmsRankedQuery(url);
    return {
      provider: "hero_sms",
      service: heroService,
      ranked,
      items: await handler.listHeroSmsTopCountries(heroService, ranked),
    };
  }

  if (method === "GET" && path === "/providers/hero_sms/operators") {
    const country = parseHeroSmsCountryQuery(url);
    const heroService = parseHeroSmsServiceQuery(url) ?? "dr";
    return {
      provider: "hero_sms",
      service: heroService,
      country,
      items: await handler.listHeroSmsOperatorQuotes(country, heroService),
    };
  }

  if (method === "GET" && path === "/providers/hero_sms/stats") {
    return {
      provider: "hero_sms",
      ...handler.getHeroSmsStats(),
    };
  }

  if (method === "POST" && path === "/sms/activations") {
    const payload = parseActivationCreateRequest(await readJsonBody());
    return {
      activation: await handler.createActivation(payload.input, {
        providerKey: payload.providerKey,
        costTier: payload.costTier,
      }),
    };
  }

  const activationStatusMatch = path.match(/^\/sms\/activations\/(\d+)\/status$/);
  if (method === "GET" && activationStatusMatch) {
    const activationId = parseHeroSmsActivationId(activationStatusMatch[1]);
    const selector = parseActivationProviderSelectorFromUrl(url);
    return {
      activation: await handler.getActivationStatus(activationId, selector),
    };
  }

  const activationActionMatch = path.match(/^\/sms\/activations\/(\d+)\/actions$/);
  if (method === "POST" && activationActionMatch) {
    const activationId = parseHeroSmsActivationId(activationActionMatch[1]);
    const payload = parseActivationActionRequest(await readJsonBody());
    return {
      activation: await handler.setActivationStatus(activationId, payload.action, {
        providerKey: payload.providerKey,
        costTier: payload.costTier,
      }),
    };
  }

  const providerAdminMatch = path.match(/^\/admin\/providers\/([^/]+)\/(disable|enable|reset|probe)$/);
  if (providerAdminMatch) {
    const providerKey = decodeURIComponent(providerAdminMatch[1] ?? "");
    const action = providerAdminMatch[2];

    if (method === "POST" && action === "disable") {
      return handler.disableProviderTemporarily(providerKey, parseTemporaryDisableInput(await readJsonBody()));
    }

    if (method === "POST" && action === "enable") {
      return handler.enableProvider(providerKey);
    }

    if (method === "POST" && action === "reset") {
      return handler.resetOperationalState(providerKey);
    }

    if (method === "POST" && action === "probe") {
      const probe = await handler.probeProvider(providerKey);
      return {
        result: probe.probe,
      };
    }
  }

  return undefined;
}
