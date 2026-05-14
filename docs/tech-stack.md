# Tech Stack

This repository uses a deliberately small, local-first stack. The goal is to
keep the operator-facing API stable while making provider implementations easy
to swap or extend.

## Core Service Runtime

- Language: TypeScript
- Runtime: Node.js `20+`
- Module format: native ESM (`"type": "module"`)
- HTTP server: built on `node:http`, not Express/Fastify
- Config format: YAML
- Main config loader: `yaml`
- HTML parsing and scraping helpers: `cheerio`

## Development Tooling

- Type checking and build: `typescript` / `tsc`
- Local dev entrypoint: `tsx`
- Test framework: `vitest`
- Package manager: `npm`

## Browser And Scraping Fallbacks

- Primary fetch path: native HTTP requests plus browser-like headers
- Secondary fetch path: `curl` fallback where providers need it
- DOM-render fallback: local browser `--dump-dom`
- Container browser runtime: `chromium`

## Operator And Build Tooling

- Host automation scripts: PowerShell
- Config rendering helpers: Python `3.10+`
- Python YAML dependency: `PyYAML`
- Container packaging: Docker
- Base image: `node:20-bookworm-slim`

## CI And Publication

- CI: GitHub Actions
- Image publication: GHCR
- Validation workflow: root `validate.yml`
- Publish workflow: root `publish-service-base-ghcr.yml`

## Architectural Style

- Monorepo operator layout modeled after `EasyEmail`
- Provider-centric domain model
- `free` vs `paid` represented as `costTier` metadata
- Stable external API layered above replaceable provider adapters
- Optional `HeroSMS` / `SMS-Activate` style compatibility facade for activation
  clients
