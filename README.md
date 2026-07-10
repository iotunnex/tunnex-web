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
pnpm dev                         # Astro dev server (fast iteration)
pnpm preview                     # build + serve through the real Worker (wrangler dev)
```

## Checks

```sh
pnpm typecheck     # astro check (TypeScript strict)
pnpm lint          # eslint
pnpm format:check  # prettier
```

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

| Secret                  | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with **Workers Scripts: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID the Worker deploys into   |

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

## DNS / email

_Placeholder — mail.tunnex.io SPF/DKIM/DMARC records documented in S2.1; full go-live
runbook in S4.4._
