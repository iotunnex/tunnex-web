# tunnex-site

Marketing site for [Tunnex](https://tunnex.io) — self-hosted Zero Trust VPN.
**Your keys. Your servers. Your network.**

This repo is deliberately separate from the product repo: the site is a separate
trust domain, and Tunnex-hosted infrastructure is never in the product's trust path.

## Stack

- [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) (docs) + Tailwind CSS
- Deployed as a Cloudflare Worker with static assets via `@astrojs/cloudflare`
- TypeScript strict, ESLint + Prettier

## Prerequisites

- Node.js ≥ 22 (required by wrangler 4; see `.nvmrc`)
- pnpm 10+

## Local development

```sh
pnpm install
cp .dev.vars.example .dev.vars   # local env vars/secrets (gitignored)
pnpm db:migrate:local            # apply D1 migrations to the local simulator
pnpm dev                         # Astro dev server (fast iteration)
pnpm preview                     # build + serve through the real Worker (wrangler dev)
```

Local development needs **zero Cloudflare credentials**: D1 and KV run in wrangler's
local simulation (state under `.wrangler/state/`, gitignored). Cloudflare account
credentials are CI-only — never `wrangler login` or token files on a laptop.

## Checks

```sh
pnpm typecheck     # astro check (TypeScript strict)
pnpm lint          # eslint
pnpm format:check  # prettier
```

## Design tokens (the token contract)

Every color on the site comes from `src/styles/theme.css` — the single source of truth.
Two layers:

- **Primitives** (`--p-*`): raw OKLCH scales. Referenced ONLY inside `theme.css`.
- **Semantic tokens**: what components use, via Tailwind utilities. `.dark` on `<html>`
  remaps the same names, so components are mode-unaware.

| Semantic token                       | Utility examples                | Use                                     |
| ------------------------------------ | ------------------------------- | --------------------------------------- |
| `--color-bg`                         | `bg-bg`                         | page background                         |
| `--color-surface`                    | `bg-surface`                    | cards, code blocks                      |
| `--color-surface-raised`             | `bg-surface-raised`             | raised/hover surfaces                   |
| `--color-border`                     | `border-border`                 | borders, dividers                       |
| `--color-text`                       | `text-text`                     | primary text                            |
| `--color-text-muted`                 | `text-text-muted`               | secondary text                          |
| `--color-primary(-hover/-fg)`        | `bg-primary`, `text-primary-fg` | the ONE brand accent (CTAs, highlights) |
| `--color-link`                       | `text-link`                     | links / inline highlights               |
| `--color-success/warning/error(-fg)` | `bg-success`, `text-error` …    | semantic status (NOT brand)             |

Rules (CI-enforced by `pnpm lint:tokens`, part of `pnpm lint`):

- No raw hex/oklch/rgb/hsl values outside `theme.css`.
- No `--p-*` references outside `theme.css`.
- No Tailwind default-palette classes (`bg-zinc-900`, …) — the default palette is
  disabled, so they'd silently produce no CSS.
- Changing the brand = editing the primitive layer in `theme.css` only; zero component
  changes. `/styleguide` is the acceptance surface for theme swaps.

## Data (D1 + KV)

- **D1** (`DB` binding, database `tunnex-site-db`): durable data — subscribers,
  trial_requests, trials, enterprise_leads, email_events. Schema changes are numbered
  SQL files in `migrations/`.
- **KV** (`RATE_LIMIT` binding): rate-limit counters only. Rate limiting NEVER writes
  to D1.

Migration rules:

- Local: `pnpm db:migrate:local` (wrangler local simulator).
- Remote: applied **only** by `deploy.yml` on pushes to main (`wrangler d1 migrations
apply tunnex-site-db --remote` runs before `wrangler deploy`; a migration failure
  fails the deploy). Migrations are never applied from a laptop.
- **Preview deploys never touch the remote database** — previews validate build +
  serve; schema changes reach the remote DB on main only. A PR that adds a migration
  AND code depending on it will have a preview running against the pre-migration
  schema until merge.

## LAUNCH_MODE

The site runs in one of two modes; flipping the flag is the only change needed:

| Mode        | Behaviour                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `prelaunch` | Downloads show coming-soon + waitlist; trial ends at "approved — key arrives at beta"; GitHub links hidden/marked. |
| `beta`      | Downloads live; trial flow calls the issuance module.                                                              |

Set in `wrangler.toml` `[vars]` (runtime) — prerendered pages bake in the build-time
value (schema default in `astro.config.mjs`, overridable via `.env`/`.dev.vars`).
Import it only from `src/config.ts`.

## Secrets

Never committed, never in `wrangler.toml`. Local: `.dev.vars` (see `.dev.vars.example`).
Production: `wrangler secret put <NAME>`. Required secrets are documented in
`.dev.vars.example` as stories add them.

## CI / Deploy

GitHub Actions (Node pinned from `.nvmrc` in every job — never floating):

- **PR** (`.github/workflows/ci.yml`): typecheck + lint + format check + build, then a
  **preview deploy** (`wrangler versions upload`) whose URL is posted as a sticky PR
  comment. Fork PRs skip the preview (no secrets access).
- **main** (`.github/workflows/deploy.yml`): checks re-run, then `wrangler deploy` to
  the production Worker.

Required GitHub Actions secrets (repo → Settings → Secrets → Actions):

| Secret                  | Purpose                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | API token with **Workers Scripts: Edit**, **D1: Edit**, **Workers KV Storage: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID the Worker deploys into                                    |

Notes:

- `astro build` emits the deployable Worker config (`dist/client/wrangler.json` +
  `.wrangler/deploy/config.json` redirect); `wrangler deploy` / `versions upload` pick it
  up automatically. `wrangler.toml` at the repo root is the source config.
- Preview URLs require the Worker to exist (first production deploy) and the
  `workers.dev` subdomain to be enabled for it.
- Merges to `main` should be blocked on the `checks` job via branch protection /
  a ruleset requiring the status check.
- Dependency policy: latest **stable** release lines only (no betas/RCs/canaries).
  A `renovate`/`dependabot` config is a candidate follow-up to automate bumps.

## Email (Cloudflare Email Service on mail.tunnex.io)

Outbound email sends from `no-reply@mail.tunnex.io` (subdomain sender, supported by
Email Service onboarding), Reply-To `sales@tunnex.io`, through the Workers **EMAIL
binding** (Cloudflare Email Service, public beta) — the binding is the credential;
no API key exists anywhere. Typed mailer: `src/lib/email/mailer.ts` —
`send(kind, to, data)` over a transport-agnostic interface (a Resend fallback would
be a small transport swap); templates in `src/lib/email/templates.ts` (HTML +
plaintext pairs, snapshot-tested). Local dev uses the dev transport (full rendered
email dumped to structured logs) since remote bindings need Cloudflare auth, which
is CI-only.

### DNS

All sending records (SPF, DKIM, DMARC, and the `cf-bounce` MX for bounce processing)
were added automatically — and locked — when `mail.tunnex.io` was onboarded to Email
Service. There is no manual record list to maintain. Inbound mail is **Spacemail**
(root MX `mx1/mx2.spacemail.com`, root SPF `include:spf.spacemail.com`) with
`support@` staffed and `sales@`/`security@` aliases — Cloudflare Email Routing is NOT
used. Verified zone set (2026-07-12): Spacemail MX+SPF on the root;
`cf-bounce.mail.tunnex.io` MX → `route1/2/3.mx.cloudflare.net`;
`_dmarc.mail.tunnex.io` `p=reject`. Recommended follow-up: add a root `_dmarc`
record (Spacemail sends from the root). Bounce handling beyond Cloudflare's own
processing is DIY — a minimal hard-bounce handler is a ledgered follow-up story
candidate.

### Test sends

```sh
# TEST_SEND_KEY in .dev.vars (matches the Worker secret), then against a
# deployed version (the binding only exists there):
node scripts/test-send.mjs https://<preview>.workers.dev you@example.com
```
