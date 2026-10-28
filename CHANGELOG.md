# Changelog

All notable changes to VoltLink are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-27

### Added

- **Telemetry**: live vehicle state, sleep-aware polling, partitioned
  telemetry storage, auto-detected drives and charging sessions.
- **Controls**: full command lifecycle
  (`queued → submitted → accepted → confirmed` with
  `failed/rejected/unsupported/timed_out/canceled`), high-risk step-up auth,
  kill switches, rate limits, audit trail.
- **Providers**: official Tesla Fleet API adapter, optional Tessie adapter,
  deterministic DemoProvider, scriptable MockProvider; encrypted credential
  store; readiness diagnostics.
- **Auth**: Argon2id passwords, email verification, TOTP, WebAuthn passkeys,
  session management + revocation, CSRF protection, rate limiting.
- **Analytics**: drives + totals, charging + cost rules (flat/TOU/location),
  battery health, efficiency, charging behaviour, CSV/JSON exports.
- **Automations**: 12 triggers, conditions, actions (notify, webhook,
  incident, report, vehicle command), cooldowns, dry-run, execution history.
- **Notifications**: 8 channels (in-app, email, push, webhook, ntfy, Gotify,
  Discord, Teams) with per-channel preferences.
- **Fleet**: groups, drivers, departments, cost centers, assignments,
  maintenance, fleet report.
- **Status platform**: 16 components, incidents + updates, maintenance
  windows, uptime, public page, RSS, SVG badge, subscriptions.
- **Web**: 5 themes (incl. high-contrast and colorblind-safe), SSE realtime
  with polling fallback, state-aware WebGL showroom with Blender-generated
  GLB assets (5 vehicle classes + LODs), offline fictional map, presentation
  mode, onboarding.
- **Ops**: multi-role Docker image, dev + production compose stacks, GHCR
  publishing (`latest`, `v1.0.0`, commit SHA), CI with E2E, asset validation,
  audit + Trivy + SBOM.
- **Privacy**: privacy zones, configurable retention, full export, permanent
  deletion.
- **Docs**: full documentation suite + OpenAPI spec.

### Security

- Provider credentials envelope-encrypted (AES-256-GCM, wrapped DEK,
  versioned keys).
- Boot-time refusal of placeholder secrets.
