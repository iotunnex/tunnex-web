# tunnex.io Marketing Site — Master Build Plan (Epic/Story-Driven)

**Repo:** tunnex-site (separate from the product repo — the site is deliberately a separate
trust domain; hosted infra is NEVER in the product's trust path).
**Deploy target:** Cloudflare Workers Paid ($5) plan — Workers + static assets, D1, KV,
cron triggers, Turnstile. Email via Resend. NO other cloud services.
**Model:** this plan defines every story up front. We build ONE story at a time:
implement → test → report → WAIT FOR REVIEW → merge → next. Story numbers match their epic
(E2 → S2.1, S2.2 …) for branch names (`story/S2.1-email-infra`).

---

## Build Protocol (Claude Code MUST follow this on every story)

1. Work only on the CURRENT story, on its own branch `story/SX.Y-short-name`. Do NOT start,
   scaffold, or "prepare" future stories.
2. If a story contains a **DECIDE-BEFORE-CODE** block, present the decisions and STOP for
   approval before writing code.
3. Implement with small, clear commits. Add the story's required tests.
4. At completion, post a **STORY REPORT** in this exact shape, then STOP and wait:
   - **Story:** SX.Y name
   - **Delivered:** what was built (files/endpoints/pages)
   - **Decisions made:** anything chosen during the build, one line each
   - **Test evidence:** test names + pass output; manual verification steps run
   - **Preview:** the Cloudflare preview URL (once S0.2 lands)
   - **Deviations/open items:** anything that differs from this plan or is deferred (ledger it)
5. Merge ONLY after explicit sign-off in that session. After merge, update the Story Status
   line below in this file (one line) as part of the merge.
6. Conventions that apply to EVERY story: TypeScript strict; zod validation on every endpoint
   input; structured JSON logs (never log raw tokens); secrets only via `wrangler secret`
   (`.dev.vars` locally, `.dev.vars.example` committed); no dependency additions beyond the
   approved list without asking.
7. **Design passes (standing rule from S1.3 close, applies to every page story from S1.4
   onward, part of DoD):** before merge, run three review passes on the story's pages —
   ux-copy, design-critique, accessibility-review (design plugin; if unavailable, run as
   three parallel review subagents). One-line findings/fixes per pass in the story report
   (and merge commit if fixes land post-report).

**Approved dependencies:** astro, @astrojs/starlight, @astrojs/cloudflare, tailwind, zod,
hono (optional), resend, psl, a maintained disposable-email-domains list, vitest,
@cloudflare/vitest-pool-workers (or miniflare), playwright, @axe-core/playwright.
(+ approved during S0.1: eslint, typescript-eslint, eslint-plugin-astro, prettier,
prettier-plugin-astro as dev tooling.)

---

## Story Status (re-entry pointer — update on every merge)

Current: **S2.2 merged — next: S2.3 (newsletter double-opt-in; MERGE GATED on the S2.1 test-send)**

---

## Ledger (carry-ins and open items)

- **S0.2:** CI must pin Node from committed `.nvmrc` (Node 22) in every job — no floating
  "latest node". Verify all deps on LATEST STABLE release line; bump laggards; README note
  that renovate/dependabot config is a candidate follow-up. No betas/RCs/canaries.
- **SESSION binding:** RESOLVED in S0.2 (approved; removed from S0.3 scope): sessions
  disabled via `session: { driver: sessionDrivers.null() }` in astro.config.mjs; no
  SESSION binding in the deployed Worker config. Revisit only if the site ever gains a login.
- **Branch protection:** RESOLVED — repo stays private on GitHub Free; merges gated by the
  review protocol (CI green + explicit sign-off), same as the product repo pre-S6.0b.
  Mechanized branch protection — trigger: repo public at beta. Do not enable GitHub Pro.
- **Major-version migrations (from S1.1 onward):** any major dependency migration gets its
  own commit and a visual check of EVERY page in the story report. (The astro 5→7 major
  landed inside S0.2 with only a placeholder page to regress against — accepted once.)
- **TypeScript 7:** npm latest is TS 7.0 (native compiler) but `@astrojs/check` peers at
  `^5||^6` — pinned to TS 6.x; bump when the Astro toolchain supports 7.
- **Renovate/dependabot:** candidate follow-up to automate latest-stable bumps.
- **S1.1 DECIDE-BEFORE-CODE (added):** propose a PROFESSIONAL 3-COLOR THEME for approval
  before building the design system. Exactly three core colors: (a) dark neutral base
  (dark-mode-first background/surface scale derived from it), (b) single strong brand/accent
  for CTAs and key highlights, (c) one supporting neutral for text/borders. Semantic status
  colors allowed on top but not part of the brand palette. Must read as
  security/infrastructure-grade (developer-tool, sovereign, trustworthy — not
  startup-playful), work in BOTH dark and light modes, meet WCAG AA in both. Present as hex
  values + Tailwind theme token mapping + small rendered sample (hero + button + card)
  BEFORE writing the design system. Do not restyle S0.1's placeholder early.
- **Copy principle (standing, from S2.2 sign-off):** brand line on brand surfaces, utility
  copy on utility surfaces — meta/docs descriptions inform, they don't sloganeer.
- **SVG token rule (standing, from S1.1 sign-off):** inline SVGs use semantic tokens only
  (currentColor / var(--color-*)) — never hardcoded fills; token guard catches fill/stroke
  violations in src/.
- **Email routing (S4.4 runbook item):** sales@tunnex.io / security@tunnex.io receive
  NOTHING until Cloudflare Email Routing is configured post-domain-purchase — the launch
  runbook must include that step (waitlist mailto on /download depends on it; a disclosure
  address that bounces is worse than none — security@ is mandatory in that setup).
- **Trial length RECONCILED (2026-07-12): 14 days stands** — the platform repo's
  architecture-licensing.md said 30 and is the stale side (being fixed there). Do not
  change site copy/templates/schema.
- **/trial interim placeholder (until S3.2):** minimal page keeps every trial CTA from
  404ing; S3.2's real request form replaces it on the same route.
- **S4.2 OG image source (brand decision):** the VERTICAL lockup (mark above wordmark) is
  the OG/Twitter-card image source; simplified badge mark is the favicon candidate
  (node network smears below ~24px — verified at 16/24/40px renders).
- **Install-path rules (from platform message):** hero one-liner stays visually but is a
  placeholder until get.tunnex.io resolves (prelaunch caption says "ships with the beta";
  beta caption links verify-first docs + GitHub release fallback). Beta surfaces must show
  BOTH paths (one-liner AND download → SHA256 → inspect → run) plus the prerequisite line
  "any VPS with Docker and a public address."
- **Email Routing consumers (S4.4 runbook additions):** switch the waitlist noscript
  mailto from sales@ to a waitlist@/hello@ alias once Email Routing exists; the S2.4
  SALES_NOTIFY_EMAIL lead notifications also deliver nowhere until Email Routing — ledger,
  don't block.
- **Turnstile production keys (S2.3 merge gate #2):** the always-pass test key must never
  be a deployed default — real sitekey in wrangler.toml [vars], TURNSTILE_SECRET as
  Worker secret via CI; test pair stays local-dev only (.dev.vars).
- **Credentials move by COPY-PASTE only (standing rule, 2026-07-12):** never transcribed
  from images/screenshots — a 0-vs-O sitekey transcription cost a day of Turnstile
  debugging (400020). Click-to-copy in dashboards, pipe into gh secret set.
- **Preview-host Turnstile limitation is STRUCTURAL:** workers.dev is on the Public
  Suffix List, so iotunnex.workers.dev never covers the hash-preview subdomains and they
  cannot be allow-listed. Standing pattern for captcha-touching stories (S2.4, trial
  pages inherit): localhost e2e with the real key pair + production-hostname render
  proof; preview deploys exercise everything except the live challenge.
- **SECURITY — rotate the Turnstile secret after S2.3 merges:** the secret transited
  chat/screenshot during setup. Pawan regenerates in widget settings; then update the
  repo secret + .dev.vars and re-run the secret sync.
- **Mailer transport = Cloudflare Email Service (public beta, decided 2026-07-12):**
  Workers EMAIL binding (no API key — RESEND_API_KEY lifecycle deleted; binding is the
  credential). Docs findings: SUBDOMAIN senders supported → no-reply@mail.tunnex.io
  STANDS; SPF/DKIM/DMARC + cf-bounce MX auto-added AND LOCKED at onboarding (manual
  record list removed from README); bounce handling beyond Cloudflare's processing is
  DIY → minimal hard-bounce handler = follow-up story candidate; daily quota starts
  conservative and scales with reputation (watch for launch-day waitlist sends);
  50 recipients/email, 5 MiB/message. Resend fallback = small transport swap (interface
  kept transport-agnostic).
- **Test-send HARD GATE (S2.1 merged without it):** execute scripts/test-send.mjs the
  moment Resend + mail.tunnex.io DNS land on Pawan's side; S2.3 CANNOT MERGE until the
  test-send evidence exists (its flows send real email).
- **Migrations are append-only** (standing rule from S0.3 merge): 0001 is applied to the
  remote DB — schema changes from here are NEW migration files, never edits to applied ones.
- **Node:** local default Node is 18 (nvm); wrangler 4 needs ≥22. `.nvmrc`=22 committed;
  developer machines should `nvm install 22`.

---

## Locked Decisions (do not re-litigate inside stories)

- **Stack:** Astro + Starlight (docs) + Tailwind, deployed via @astrojs/cloudflare as a
  Worker with static assets. D1 for durable data. KV or the native Rate Limiting binding for
  rate limits (NEVER D1 writes for rate limiting). Turnstile on every public form,
  verified server-side. Resend for outbound email. Cloudflare Web Analytics (cookieless);
  NO Google Analytics, no cookies, no third-party trackers.
- **LAUNCH_MODE flag:** `prelaunch` | `beta`. Prelaunch: downloads show coming-soon +
  waitlist; trial flow ends at "approved — key arrives at beta"; GitHub links hidden/marked.
  Beta: downloads live; trial calls the issuance module. Flipping the flag must be the ONLY
  change needed.
- **Trial rules:** 14 days. ONE trial per company domain, bound to a single verified work
  email. Domain is DERIVED from the email as **eTLD+1 via `psl`** (never split('@')[1],
  never user-typed). Free-provider AND disposable-domain blocklists checked against the
  DERIVED eTLD+1. `UNIQUE(domain)` in D1 is the final race-proof arbiter.
- **Magic links NEVER consume on GET** (corporate mail scanners — SafeLinks/Proofpoint —
  prefetch links). GET renders a confirmation page (read-only, zero writes); an explicit
  POST does the atomic consume. Applies to trial verify AND newsletter confirm.
- **Token discipline (mirrors the product repo):** 32B random, base64url, sha256-hashed at
  rest, single-use (atomic consume); raw token exists only in the emailed link. Expiry is
  TWO-TIER (S2.1 sign-off amendment): security-sensitive links (trial verify) 30 min;
  list-consent links (newsletter confirm) 24 h — S2.3 inherits the 24 h tier.
- **Trial clock starts at KEY ISSUANCE, not approval (locked, S2.1 sign-off):**
  trials.started_at/expires_at are set when the key is issued; prelaunch approvals carry no
  clock ("your 14 days start only when the key is issued" is public copy). S3.4's DoD must
  test this.
- **No enumeration oracles anywhere:** /api/trial/request AND /api/subscribe return identical
  generic responses whether or not the email/domain already exists.
- **Issuance is a STUB.** `Issuer` interface only; PendingLaunchIssuer records intent. NO
  Ed25519, NO private-key handling in this repo until the product's EPIC 12 lands — the real
  issuer is a separate security-reviewed task.
- **Email deliverability:** send from `no-reply@mail.tunnex.io` (dedicated subdomain
  protects root reputation), Reply-To `sales@tunnex.io`; README documents SPF + DKIM +
  **DMARC**. Mailer structured so transactional/marketing identities can split later.
- **Design:** dark-mode-first, clean/technical. Tailscale-grade information architecture,
  NOT a visual clone. Positioning: "Your keys. Your servers. Your network."
- **Payments (Stripe US + Razorpay India), real key issuance, and R2 downloads are PARKED**
  epics with explicit triggers — structure for them, do not build them.

---

## EPIC 0 — Foundation & Deploy Pipeline

- **S0.1 Repo scaffold** — Astro + Starlight + Tailwind + @astrojs/cloudflare adapter,
  TS strict, wrangler.toml (Worker + static assets), `LAUNCH_MODE` config wiring, base
  layout shell (empty nav/footer), `pnpm dev` working locally with wrangler, README skeleton.
  **DoD:** local dev serves a placeholder page through the Worker; typecheck + lint pass;
  README documents local setup. ✅ MERGED
- **S0.2 CI + deploy pipeline** — GitHub Actions: on PR → typecheck + lint + tests +
  **preview deploy** (workers preview URL posted to the PR); on main → production deploy.
  **DoD:** a PR shows a working preview URL; main deploy reaches the production Worker;
  red tests block merge.
- **S0.3 Data + secrets plumbing** — D1 database + migrations tooling (wrangler d1
  migrations), full schema v1 (subscribers, trial_requests, trials, enterprise_leads,
  email_events — as specified in EPIC 3, incl. `UNIQUE(trials.domain)` and an explicit
  index on `trial_requests(token_hash)`), KV namespace (rate limiting), bindings wired,
  `.dev.vars.example`, secrets documented (RESEND_API_KEY, TURNSTILE_SECRET).
  **DoD:** migrations apply cleanly local + remote; a smoke endpoint proves D1 + KV bindings
  respond in preview.

## EPIC 1 — Marketing Pages (static content)

- **S1.1 Design system + layout** — Tailwind theme (colors/typography/spacing), dark-first
  with light toggle, responsive nav + footer (GitHub link per LAUNCH_MODE; contact;
  privacy/terms slots), shared components (buttons, cards, code-snippet block, CTA pair).
  **DECIDE-BEFORE-CODE:** 3-color theme proposal (see Ledger).
  **DoD:** layout renders on all breakpoints; toggle persists; no layout shift.
- **S1.2 Home page** — Hero ("Self-hosted Zero Trust VPN. Your keys. Your servers. Your
  network."), one-command install snippet (display-only: `curl -fsSL https://get.tunnex.io | sh`),
  feature blocks (WireGuard data plane · SSO Google/Microsoft · multi-tenant orgs · desktop
  clients with fail-closed kill-switch · audit logging), hand-rolled SVG architecture diagram
  (customer control plane / gateways / clients, callout: Tunnex-hosted infra is NEVER in the
  path), CTA pair per LAUNCH_MODE. **DoD:** renders in both modes; diagram accessible
  (title/desc); copy reviewed in the report.
- **S1.3 Pricing page** — Open (free, self-hosted, unlimited devices, single org, local auth,
  WG, desktop+CLI) vs Enterprise (+ SSO, Zero Trust policies, multi-org, K8s operator,
  support). Enterprise CTAs: "Start 14-day free trial" → /trial · "Contact sales" →
  /enterprise. A clearly-marked structural slot where checkout lands later (EPIC 7).
  **DoD:** both tiers accurate to the product's open-core split; CTAs route.
- **S1.4 Download page** — per-OS cards (macOS .pkg, Windows .exe, CLI). Prelaunch: coming
  soon + waitlist CTA. Beta structure (built now, shown later): env-configured
  DOWNLOAD_BASE_URL links + SHA256SUMS link + a well-written unsigned-install section
  (macOS Gatekeeper right-click-Open / xattr; Windows SmartScreen "More info → Run anyway";
  note that signed builds come at GA). **DoD:** both modes render; instructions technically
  accurate.
- **S1.5 Security page** — the trust-domain boundary (hosted infra holds billing/license
  data ONLY; VPN traffic/keys/configs/user data never leave the customer), offline license
  verification posture, fail-closed kill-switch design, responsible-disclosure contact
  (security@tunnex.io). **DoD:** claims match the product architecture doc; no overclaiming
  (e.g. Windows kill-switch persistence is in progress — say "designed fail-closed", not
  platform-specific promises).
- **S1.6 Docs skeleton (Starlight)** — structure only, stub content OK: Quickstart
  (two-question install placeholder), Architecture, Desktop client, CLI, SSO setup.
  Search working. **DoD:** sidebar/navigation/search functional; stubs marked as such.

## EPIC 2 — Forms & Email Infrastructure

- **S2.1 Email infrastructure** — Resend integration on `mail.tunnex.io`; typed mailer
  module (send(kind, to, data)); ALL templates as simple HTML + plaintext pairs:
  magic-link verify · trial-already-exists (contact-sales link) · trial-approved
  (prelaunch wording) · welcome/key-delivery (beta wording, key placeholder) · d10 reminder ·
  expired+upgrade · d21 follow-up · newsletter double-opt-in · enterprise-lead notification.
  README: exact SPF/DKIM/DMARC records for mail.tunnex.io. **DoD:** every template renders
  (snapshot tests); a real test-send verified in the report; DNS records documented.
- **S2.2 Turnstile + rate-limit middleware** — shared middleware: server-side Turnstile
  verification for every form POST; rate limiting via the native binding or KV counter keyed
  on `CF-Connecting-IP` (NEVER D1). Starting limits: 5/min/IP form POSTs, 20/min verify
  POSTs. Uniform JSON error shape; no stack traces to clients. **DoD:** unit tests for both
  middlewares (invalid Turnstile refused; limit trips at N+1; D1 is provably untouched by
  the limiter).
- **S2.3 Newsletter (double opt-in)** — POST /api/subscribe (Turnstile, generic
  no-enumeration response, upsert, confirm email) → GET confirm PAGE (zero writes) →
  POST confirm (atomic consume, sets confirmed_at). **DoD:** tests: prefetch GET/HEAD do
  NOT consume; double-POST race safe; identical response for new vs existing email.
- **S2.4 Enterprise lead form** — /enterprise page + POST /api/enterprise-lead (name, work
  email, company, seats, message; Turnstile) → D1 insert → Resend notification to
  SALES_NOTIFY_EMAIL → thank-you page. **DoD:** e2e test through the form; notification
  received (evidence in report).

## EPIC 3 — Trial Pipeline (the core backend work)

- **S3.1 Domain derivation + blocklists** — `deriveTrialDomain(email)`: eTLD+1 via `psl`;
  refuse hosts with no registrable domain; free-provider blocklist (gmail, googlemail,
  outlook, hotmail, live, yahoo, icloud, proton*, aol, gmx, yandex, zoho, mail.com, …) +
  maintained disposable-domain list, BOTH checked against the derived eTLD+1. README notes
  the disposable list is inherently incomplete (accepted gap). **DoD:** unit tests —
  subdomain collapses to parent (a@eng.acme.com → acme.com); co.uk-style handled; blocklist
  matches on derived domain; garbage hosts refused.
- **S3.2 Trial request endpoint** — POST /api/trial/request: Turnstile → normalize →
  derive domain → blocklist check → SAME generic response in all cases ("If your domain is
  eligible, a verification link is on its way"). Internally: domain already in `trials` →
  send the trial-already-exists email instead of a magic link; otherwise mint token (32B,
  sha256-hashed at rest, 30-min expiry) + send magic link. /trial page with the form.
  **DoD:** tests — generic response identical across new/duplicate/blocked; token stored
  hashed only; duplicate-domain path sends the right email.
- **S3.3 Trial verification (scanner-proof)** — GET /trial/verify?token= → confirmation
  PAGE ("Confirm your 14-day trial for acme.com" + button; read-only validity peek allowed,
  ZERO writes) → POST /api/trial/verify → atomic consume (UPDATE … WHERE consumed_at IS
  NULL) → INSERT INTO trials relying on UNIQUE(domain) as the race arbiter (conflict →
  friendly "trial already exists" page). Success page per LAUNCH_MODE. **DoD (the heavy
  test story):** prefetch GET + HEAD do not consume; expired token; double-POST
  consume race; concurrent-verify UNIQUE(domain) conflict handled; happy path e2e
  request→email→page→POST→trials row.
- **S3.4 Issuance stub + wiring** — `src/lib/issuance.ts`: `LicenseClaims`
  {domain, tier:'trial'|'enterprise', seats, issued_at, expires_at, license_id} + `Issuer`
  interface + `PendingLaunchIssuer` (records intent / no-ops). Verify-success path calls
  through the interface; prelaunch → trials.status='pending_launch' + approved email;
  beta path structured (status='active', started_at/expires_at set, key-delivery email with
  placeholder) but gated by LAUNCH_MODE. **NO Ed25519, NO private keys.** **DoD:** swap
  point is one line; both mode paths unit-tested; grep proves no crypto/key material.
- **S3.5 Lifecycle cron + housekeeping** — daily cron: for status='active' trials (beta
  only): day 10 reminder; expiry → status='expired' + upgrade email; day 21 follow-up.
  `email_events UNIQUE(trial_id, kind)` guarantees a rerun never double-sends.
  Housekeeping (both modes): prune consumed/expired trial_requests + stale unconfirmed
  subscriber tokens. **DoD:** time-travel tests for each transition; rerun idempotence
  proven; prune verified.

## EPIC 4 — Quality, SEO & Launch

- **S4.1 Accessibility + performance pass** — axe (@axe-core/playwright) green on every
  public page; Lighthouse ≥95 on / and /pricing; keyboard-navigable forms; visible focus.
  **DoD:** CI runs axe; Lighthouse evidence in report.
- **S4.2 SEO + meta** — titles/descriptions per page, OpenGraph + Twitter cards (generated
  OG image), sitemap.xml, robots.txt, canonical URLs, JSON-LD (Organization + Product).
  **DoD:** validators pass; sitemap serves.
- **S4.3 Legal + analytics** — privacy policy + terms as honest placeholders clearly marked
  "pending legal review" (do NOT fabricate legalese); Cloudflare Web Analytics snippet;
  footer links wired. **DoD:** pages exist, marked, linked.
- **S4.4 Launch checklist + go-live** — README runbook: DNS records (site, mail.tunnex.io
  SPF/DKIM/DMARC), Turnstile prod keys, Resend domain verification, secrets set, D1 prod
  migration, cron enabled, LAUNCH_MODE=prelaunch confirmed, smoke script (submit each form
  against prod, verify emails). **DoD:** runbook executed against production; all smoke
  checks pass; site is LIVE in prelaunch mode.

---

## PARKED EPICS (structure now, build on trigger — do NOT start early)

- **EPIC 5 — Downloads & install script.** Trigger: product beta (repo public, S6.6 done).
  R2 bucket at dl.tunnex.io fed by the product repo's release CI; `get.tunnex.io` Worker
  route as a THIN REDIRECT/PROXY to the PLATFORM repo's released install.sh — one script,
  one source of truth; NEVER hand-written or forked in this repo; flip LAUNCH_MODE=beta;
  waitlist announcement send.
- **EPIC 6 — Real license issuance.** Trigger: product EPIC 12 (S12.1/S12.2) exists.
  Ed25519 signing (WebCrypto) behind the Issuer interface, private key in a Worker
  secret/KMS — SECURITY-REVIEWED story, decide-before-code mandatory. Beta trial path goes
  live end-to-end; trial keys carry 14-day expiry; upgrade = key replacement via the
  product's POST /admin/license.
- **EPIC 7 — Payments.** Trigger: product S12.5. Stripe (US) + Razorpay (India) checkout
  filling the pricing-page slot; purchase → issuance → key email.

---

## Recommended Build Order

EPIC 0 → 1 → 2 → 3 → 4 (launch, prelaunch mode) → parked epics on their triggers.
