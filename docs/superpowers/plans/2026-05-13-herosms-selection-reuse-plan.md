# HeroSMS Selection And Lease Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strategy-driven HeroSMS country/operator selection plus paid lease reuse and refundable cancellation support to EasySms service/base.

**Architecture:** Extend the existing paid activation flow in `easy-sms-service.ts` so HeroSMS activations can be selected by policy, cached as reusable paid leases during their live rent window, and exposed through the existing activation/session API without breaking legacy paid-api semantics. Keep HeroSMS transport in `activation-providers/hero_sms/index.ts`, put orchestration/state in `easy-sms-service.ts`, and cover new contract/state with focused tests before touching implementation.

**Tech Stack:** TypeScript, Vitest, existing EasySms HTTP contracts/OpenAPI, HeroSMS SMS-Activate-compatible HTTP API.

---

## Planned file touch map

- Modify: `service/base/src/domain/models.ts`
  - Extend HeroSMS activation request/session/status models with strategy and reuse metadata.
- Modify: `service/base/src/runtime/from-config.ts`
  - Parse new HeroSMS strategy/reuse config.
- Modify: `service/base/src/defaults/index.ts`
  - Add default HeroSMS selection/reuse config.
- Modify: `service/base/src/activation-providers/hero_sms/index.ts`
  - Add helper methods to fetch ranked country/operator price data in reusable normalized form.
- Modify: `service/base/src/service/easy-sms-service.ts`
  - Implement selection policy, paid lease reuse pool, 2-minute refundable cancel rule, and status decoration.
- Modify: `service/base/src/http/contracts.ts`
  - Parse new create-activation request fields.
- Modify: `service/base/src/http/openapi.ts`
  - Document new request/session/status fields.
- Modify: `service/base/tests/providers/hero-sms/provider.test.ts`
  - Extend provider-level parsing/selection tests.
- Add: `service/base/tests/service/hero-sms-reuse.test.ts`
  - Cover selection strategy, reusable lease assignments, and 2-minute cancel semantics.
- Modify: `service/base/tests/service/http-server.test.ts`
  - Cover new request fields through HTTP endpoints.
- Modify: `config.example.yaml`, `config.yaml`, deploy config templates if new HeroSMS defaults/configs are added.
- Modify: `scripts/test-hero-sms-provider.ps1`
  - Add safe smoke path that always cancels within the refundable window.
- Modify: docs (`service/base/README.md`, `service/base/docs/provider-status.md`, `docs/quickstart.md`, maybe `docs/api-contract.md`)
  - Explain policy modes, reuse semantics, and refundable cancellation behavior.
