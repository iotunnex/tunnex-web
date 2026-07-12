# Launch runbook — tunnex.io go-live (prelaunch mode)

**Goal:** take the site live on the real domain `tunnex.io` in **prelaunch** mode — waitlist and trial-request open, beta not yet shipped. `LAUNCH_MODE` stays `prelaunch`.

**What this is NOT:** this is not the beta flip. `LAUNCH_MODE=beta`, the `get.tunnex.io` installer, real license issuance, and the promotion-failure recovery tool all belong to EPIC 5/6 when the product beta ships — see [Explicitly deferred](#explicitly-deferred) at the end. Do not touch them here.

**Rule:** run in order. Each Claude Code step is a commit + merge + deploy (deploy happens automatically on merge to `main` via `deploy.yml`). Pawan's dashboard steps are done by hand. The final section is joint verification against production. **Nothing here runs until Pawan approves this runbook and confirms he is at a keyboard.**

---

## Pre-flight (confirm already-done — do NOT redo)

These landed during earlier stories; the runbook only verifies them.

- [ ] **D1 prod migrations** apply automatically in `deploy.yml` (`wrangler d1 migrations apply tunnex-site-db --remote`) before every deploy — `0001` and `0002` are already applied on the remote DB.
- [ ] **Lifecycle cron** (`17 3 * * *`) ships in `wrangler.toml [triggers]` — live after any deploy.
- [ ] **Turnstile prod keys**: real sitekey in `wrangler.toml [vars]`; `TURNSTILE_SECRET` set as a Worker secret and rotated. Test pair is local-only.
- [ ] **Mail**: `mail.tunnex.io` SPF/DKIM/DMARC + cf-bounce MX were auto-added and locked at Cloudflare Email Service onboarding. Inbound (`support@`/`sales@`/`security@`) is Spacemail, live and tested.
- [ ] **SALES_NOTIFY_EMAIL** = `sales@tunnex.io` (deliverable, S2.4-verified in production).

---

## Phase A — Claude Code steps (code + deploy)

Each is a PR; merge in sequence. All are reversible by revert.

### A1. Attach the custom domain in `wrangler.toml`

Add the apex as a custom domain so `wrangler deploy` provisions it (auto-creates the proxied DNS record):

```toml
[[routes]]
pattern = "tunnex.io"
custom_domain = true
```

### A2. Disable the stable `workers.dev` production alias

So there is exactly one canonical production origin (SEO consolidates on the apex; canonical/OG already point there). Version-preview URLs (`<hash>-tunnex-site.iotunnex.workers.dev` from `wrangler versions upload`) are unaffected — PR previews keep working.

```toml
workers_dev = false
```

_(Proposed decision for item 7's "workers.dev behavior": **disable**, don't redirect. A disabled route returns nothing to index; a redirect keeps a live duplicate origin. Disabling is cleaner. Flag if you'd rather keep it.)_

### A3. Point outbound email links at the real domain

`EMAIL_LINK_BASE_URL` currently defaults to the workers.dev host. Set it explicitly in `wrangler.toml [vars]` (runtime — the Worker sends the mail):

```toml
EMAIL_LINK_BASE_URL = "https://tunnex.io"
```

This fixes magic links (trial verify, subscribe confirm) **and** the logo/asset URLs inside emails.

### A4. Flip the three blog posts live

In `src/content/blog/`, for `introducing-tunnex.md`, `why-offline-license-keys.md`, `fail-closed-receipts.md`:

- `draft: true` → `draft: false`
- `pubDate:` → the actual cutover date (all three **same day** — post 1 links post 3 with "starting today")
- `introducing-tunnex.md` byline → `author: 'Pawan Gupta'` (posts 2 and 3 stay `'Tunnex Team'`)

Build regenerates their OG cards and adds them to the listing/RSS/sitemap. (The four post-2 drift trims are founder-reversible if you change your mind — see the S3B.3 ledger.)

### A5. Stamp the legal documents

`src/pages/privacy.astro` and `src/pages/terms.astro`: `LAST_UPDATED` → the cutover date on both.

### A6. (After Pawan supplies the analytics token — see B3) set it

`wrangler.toml [vars]`:

```toml
PUBLIC_CF_ANALYTICS_TOKEN = "<token from Pawan>"
```

Empty until now → no beacon shipped. Setting it turns on Cloudflare Web Analytics (cookieless; the "no consent banner" claim on `/privacy` already holds).

---

## Phase B — Pawan dashboard / DNS steps

### B1. Confirm the apex custom domain provisioned

After A1 deploys, check the Worker's **Custom Domains** — `tunnex.io` should show active with an auto-created, proxied DNS record and an issued edge cert. (No manual DNS row needed; Cloudflare creates it.)

### B2. Add the `www` → apex redirect

Create a **Redirect Rule** (Rules → Redirect Rules): `www.tunnex.io/*` → `https://tunnex.io/$1`, **301**. (Also add a proxied `www` DNS record if one doesn't exist, so the hostname resolves for the rule to act on.)

### B3. Create the Web Analytics site + supply the token

Cloudflare dashboard → Web Analytics → add `tunnex.io` → copy the beacon **token** → hand it to Claude Code for step A6. **(Founder step — the token is yours to create.)**

### B4. Add the root `_dmarc` record

Spacemail sends from the root domain, and the root currently has **no `_dmarc`** record (only `mail.tunnex.io` has its DKIM/DMARC from Email Service). Add a root DMARC TXT — start monitoring-only:

```
_dmarc.tunnex.io  TXT  "v=DMARC1; p=none; rua=mailto:support@tunnex.io"
```

_(Ledgered gap. `p=none` first so nothing legitimate is rejected while you watch the reports; tighten later.)_

### B5. Verify Turnstile hostname coverage

In the Turnstile widget config, confirm the allowed hostnames include `tunnex.io` (and `www.tunnex.io` if you want the redirect source covered). The prod sitekey should already cover the apex — this is a confirm, not a change.

---

## Phase C — Joint verification (production, on tunnex.io)

Run after A + B complete. Claude Code drives the curl/scan checks; Pawan does the human-captcha submits.

### C1. Serving + routing

- [ ] `https://tunnex.io/` → 200 (apex serves the Worker)
- [ ] `https://www.tunnex.io/` → 301 → `https://tunnex.io/`
- [ ] `https://tunnex-site.iotunnex.workers.dev/` → no longer serving (A2)
- [ ] `/sitemap-index.xml`, `/robots.txt` serve on the apex; robots points at `https://tunnex.io/sitemap-index.xml`
- [ ] `<link rel="canonical">` on a few pages shows `https://tunnex.io/...`
- [ ] SSR routes under navigation headers: `/enterprise/`, `/trial/`, `/trial/verify?token=x`, `/subscribe/confirm?token=x` → 200 (the `run_worker_first` + navigation-header pattern, now on the real host)

### C2. Blog live

- [ ] `/blog/` lists all three posts; each post page renders; `/blog/rss.xml` includes them with **absolute** `tunnex.io` links
- [ ] Post 1 shows the "Pawan Gupta" byline

### C3. Forms — one real submit each (Pawan, real captcha)

- [ ] **Waitlist** (`/download`) → confirmation email arrives → confirm link is a `tunnex.io` URL → lands on `/subscribe/confirmed`
- [ ] **Trial request** (`/trial`) → verification email arrives → link is `tunnex.io` → GET page → confirm → `/trial/approved`; `trial-approved` email arrives (prelaunch: key-at-beta wording)
- [ ] **Enterprise** (`/enterprise`) → thanks page → `sales@tunnex.io` inbox gets the lead
- [ ] Confirm every email link emits `tunnex.io`, not workers.dev (validates A3)

### C4. External validators (closes the validator-honesty ledger)

- [ ] OG card: Facebook Sharing Debugger / opengraph.xyz on a post URL and the homepage
- [ ] Twitter/X Card Validator on the same
- [ ] Google Rich Results Test: Organization + Product (homepage), Article (a post)
- [ ] Analytics: after A6, confirm the dashboard registers a pageview

### C5. Final

- [ ] `LAUNCH_MODE` still `prelaunch` (site is live, beta not yet)
- [ ] axe + Lighthouse still green on the production origin (spot-check `/` and `/pricing`)

---

## Explicitly deferred (NOT part of this go-live)

- **`LAUNCH_MODE=beta`** — EPIC 5 trigger, when the product beta ships. Flipping it is its own runbook (build-time for pages + runtime-env for the cron; see the BETA-FLIP ledger note).
- **`get.tunnex.io` installer** — the homepage keeps the prelaunch placeholder caption; the one-liner goes live at beta.
- **Promotion-failure recovery tool** — required before the beta flip, not before this launch.
- **Real license issuance (Ed25519)** — EPIC 6.
- **/security color-only link → underline convergence** — non-blocking polish, any time.

---

## Rollback

Every Phase A change is a revert-and-deploy. The domain attach (A1/B1) is the only step with propagation lag; detaching the custom domain in the dashboard reverts routing. Nothing here migrates or destroys data — the prod D1 is untouched by launch (only read/written by live traffic).
