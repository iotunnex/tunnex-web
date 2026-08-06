# tunnex-site

> ## ⛔ PUSHING TO `main` DEPLOYS tunnex.io — AND APPLIES D1 MIGRATIONS REMOTELY.
>
> `.github/workflows/deploy.yml` fires on push to `main`. There is no staging step and no manual approval:
> a merge is a production deploy of the live site **and** runs `wrangler d1 migrations apply` against the
> production database. **A migration is not reviewable after the push.**
>
> Work on a branch. ⚠ This is at the top because the previous person found it by deciding where to commit;
> the next one would have found it by pushing.
>
> ⛔ **AND THIS REPO NOW HOLDS THE LICENCE SIGNING KEY** — see [Licence issuance](#licence-issuance).
> Account access is key access.

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

## Trial domain rules (S3.1)

One trial per company domain. The domain is DERIVED from the verified work email
as eTLD+1 via psl — never split-on-@, never user-typed — so subdomained
addresses collapse to the parent (a@eng.acme.com → acme.com) and blocklists are
checked against the DERIVED domain. Free consumer providers and disposable
domains are refused. The disposable list (disposable-email-domains) is
inherently incomplete — accepted gap; determined abusers with custom domains are
handled by the one-trial-per-domain UNIQUE constraint, not the blocklist.

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

---

## Licence issuance

⭐ **The signing key lives in this repo's Worker secrets.** That reverses an earlier ruling (`src/lib/issuance.ts`
used to say "no key material in this repo"), and the reason is recorded there: **the thing that mints keys
belongs where the keys are, not where the product ships.** The platform repo goes to customers; this one
does not.

Decisions and reasoning live in the platform repo: `docs/S12.4-issuance-decisions.md`.

### ⛔ Issuance is MANUAL, and nothing unattended may mint

Tunnex verifies licences **offline**, so there is **no revocation** — a key that is minted is alive until
its expiry and nothing afterwards reaches it. An automated mint is a mistake that cannot be taken back.

⚠ **`onTrialApproved` has two callers**: the verify route, and the **daily cron's promote leg (03:17 UTC,
unattended, in a loop)**. So the human gate lives at the **`Issuer` seam**, never at a call site — that
makes the cron safe by construction rather than by someone remembering it exists.
`src/lib/issuance-gate.test.ts` enforces it: issuer names are harvested from source, every factory must be
dispositioned non-minting, and both glue files are checked.

### ⛔ Generating the signing key — the highest-risk five minutes in this system's life

The private key authorises **minting**, not one licence. A leak is unlimited, unrevocable, and
**undetectable** (deployments never call home — that missing telemetry is exactly what the product promises
not to have).

⚠ **The honest limit of the design:** the Worker imports the key **non-extractable**, so nothing in
production can export it — but **to put it into a Worker secret you must first hold it as text.** The key
exists in plaintext exactly once, on the machine that generates it.

> ## ⛔ **THAT MOMENT IS THE ONLY TIME THE COMMERCIAL MODEL IS COPYABLE. IT IS A HUMAN PROCEDURE, NOT A
>
> ## CODE PROPERTY — IT CANNOT BE TESTED. TREAT IT AS A CEREMONY, NOT A COMMAND.**

On a machine you trust, with shell history off, letting the value touch no file, clipboard manager,
password manager, note, or terminal that scrolls back:

```sh
set +o history   # bash; zsh: unsetopt HISTORY

node -e '
const { subtle } = crypto;
subtle.generateKey({ name: "Ed25519" }, true, ["sign","verify"]).then(async k => {
  const priv = await subtle.exportKey("jwk", k.privateKey);
  const pub  = await subtle.exportKey("jwk", k.publicKey);
  console.log("KID:    ", "k" + new Date().getFullYear());
  console.log("PRIVATE:", JSON.stringify(priv));
  console.log("PUBLIC: ", JSON.stringify(pub));
})'

wrangler secret put SIGNING_KEY_JWK      # paste PRIVATE
wrangler secret put SIGNING_PUBLIC_JWK   # paste PUBLIC
wrangler secret put SIGNING_KID          # paste KID

clear && set -o history
```

**Keep the PUBLIC half** — it is baked into the product binary (S12.2) as one member of a **key set**. It is
not a secret and you will need it again.

**The PRIVATE half now exists only inside Cloudflare.** `wrangler secret put` is write-only; you cannot read
it back and neither can anyone who reaches the dashboard. That property is doing the work.

⛔ **Which means account access IS key access.** Whoever reaches this Cloudflare account can set a new
signing secret or deploy code that exports it. Hardware MFA, minimal membership, no shared logins — not IT
hygiene here, but the control protecting the commercial model.

### ⛔ BEFORE THIS ISSUES A REAL KEY — three preconditions, not a checklist

**The signing surface is built and tested. It cannot issue anything yet, and two of these are deliberate.**

**1. The ceremony has NOT been run.** `SIGNING_KEY_JWK`, `SIGNING_PUBLIC_JWK` and `SIGNING_KID` are unset,
so `/api/admin/issue` returns `sign_failed`. Run the ceremony above — once, on a machine you trust. ⚠ It is
a human procedure, not a code property: nothing here can check that you did it safely.

**2. Migration `0003_licence_issuance.sql` is UNAPPLIED.** `licence_review_queue` and `issued_keys` do not
exist yet. It applies on push to `main` — see the warning at the top of this file — so nothing queues and
nothing is recorded until that happens deliberately.

**3. ⛔ `ADMIN_TOKEN` IS A FLOOR, NOT THE CONTROL — AND CLOUDFLARE ACCESS IN FRONT OF `/api/admin/*` IS A
DEPLOYMENT PRECONDITION, NOT A HARDENING TASK.**

> ## **WHOEVER REACHES `/api/admin/*` MINTS UNREVOCABLE ARTEFACTS.**

A licence cannot be recalled — verification is offline, so nothing we do afterwards reaches an issued key.
`ADMIN_TOKEN` is **one shared bearer string** with no identity, no per-person revocation, and no audit of
who used it: if it leaks, you cannot tell who minted, and you cannot stop them without rotating a secret
that everyone shares. That is an acceptable floor for a surface that does nothing. **It is not an
acceptable control for a surface that issues permanent grants.**

⚠ **Do not treat this as "we will add Access later."** Later is after the first real key, and the first
real key is the moment the surface stops being harmless. Put Access in front of `/api/admin/*` **before**
the ceremony, so the window where the route is live and unprotected never exists.

### ⭐ The key set, and what it does not buy

Every licence carries a `kid`; the product verifies against a **set** and selects by it. Rotation is: new
key, new `kid`, add its public half to the set, ship, issue under it, later drop the old `kid`.

⛔ **It does not make rotation cheap.** Keys minted under the old `kid` run to their own expiry; the
installed base still has to upgrade; compromise is still undetectable. **It makes rotation possible to
express** — removing the _format_ migration that would otherwise sit on top of the upgrade migration.

---

## Register

Things that bit once and will bite again.

| # | what happened | what it means |
| --- | --- | --- |
| **1** | ⛔ **Concurrent editor, 2026-08-06.** A file written at 10:07 was **gone by 10:08:13**, in the same second unrelated assets appeared; a commit landed on the working branch **between two of the same author's commits**; and tracked files were reformatted underneath an in-progress change. | ⛔ **"It worked when I ran it" stops being evidence under a concurrent editor.** The write succeeding does not mean the file is there now. ⭐ The only reason it was noticed is that the tree was **re-checked** instead of the write being trusted — so re-read state you did not just observe, and commit narrowly (stage your own paths, never `git add -A`) so "is this mine?" stays answerable. |
