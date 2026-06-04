export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "EasySms API",
      version: "0.2.0",
      description: [
        "Unified SMS provider API for EasySms.",
        "Sessions are the canonical external integration boundary while providers remain the internal runtime boundary.",
        "Free vs paid is expressed as provider metadata via costTier.",
        "The HeroSMS-compatible handler_api facade is exposed as a compatibility layer above the same service contract.",
        "Bearer authentication is required only when server.apiKey is configured at runtime.",
        "healthz and openapi.json remain readable without authentication.",
      ].join(" "),
    },
    servers: [
      {
        url: "/",
        description: "Current EasySms runtime",
      },
    ],
    tags: [
      { name: "Health", description: "Service and provider operational visibility." },
      { name: "Sessions", description: "Session-first one-stop SMS workflow API." },
      { name: "Providers", description: "Unified provider catalog and provider metadata." },
      { name: "Public SMS", description: "Low-level public number listing and inbox reads." },
      { name: "Activations", description: "Low-level activation lifecycle across free and paid providers." },
      { name: "Compatibility", description: "HeroSMS or SMS-Activate style compatibility facade." },
      { name: "Admin", description: "Operator-only runtime control endpoints." },
    ],
    paths: {
      "/openapi.json": {
        get: {
          tags: ["Health"],
          summary: "Fetch the OpenAPI contract for the running EasySms service.",
          responses: {
            "200": {
              description: "OpenAPI document.",
            },
          },
        },
      },
      "/healthz": {
        get: {
          tags: ["Health"],
          summary: "Get basic service health and provider-count information.",
          responses: {
            "200": {
              description: "Service health summary.",
            },
          },
        },
      },
      "/sms/catalog": {
        get: {
          tags: ["Sessions"],
          summary: "Get the canonical EasySms catalog for session-centric clients.",
          responses: {
            "200": {
              description: "SMS catalog response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      catalog: { $ref: "#/components/schemas/SmsCatalog" },
                    },
                    required: ["catalog"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/snapshot": {
        get: {
          tags: ["Sessions"],
          summary: "Get the current EasySms runtime snapshot in summary or detail mode.",
          parameters: [
            {
              name: "mode",
              in: "query",
              schema: { type: "string", enum: ["summary", "detail"] },
            },
          ],
          responses: {
            "200": {
              description: "EasySms runtime snapshot.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      snapshot: { $ref: "#/components/schemas/EasySmsSnapshot" },
                    },
                    required: ["snapshot"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/plan": {
        post: {
          tags: ["Sessions"],
          summary: "Plan an SMS session without actually opening it.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActivationCreateRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Planned SMS session route.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      plan: { $ref: "#/components/schemas/SmsSessionPlan" },
                    },
                    required: ["plan"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/open": {
        post: {
          tags: ["Sessions"],
          summary: "Open a canonical SMS session. This is the main one-stop API entrypoint.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActivationCreateRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Opened SMS session.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      session: { $ref: "#/components/schemas/SmsManagedSession" },
                    },
                    required: ["session"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/recover-by-phone": {
        post: {
          tags: ["Sessions"],
          summary: "Recover a locally managed SMS session by phone number.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    phoneNumber: { type: "string" },
                    providerKey: { type: "string" },
                  },
                  required: ["phoneNumber"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Recovery result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      result: {
                        type: "object",
                        properties: {
                          recovered: { type: "boolean" },
                          strategy: { type: "string", enum: ["session_restore", "not_supported"] },
                          session: { $ref: "#/components/schemas/SmsManagedSession" },
                          detail: { type: "string" },
                        },
                        required: ["recovered", "strategy"],
                      },
                    },
                    required: ["result"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/report-outcome": {
        post: {
          tags: ["Sessions"],
          summary: "Report an outcome for a managed SMS session.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SmsSessionOutcomeReport" },
              },
            },
          },
          responses: {
            "200": {
              description: "Outcome report result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      result: {
                        type: "object",
                        properties: {
                          accepted: { type: "boolean" },
                          sessionId: { type: "string" },
                          providerKey: { type: "string" },
                          recordedAtIso: { type: "string" },
                          detail: { type: "string" },
                        },
                        required: ["accepted", "sessionId", "providerKey", "recordedAtIso"],
                      },
                    },
                    required: ["result"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/messages/observe": {
        post: {
          tags: ["Sessions"],
          summary: "Manually append an observed message to a managed SMS session.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ObserveSmsMessageInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Observed message record.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { $ref: "#/components/schemas/SmsSessionMessage" },
                    },
                    required: ["message"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/{sessionId}/status": {
        get: {
          tags: ["Sessions"],
          summary: "Read a managed SMS session status by sessionId.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Managed session status.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: { $ref: "#/components/schemas/ActivationStatus" },
                    },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/{sessionId}/code": {
        get: {
          tags: ["Sessions"],
          summary: "Read the best current OTP code projection for a managed SMS session.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Managed session OTP result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      code: { $ref: "#/components/schemas/SmsSessionCodeResult" },
                    },
                    required: ["code"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/{sessionId}/messages": {
        get: {
          tags: ["Sessions"],
          summary: "List normalized observed or projected messages for a managed SMS session.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Managed session messages.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      messages: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsSessionMessage" },
                      },
                    },
                    required: ["messages"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/sessions/{sessionId}/actions": {
        post: {
          tags: ["Sessions"],
          summary: "Apply a lifecycle action to a managed SMS session by sessionId.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActivationActionRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Managed session action result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      result: { $ref: "#/components/schemas/ActivationActionResult" },
                    },
                    required: ["result"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/providers": {
        get: {
          tags: ["Admin"],
          summary: "Query provider catalog using the new session-centric namespace.",
          parameters: [
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
            {
              name: "capability",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Queried provider catalog.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      providers: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ProviderDescriptor" },
                      },
                    },
                    required: ["providers"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/runtime": {
        get: {
          tags: ["Admin"],
          summary: "Query background runtime diagnostics for maintenance, active-probe, and persistence loops.",
          responses: {
            "200": {
              description: "Runtime diagnostics response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      runtime: { $ref: "#/components/schemas/EasySmsRuntimeDiagnostics" },
                    },
                    required: ["runtime"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/providers/health": {
        get: {
          tags: ["Admin"],
          summary: "Query canonical provider health, route health, and trend data without leaving the native namespace.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "mode",
              in: "query",
              schema: { type: "string", enum: ["summary", "detail"] },
            },
            {
              name: "includeProviders",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "includeRoutes",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "includeTrends",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: {
            "200": {
              description: "Provider health query response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      summary: { $ref: "#/components/schemas/SmsProviderHealthSummary" },
                      providers: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderHealthSnapshot" },
                      },
                      routes: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderRouteHealthSnapshot" },
                      },
                      trends: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderProbeTrendSnapshot" },
                      },
                    },
                    required: ["summary"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/providers/probe-history": {
        get: {
          tags: ["Admin"],
          summary: "Query canonical provider probe history and aggregated trends.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "mode",
              in: "query",
              schema: { type: "string", enum: ["summary", "detail"] },
            },
            {
              name: "includeHistory",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "includeTrends",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "routeKind",
              in: "query",
              schema: { type: "string", enum: ["list-public-numbers", "read-public-inbox"] },
            },
            {
              name: "healthState",
              in: "query",
              schema: { type: "string", enum: ["unknown", "healthy", "empty", "challenge", "blocked", "degraded"] },
            },
            {
              name: "since",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "newestFirst",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Provider probe history query response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      history: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderProbeHistoryEntry" },
                      },
                      trends: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderProbeTrendSnapshot" },
                      },
                    },
                    required: [],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/providers/selection-plan": {
        get: {
          tags: ["Admin"],
          summary: "Query the ranked provider selection plan for public-number style routes.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
            {
              name: "countryCode",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryName",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Provider selection plan query response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      strategyModeId: { type: "string" },
                      routeKind: { type: "string", enum: ["list-public-numbers"] },
                      candidates: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsProviderSelectionCandidate" },
                      },
                    },
                    required: ["strategyModeId", "routeKind", "candidates"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/sessions": {
        get: {
          tags: ["Admin"],
          summary: "Query managed SMS sessions.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
            {
              name: "sessionMode",
              in: "query",
              schema: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            },
            {
              name: "phoneNumber",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "service",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryCode",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryName",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "hasCode",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "hasOutcome",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "since",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "newestFirst",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Managed session query response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sessions: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsManagedSession" },
                      },
                    },
                    required: ["sessions"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/sessions/{sessionId}": {
        get: {
          tags: ["Admin"],
          summary: "Query a single managed SMS session by sessionId.",
          parameters: [
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Single managed session response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      session: { $ref: "#/components/schemas/SmsManagedSession" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/messages": {
        get: {
          tags: ["Admin"],
          summary: "Query unified session messages, including projected provider messages and manual observations.",
          parameters: [
            {
              name: "sessionId",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "sourceType",
              in: "query",
              schema: { type: "string", enum: ["provider-inbox", "activation-status", "manual-observe"] },
            },
            {
              name: "extractedCodeOnly",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "includeProjected",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "includeManual",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "refreshProjected",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "since",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "newestFirst",
              in: "query",
              schema: { type: "boolean" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Observed message query response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      messages: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsSessionMessage" },
                      },
                    },
                    required: ["messages"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/messages/{messageId}": {
        get: {
          tags: ["Admin"],
          summary: "Query a single unified session message by messageId.",
          parameters: [
            {
              name: "messageId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "refreshProjected",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: {
            "200": {
              description: "Single session message response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { $ref: "#/components/schemas/SmsSessionMessage" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/sms/query/stats": {
        get: {
          tags: ["Admin"],
          summary: "Query lightweight runtime persistence statistics.",
          responses: {
            "200": {
              description: "Runtime stats response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      stats: { $ref: "#/components/schemas/SmsPersistenceStats" },
                    },
                    required: ["stats"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/providers/probe-all": {
        get: {
          tags: ["Admin"],
          summary: "Probe all providers through the new namespaced admin route.",
          responses: {
            "200": {
              description: "Provider probe list.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      probes: {
                        type: "array",
                        items: {
                          type: "object",
                        },
                      },
                    },
                    required: ["probes"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/providers/{providerKey}/probe": {
        get: {
          tags: ["Admin"],
          summary: "Probe one provider through the new namespaced admin route.",
          parameters: [
            {
              name: "providerKey",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Single provider probe result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      probe: {
                        type: "object",
                      },
                    },
                    required: ["probe"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/maintenance/run": {
        post: {
          tags: ["Admin"],
          summary: "Run one maintenance cycle immediately.",
          responses: {
            "200": {
              description: "Maintenance result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      maintenance: {
                        type: "object",
                      },
                    },
                    required: ["maintenance"],
                  },
                },
              },
            },
          },
        },
      },
      "/providers": {
        get: {
          tags: ["Providers"],
          summary: "Legacy provider catalog route.",
          parameters: [
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
            {
              name: "capability",
              in: "query",
              schema: { type: "string" },
              description: "Filter the provider catalog by capability such as create-activation.",
            },
          ],
          responses: {
            "200": {
              description: "Provider catalog response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      providers: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ProviderDescriptor" },
                      },
                    },
                    required: ["providers"],
                  },
                },
              },
            },
          },
        },
      },
      "/providers/health": {
        get: {
          tags: ["Health"],
          summary: "Get provider health state, route health, and trend snapshots.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Provider health response.",
            },
          },
        },
      },
      "/providers/probe-history": {
        get: {
          tags: ["Health"],
          summary: "Get recent probe history and trend data.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Provider probe history response.",
            },
          },
        },
      },
      "/providers/selection-plan": {
        get: {
          tags: ["Providers"],
          summary: "Inspect provider ordering for public-number selection.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryCode",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryName",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
          ],
          responses: {
            "200": {
              description: "Provider selection plan.",
            },
          },
        },
      },
      "/providers/probe": {
        post: {
          tags: ["Health"],
          summary: "Trigger a provider probe for one provider or for all public-number providers.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Probe results.",
            },
          },
        },
      },
      "/sms/public-numbers": {
        get: {
          tags: ["Public SMS"],
          summary: "List public SMS numbers from the unified free-provider layer.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1 },
            },
            {
              name: "countryCode",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "countryName",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
          ],
          responses: {
            "200": {
              description: "Public numbers response.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: { $ref: "#/components/schemas/SmsPublicNumber" },
                      },
                      errors: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            providerKey: { type: "string" },
                            message: { type: "string" },
                          },
                          required: ["providerKey", "message"],
                        },
                      },
                    },
                    required: ["items", "errors"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/inbox": {
        get: {
          tags: ["Public SMS"],
          summary: "Read a public SMS inbox for a specific provider and numberId.",
          parameters: [
            {
              name: "providerKey",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "numberId",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Inbox snapshot.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SmsInboxSnapshot" },
                },
              },
            },
          },
        },
      },
      "/providers/hero_sms/countries": {
        get: {
          tags: ["Providers"],
          summary: "List HeroSMS country metadata.",
          responses: {
            "200": {
              description: "HeroSMS countries.",
            },
          },
        },
      },
      "/providers/hero_sms/top-countries": {
        get: {
          tags: ["Providers"],
          summary: "List HeroSMS top countries by service.",
          parameters: [
            {
              name: "service",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "ranked",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          responses: {
            "200": {
              description: "HeroSMS country pricing response.",
            },
          },
        },
      },
      "/providers/hero_sms/operators": {
        get: {
          tags: ["Providers"],
          summary: "List HeroSMS operator options for a country and service.",
          parameters: [
            {
              name: "country",
              in: "query",
              required: true,
              schema: { type: "integer" },
            },
            {
              name: "service",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "HeroSMS operator quote response.",
            },
          },
        },
      },
      "/sms/activations": {
        post: {
          tags: ["Activations"],
          summary: "Create a generic activation session across free or paid providers.",
          description: [
            "If providerKey is omitted, EasySms prefers free synthetic activation sessions when available.",
            "country remains HeroSMS-compatible for paid providers.",
            "countryCode, countryName, and numberId are EasySms facade extensions for free and mixed-mode activation selection.",
          ].join(" "),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActivationCreateRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Activation created.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      activation: { $ref: "#/components/schemas/ActivationSession" },
                    },
                    required: ["activation"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/activations/{activationId}/status": {
        get: {
          tags: ["Activations"],
          summary: "Get activation session status.",
          parameters: [
            {
              name: "activationId",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
            {
              name: "providerKey",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "costTier",
              in: "query",
              schema: { type: "string", enum: ["free", "paid"] },
            },
          ],
          responses: {
            "200": {
              description: "Activation status.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      activation: { $ref: "#/components/schemas/ActivationStatus" },
                    },
                    required: ["activation"],
                  },
                },
              },
            },
          },
        },
      },
      "/sms/activations/{activationId}/actions": {
        post: {
          tags: ["Activations"],
          summary: "Update an activation session state.",
          parameters: [
            {
              name: "activationId",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ActivationActionRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Activation state update result.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      activation: { $ref: "#/components/schemas/ActivationActionResult" },
                    },
                    required: ["activation"],
                  },
                },
              },
            },
          },
        },
      },
      "/stubs/handler_api.php": {
        get: {
          tags: ["Compatibility"],
          summary: "HeroSMS or SMS-Activate style compatibility facade.",
          description: [
            "Supported actions: getCountries, getPrices, getTopCountriesByService, getTopCountriesByServiceRank, getOperators, getNumberV2, getStatus, getStatusV2, setStatus.",
            "The same facade can create synthetic activation sessions on free providers when providerKey or costTier resolves to the public-inbox layer.",
            "EasySms extensions for unified selection: countryCode, countryName, numberId, providerKey, costTier.",
          ].join(" "),
          parameters: [
            {
              name: "action",
              in: "query",
              required: true,
              schema: {
                type: "string",
                enum: [
                  "getCountries",
                  "getPrices",
                  "getTopCountriesByService",
                  "getTopCountriesByServiceRank",
                  "getOperators",
                  "getNumberV2",
                  "getStatus",
                  "getStatusV2",
                  "setStatus",
                ],
              },
            },
          ],
          responses: {
            "200": {
              description: "Action-specific compatibility response.",
            },
          },
        },
      },
      "/admin/providers/{providerKey}/disable": {
        post: {
          tags: ["Admin"],
          summary: "Temporarily disable a provider.",
          parameters: [
            {
              name: "providerKey",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Updated provider health snapshot.",
            },
          },
        },
      },
      "/admin/providers/{providerKey}/enable": {
        post: {
          tags: ["Admin"],
          summary: "Re-enable a provider.",
          parameters: [
            {
              name: "providerKey",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Updated provider health snapshot.",
            },
          },
        },
      },
      "/admin/providers/{providerKey}/reset": {
        post: {
          tags: ["Admin"],
          summary: "Reset provider operational state.",
          parameters: [
            {
              name: "providerKey",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Provider operational state reset result.",
            },
          },
        },
      },
      "/admin/providers/{providerKey}/probe": {
        post: {
          tags: ["Admin"],
          summary: "Trigger a probe for a specific provider.",
          parameters: [
            {
              name: "providerKey",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Probe result for the provider.",
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ProviderDescriptor: {
          type: "object",
          properties: {
            key: { type: "string" },
            displayName: { type: "string" },
            homepageUrl: { type: "string" },
            sourceType: { type: "string", enum: ["public-web-scrape", "otp-activation-api"] },
            costTier: { type: "string", enum: ["free", "paid"] },
            capabilities: {
              type: "array",
              items: { type: "string" },
            },
            enabled: { type: "boolean" },
            countryHints: {
              type: "array",
              items: { type: "string" },
            },
            notes: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["key", "displayName", "homepageUrl", "sourceType", "costTier", "capabilities", "enabled", "notes"],
        },
        SmsCatalog: {
          type: "object",
          properties: {
            providers: {
              type: "array",
              items: { $ref: "#/components/schemas/ProviderDescriptor" },
            },
            strategyModeId: { type: "string" },
            compatibility: {
              type: "object",
              properties: {
                facadePath: { type: "string" },
                supportedActions: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["facadePath", "supportedActions"],
            },
          },
          required: ["providers", "strategyModeId", "compatibility"],
        },
        EasySmsRuntimeLoopSnapshot: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            intervalMs: { type: "integer" },
            runCount: { type: "integer" },
            successCount: { type: "integer" },
            failureCount: { type: "integer" },
            lastStartedAt: { type: "string" },
            lastCompletedAt: { type: "string" },
            lastSucceededAt: { type: "string" },
            lastFailedAt: { type: "string" },
            lastDurationMs: { type: "integer" },
            detail: { type: "string" },
            lastError: { type: "string" },
          },
          required: ["enabled", "runCount", "successCount", "failureCount"],
        },
        EasySmsRuntimeStateLoadSnapshot: {
          type: "object",
          properties: {
            attempted: { type: "boolean" },
            status: { type: "string", enum: ["not_attempted", "skipped", "loaded", "empty", "failed"] },
            checkedAt: { type: "string" },
            detail: { type: "string" },
            lastError: { type: "string" },
          },
          required: ["attempted", "status"],
        },
        EasySmsRuntimeDiagnostics: {
          type: "object",
          properties: {
            serviceStartedAt: { type: "string" },
            stateStore: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                driver: { type: "string" },
                filePath: { type: "string" },
              },
              required: ["enabled", "driver", "filePath"],
            },
            stateLoad: { $ref: "#/components/schemas/EasySmsRuntimeStateLoadSnapshot" },
            maintenanceLoop: { $ref: "#/components/schemas/EasySmsRuntimeLoopSnapshot" },
            activeProbeLoop: { $ref: "#/components/schemas/EasySmsRuntimeLoopSnapshot" },
            persistenceLoop: { $ref: "#/components/schemas/EasySmsRuntimeLoopSnapshot" },
          },
          required: [
            "serviceStartedAt",
            "stateStore",
            "stateLoad",
            "maintenanceLoop",
            "activeProbeLoop",
            "persistenceLoop",
          ],
        },
        SmsProviderHealthSummary: {
          type: "object",
          properties: {
            totalProviders: { type: "integer" },
            activeCount: { type: "integer" },
            coolingCount: { type: "integer" },
            temporarilyDisabledCount: { type: "integer" },
            degradedCount: { type: "integer" },
            challengeCount: { type: "integer" },
            blockedCount: { type: "integer" },
            emptyCount: { type: "integer" },
          },
          required: [
            "totalProviders",
            "activeCount",
            "coolingCount",
            "temporarilyDisabledCount",
            "degradedCount",
            "challengeCount",
            "blockedCount",
            "emptyCount",
          ],
        },
        SmsProviderHealthSnapshot: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            status: { type: "string", enum: ["active", "cooling", "temporarily_disabled", "degraded", "offline"] },
            healthState: { type: "string", enum: ["unknown", "healthy", "empty", "challenge", "blocked", "degraded"] },
            healthScore: { type: "number" },
            consecutiveFailures: { type: "integer" },
            activeRouteCoolingCount: { type: "integer" },
            lastCheckedAt: { type: "string" },
            lastSuccessAt: { type: "string" },
            lastFailureAt: { type: "string" },
            lastEmptyAt: { type: "string" },
            lastRouteKind: { type: "string", enum: ["list-public-numbers", "read-public-inbox"] },
            lastDetail: { type: "string" },
            lastErrorClass: { type: "string" },
            lastErrorMessage: { type: "string" },
            cooldownUntil: { type: "string" },
            temporarilyDisabledUntil: { type: "string" },
            temporarilyDisabledReason: { type: "string" },
          },
          required: [
            "providerKey",
            "providerDisplayName",
            "status",
            "healthState",
            "healthScore",
            "consecutiveFailures",
            "activeRouteCoolingCount",
          ],
        },
        SmsProviderRouteHealthSnapshot: {
          type: "object",
          properties: {
            routeKey: { type: "string" },
            providerKey: { type: "string" },
            routeKind: { type: "string", enum: ["list-public-numbers", "read-public-inbox"] },
            scopeKind: { type: "string", enum: ["provider", "country"] },
            scopeValue: { type: "string" },
            penalty: { type: "number" },
            consecutiveFailures: { type: "integer" },
            cooldownUntil: { type: "string" },
            lastErrorClass: { type: "string" },
            lastErrorCode: { type: "string" },
            lastErrorMessage: { type: "string" },
            lastReportedAt: { type: "string" },
          },
          required: [
            "routeKey",
            "providerKey",
            "routeKind",
            "scopeKind",
            "scopeValue",
            "penalty",
            "consecutiveFailures",
          ],
        },
        SmsProviderProbeHistoryEntry: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            checkedAt: { type: "string" },
            routeKind: { type: "string", enum: ["list-public-numbers", "read-public-inbox"] },
            ok: { type: "boolean" },
            healthState: { type: "string", enum: ["unknown", "healthy", "empty", "challenge", "blocked", "degraded"] },
            status: { type: "string", enum: ["active", "cooling", "temporarily_disabled", "degraded", "offline"] },
            errorClass: { type: "string" },
            detail: { type: "string" },
            publicNumberCount: { type: "integer" },
            inboxMessageCount: { type: "integer" },
          },
          required: [
            "providerKey",
            "providerDisplayName",
            "checkedAt",
            "routeKind",
            "ok",
            "healthState",
            "status",
          ],
        },
        SmsProviderProbeTrendSnapshot: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            windowStartAt: { type: "string" },
            windowEndAt: { type: "string" },
            sampleCount: { type: "integer" },
            successCount: { type: "integer" },
            emptyCount: { type: "integer" },
            challengeCount: { type: "integer" },
            blockedCount: { type: "integer" },
            degradedCount: { type: "integer" },
            errorClassCounts: {
              type: "object",
              additionalProperties: { type: "integer" },
            },
            lastCheckedAt: { type: "string" },
            trendPenalty: { type: "number" },
            trendScore: { type: "number" },
          },
          required: [
            "providerKey",
            "providerDisplayName",
            "windowEndAt",
            "sampleCount",
            "successCount",
            "emptyCount",
            "challengeCount",
            "blockedCount",
            "degradedCount",
            "errorClassCounts",
            "trendPenalty",
            "trendScore",
          ],
        },
        SmsProviderSelectionCandidate: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            routeKind: { type: "string", enum: ["list-public-numbers", "read-public-inbox"] },
            scopeKind: { type: "string", enum: ["provider", "country"] },
            scopeValue: { type: "string" },
            providerStatus: { type: "string", enum: ["active", "cooling", "temporarily_disabled", "degraded", "offline"] },
            healthState: { type: "string", enum: ["unknown", "healthy", "empty", "challenge", "blocked", "degraded"] },
            healthScore: { type: "number" },
            available: { type: "boolean" },
            availabilityIssue: { type: "string" },
            exactRoutePenalty: { type: "number" },
            providerRoutePenalty: { type: "number" },
            errorClassPenalty: { type: "number" },
            emptyPenalty: { type: "number" },
            statusPenalty: { type: "number" },
            trendPenalty: { type: "number" },
            trendScore: { type: "number" },
            effectiveScore: { type: "number" },
            fallbackRank: { type: "integer" },
            notes: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "providerKey",
            "providerDisplayName",
            "routeKind",
            "scopeKind",
            "scopeValue",
            "providerStatus",
            "healthState",
            "healthScore",
            "available",
            "exactRoutePenalty",
            "providerRoutePenalty",
            "errorClassPenalty",
            "emptyPenalty",
            "statusPenalty",
            "trendPenalty",
            "trendScore",
            "effectiveScore",
            "fallbackRank",
            "notes",
          ],
        },
        SmsManagedSession: {
          type: "object",
          properties: {
            id: { type: "string" },
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            activationId: { type: "integer" },
            sessionMode: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            costTier: { type: "string", enum: ["free", "paid"] },
            numberId: { type: "string" },
            phoneNumber: { type: "string" },
            sourceUrl: { type: "string" },
            service: { type: "string" },
            countryId: { type: "integer" },
            countryCode: { type: "string" },
            countryName: { type: "string" },
            operator: { type: "string" },
            activationCost: { type: "number" },
            openedAtIso: { type: "string" },
            cancelledAtIso: { type: "string" },
            completedAtIso: { type: "string" },
            lastRequestedCodeAtIso: { type: "string" },
            lastStatusAtIso: { type: "string" },
            lastCode: { type: "string" },
            lastCodeAtIso: { type: "string" },
            lastText: { type: "string" },
          },
          required: [
            "id",
            "providerKey",
            "providerDisplayName",
            "activationId",
            "sessionMode",
            "costTier",
            "phoneNumber",
            "service",
            "countryId",
            "openedAtIso",
          ],
        },
        SmsSessionPlan: {
          type: "object",
          properties: {
            planned: { type: "boolean" },
            routeKind: { type: "string", enum: ["open-sms-session"] },
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            costTier: { type: "string", enum: ["free", "paid"] },
            sessionMode: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            countryId: { type: "integer" },
            countryCode: { type: "string" },
            countryName: { type: "string" },
            numberId: { type: "string" },
            phoneNumber: { type: "string" },
            compatibilityAction: { type: "string" },
            notes: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["planned", "routeKind", "notes"],
        },
        SmsSessionMessage: {
          type: "object",
          properties: {
            id: { type: "string" },
            sessionId: { type: "string" },
            providerKey: { type: "string" },
            sourceType: { type: "string", enum: ["provider-inbox", "activation-status", "manual-observe"] },
            sender: { type: "string" },
            receivedAtText: { type: "string" },
            receivedAtIso: { type: "string" },
            content: { type: "string" },
            code: { type: "string" },
            sourceUrl: { type: "string" },
            observedAtIso: { type: "string" },
          },
          required: ["id", "sessionId", "providerKey", "sourceType", "content", "observedAtIso"],
        },
        SmsSessionCodeResult: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            providerKey: { type: "string" },
            code: { type: "string" },
            source: { type: "string", enum: ["provider-inbox", "activation-status", "manual-observe", "none"] },
            observedMessageId: { type: "string" },
            receivedAtIso: { type: "string" },
            text: { type: "string" },
            candidates: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["sessionId", "providerKey", "source", "candidates"],
        },
        SmsSessionOutcomeReport: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            success: { type: "boolean" },
            failureReason: { type: "string" },
            observedAt: { type: "string" },
            source: { type: "string" },
            detail: { type: "string" },
          },
          required: ["sessionId", "success"],
        },
        ObserveSmsMessageInput: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            sender: { type: "string" },
            receivedAtText: { type: "string" },
            receivedAtIso: { type: "string" },
            content: { type: "string" },
            code: { type: "string" },
            sourceUrl: { type: "string" },
          },
          required: ["sessionId", "content"],
        },
        SmsPersistenceStats: {
          type: "object",
          properties: {
            sessionCount: { type: "integer" },
            observedMessageCount: { type: "integer" },
            providerCount: { type: "integer" },
            syntheticSessionCount: { type: "integer" },
            paidSessionCount: { type: "integer" },
            storedObservedMessageCount: { type: "integer" },
            cachedProjectedMessageCount: { type: "integer" },
          },
          required: [
            "sessionCount",
            "observedMessageCount",
            "providerCount",
            "syntheticSessionCount",
            "paidSessionCount",
            "storedObservedMessageCount",
            "cachedProjectedMessageCount",
          ],
        },
        EasySmsRuntimeStateSnapshot: {
          type: "object",
          properties: {
            providers: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderHealthSnapshot" },
            },
            routes: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderRouteHealthSnapshot" },
            },
            probeHistory: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderProbeHistoryEntry" },
            },
            managedSessions: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsManagedSession" },
            },
            observedMessages: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsSessionMessage" },
            },
            projectedMessages: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsSessionMessage" },
            },
            nextSyntheticActivationId: { type: "integer" },
            nextSessionSequence: { type: "integer" },
            updatedAt: { type: "string" },
          },
          required: ["providers", "routes", "probeHistory", "updatedAt"],
        },
        EasySmsPublicRuntimeStateSnapshot: {
          type: "object",
          properties: {
            providers: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderHealthSnapshot" },
            },
            routes: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderRouteHealthSnapshot" },
            },
            probeHistory: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsProviderProbeHistoryEntry" },
              description: "Included only in detail snapshots. Use /sms/query/providers/probe-history for the canonical history surface.",
            },
            nextSyntheticActivationId: { type: "integer" },
            nextSessionSequence: { type: "integer" },
            updatedAt: { type: "string" },
          },
          required: ["providers", "routes", "updatedAt"],
        },
        EasySmsSnapshot: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["summary", "detail"] },
            catalog: { $ref: "#/components/schemas/SmsCatalog" },
            runtime: { $ref: "#/components/schemas/EasySmsRuntimeDiagnostics" },
            runtimeState: { $ref: "#/components/schemas/EasySmsPublicRuntimeStateSnapshot" },
            sessions: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsManagedSession" },
            },
            observedMessages: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsSessionMessage" },
            },
            projectedMessages: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsSessionMessage" },
            },
          },
          required: ["mode", "catalog", "runtime", "runtimeState"],
        },
        SmsPublicNumber: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            numberId: { type: "string" },
            sourceUrl: { type: "string" },
            phoneNumber: { type: "string" },
            countryName: { type: "string" },
            countryCode: { type: "string" },
            label: { type: "string" },
            latestActivityText: { type: "string" },
          },
          required: ["providerKey", "providerDisplayName", "numberId", "sourceUrl", "phoneNumber"],
        },
        SmsInboxMessage: {
          type: "object",
          properties: {
            id: { type: "string" },
            sender: { type: "string" },
            receivedAtText: { type: "string" },
            receivedAtIso: { type: "string" },
            content: { type: "string" },
            sourceUrl: { type: "string" },
          },
          required: ["id", "content", "sourceUrl"],
        },
        SmsInboxSnapshot: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            providerDisplayName: { type: "string" },
            numberId: { type: "string" },
            phoneNumber: { type: "string" },
            countryName: { type: "string" },
            countryCode: { type: "string" },
            sourceUrl: { type: "string" },
            fetchedAtIso: { type: "string" },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/SmsInboxMessage" },
            },
          },
          required: ["providerKey", "providerDisplayName", "numberId", "phoneNumber", "sourceUrl", "fetchedAtIso", "messages"],
        },
        ActivationCreateRequest: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            costTier: { type: "string", enum: ["free", "paid"] },
            service: { type: "string" },
            country: { type: "integer" },
            countryCode: { type: "string" },
            countryName: { type: "string" },
            numberId: { type: "string" },
            operator: { type: "string" },
            maxPrice: { type: "number" },
            fixedPrice: { type: "boolean" },
            ref: { type: "string" },
            phoneException: { type: "string" },
            phoneBlacklist: {
              type: "array",
              items: { type: "string" },
            },
            selectionMode: { type: "string", enum: ["price-first", "success-first", "stock-first", "balanced"] },
            allowReuse: { type: "boolean" },
            businessKey: { type: "string" },
            maxBindingsPerPhone: { type: "integer" },
          },
        },
        ActivationSession: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            activationId: { type: "integer" },
            upstreamActivationId: { type: "integer" },
            phoneNumber: { type: "string" },
            service: { type: "string" },
            countryId: { type: "integer" },
            countryCode: { type: "string" },
            countryName: { type: "string" },
            numberId: { type: "string" },
            sourceUrl: { type: "string" },
            operator: { type: "string" },
            activationCost: { type: "number" },
            costTier: { type: "string", enum: ["free", "paid"] },
            sessionMode: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            selectionMode: { type: "string", enum: ["price-first", "success-first", "stock-first", "balanced"] },
            businessKey: { type: "string" },
            assignmentIndex: { type: "integer" },
            maxBindingsPerPhone: { type: "integer" },
            refundableCancelAvailableAtIso: { type: "string" },
            leaseExpiresAtIso: { type: "string" },
            refundEligible: { type: "boolean" },
            createdAtIso: { type: "string" },
          },
          required: ["providerKey", "activationId", "phoneNumber", "service", "countryId", "createdAtIso"],
        },
        ActivationStatus: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            activationId: { type: "integer" },
            upstreamActivationId: { type: "integer" },
            sessionId: { type: "string" },
            fetchedAtIso: { type: "string" },
            received: { type: "boolean" },
            cancelled: { type: "boolean" },
            numberId: { type: "string" },
            sourceUrl: { type: "string" },
            countryCode: { type: "string" },
            countryName: { type: "string" },
            messageCount: { type: "integer" },
            verificationType: { type: "integer" },
            code: { type: "string" },
            text: { type: "string" },
            receivedAtIso: { type: "string" },
            callFrom: { type: "string" },
            callText: { type: "string" },
            callCode: { type: "string" },
            callReceivedAtIso: { type: "string" },
            callAudioUrl: { type: "string" },
            rawStatusText: { type: "string" },
            costTier: { type: "string", enum: ["free", "paid"] },
            sessionMode: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            selectionMode: { type: "string", enum: ["price-first", "success-first", "stock-first", "balanced"] },
            businessKey: { type: "string" },
            assignmentIndex: { type: "integer" },
            maxBindingsPerPhone: { type: "integer" },
            refundableCancelAvailableAtIso: { type: "string" },
            leaseExpiresAtIso: { type: "string" },
            refundEligible: { type: "boolean" },
          },
          required: ["providerKey", "activationId", "fetchedAtIso", "received", "cancelled"],
        },
        ActivationActionRequest: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            costTier: { type: "string", enum: ["free", "paid"] },
            action: { type: "string", enum: ["request-code", "complete", "cancel"] },
          },
          required: ["action"],
        },
        ActivationActionResult: {
          type: "object",
          properties: {
            providerKey: { type: "string" },
            activationId: { type: "integer" },
            upstreamActivationId: { type: "integer" },
            sessionId: { type: "string" },
            requestedAction: { type: "string", enum: ["request-code", "complete", "cancel"] },
            requestedStatus: { type: "integer" },
            resultText: { type: "string" },
            costTier: { type: "string", enum: ["free", "paid"] },
            sessionMode: { type: "string", enum: ["paid-api", "synthetic-public-inbox"] },
            selectionMode: { type: "string", enum: ["price-first", "success-first", "stock-first", "balanced"] },
            businessKey: { type: "string" },
            assignmentIndex: { type: "integer" },
            maxBindingsPerPhone: { type: "integer" },
            refundableCancelAvailableAtIso: { type: "string" },
            leaseExpiresAtIso: { type: "string" },
            refundEligible: { type: "boolean" },
            updatedAtIso: { type: "string" },
          },
          required: ["providerKey", "activationId", "requestedAction", "requestedStatus", "resultText", "updatedAtIso"],
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
        },
      },
    },
  };
}
