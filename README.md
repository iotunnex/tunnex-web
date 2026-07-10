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

## Deploy

_Placeholder — CI + deploy pipeline lands in S0.2 (GitHub Actions: PR → preview deploy,
main → production)._

## DNS / email

_Placeholder — mail.tunnex.io SPF/DKIM/DMARC records documented in S2.1; full go-live
runbook in S4.4._
