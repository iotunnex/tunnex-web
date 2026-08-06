# Minting the first real licence — a script to follow

**One request, one key, by hand.** Follow the steps in order. Each says what you should see; if you see
something else, stop there rather than continuing — the point of a first walk is to find out where it
breaks, and continuing past a surprise loses that.

⚠ **Nobody has done this before.** The email has never been read, the admin screen has never been used, and
the key has never been pasted anywhere. §7 says which failures are predictable and which are not.

---

## 0. Before you start — three preconditions

|                              | how to check                                                                                                               | if it fails                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Access covers `/api/admin/*` | incognito → `https://tunnex.io/api/admin/queue`                                                                            | you get the page without an Access prompt → **stop**, the signer is exposed |
| Signing secrets set          | `wrangler secret list`                                                                                                     | missing → run the ceremony in `README.md`                                   |
| **Migration 0003 applied**   | `wrangler d1 execute tunnex-site-db --remote --command "SELECT name FROM sqlite_master WHERE name='licence_review_queue'"` | empty → §1                                                                  |

## 1. ⛔ Migration 0003 — merge the branch. Do not apply it by hand.

`licence_review_queue` and `issued_keys` do not exist in production yet.

> ## ⭐ **RECOMMENDED: merge `licensing/manual-issuance-gate` into `main`.**
>
> `deploy.yml` applies migrations on push to `main`, so the merge does it — **and the code that uses those
> tables ships in the same act.** That is the property worth having: schema and its readers arrive together.

⛔ **Applying 0003 by hand and leaving the branch unmerged puts production one state ahead of its code** —
tables exist that nothing reads, `wrangler d1 migrations list` disagrees with what is deployed, and the next
person cannot tell whether that drift is deliberate. **If you do it anyway, merge the same day.**

## 2. Switch to beta

`LAUNCH_MODE` is a **var, not a secret** — it lives in `wrangler.toml`:

```toml
[vars]
LAUNCH_MODE = "beta"     # was "prelaunch"
```

Commit and deploy. ⚠ **In `prelaunch` the seam defers to LAUNCH, not to REVIEW** — a verified trial parks
with no key and never reaches the queue. **Nothing in the walk below works until this is `beta`.**

**You should see:** `wrangler deployments list` showing a new deployment.

## 3. Submit the request

Go to `https://tunnex.io/trial` and submit with **a real work email you can read**. Not a `gmail.com`
address — consumer domains are refused, deliberately.

**You should see:** a "check your email" confirmation.
**Then:** an email arriving within a minute or two.

## 4. Verify the email

Click the link.

**You should see:** the trial-verify page confirming your trial is approved.
⭐ **What you should NOT see: a licence key.** Verification approves; it does not mint. If a key appears
here, the wrong issuer is wired and you should stop.

**Behind the scenes:** a `trials` row at `status='pending_launch'` with a **null clock**, and a row in
`licence_review_queue`.

```sh
wrangler d1 execute tunnex-site-db --remote \
  --command "SELECT trial_domain, tier, license_id FROM licence_review_queue WHERE decided_at IS NULL"
```

**You should see:** exactly one row, your domain.

## 5. Open the queue

`https://tunnex.io/api/admin/queue?t=<ADMIN_TOKEN>` — Access will prompt first.

**You should see:** your domain, the band, the term in days, the trial status, and **"Prior key: none"**.

⚠ **Read the "Prior key" column every time.** It is the only thing that can tell you a domain already has a
key, and a second key is a second artefact that cannot be recalled.

## 6. Sign it

Click **Sign & email**. Confirm the dialog — it says the key cannot be revoked, and that is literally true.

**You should see** one of:

| response                             | meaning                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `issued and emailed to you@acme.com` | ⭐ done — go to §7                                                                                                                          |
| `self_verify_failed`                 | `SIGNING_PUBLIC_JWK` is not the public half of `SIGNING_KEY_JWK`. **Nothing was issued.** Re-run the ceremony, setting both halves together |
| `ISSUED, BUT NOT EMAILED (…)`        | the key exists and is in the ledger; the mail failed. **Copy the key from the response** and send it yourself                               |
| ⛔ `MINTED BUT NOT RECORDED (…)`     | a live key exists and is NOT in the ledger. **Copy it from the response immediately** — it is the only record. Then reconcile by hand       |
| `not_pending`                        | already decided. A second click cannot mint a second key, by design                                                                         |

## 7. Check the key arrived, and read the email properly

**You should see** an email containing a key starting `tnxl_`.

⛔ **Read the whole email as a stranger would.** Nobody has ever read it: check the subject line, that the
expiry date is right, that the domain is right, that the instructions make sense, and that nothing says
"placeholder".

## 8. Confirm the ledger

```sh
wrangler d1 execute tunnex-site-db --remote \
  --command "SELECT domain, band, kid, emailed_at FROM issued_keys"
```

**You should see:** one row, with a non-null `emailed_at` and `kid` matching your `SIGNING_KID`.

And the trial's clock has started:

```sh
wrangler d1 execute tunnex-site-db --remote \
  --command "SELECT domain, status, started_at, expires_at FROM trials"
```

**You should see:** `status='active'` with `started_at` ≈ now — **the clock starts at issuance**, which is
the public promise.

---

## ⛔ 9. What the key does NOT do yet

**Nothing.** There is no product build that verifies a `tnxl_` key — S12.1 ships the verifier's _use_, and
no released binary carries the key set. **The customer has nothing to paste it into.**

The Go verifier exists and the format is proven across both repos by the golden vector, so the key is
**correct**. It is just not yet **useful**. Say that to whoever receives it.

---

## 7b. ⛔ What will break first — one of these is not a prediction

### ⛔ THE EMAIL SAYS SOMETHING THAT IS NOT TRUE. Read this before you send one.

`templates.ts:113` renders, verbatim:

> _"Paste it into your control plane — **no reinstall, features unlock in place**."_
> Preheader: _"…paste it into your control plane to **unlock features**."_

**Nothing unlocks.** No released binary verifies a `tnxl_` key, and there is no paste surface in the product
(S12.1/S12.3). ⚠ **A recipient who follows those instructions will look for something that does not exist,
and conclude the key is broken.** It is not — it is correct and not yet useful (§9).

⭐ **This was found by reading the template, not by guessing** — which is why it is first. Before the first
send, either soften that copy or tell the recipient in person what the key is for.

### Predictable, in order of suspicion

1. **The key wrapping in the plain-text part.** The HTML half puts the key in a `<pre>` with
   `overflow-x:auto`, so it should survive. **The `text:` half emits the ~300-character key as a bare
   line** with no wrapping strategy — some transports fold long lines, and a folded key is a broken key when
   pasted. **Read the plain-text alternative, not just the HTML.**
2. **`LAUNCH_MODE` still `prelaunch`** — the most likely reason nothing reaches the queue at all.
3. **Access challenging the button's `fetch`.** The queue page calls `/api/admin/issue` with a bearer
   token; if Access challenges that XHR instead of passing it, the button fails with an unhelpful message.
4. **The remote D1 migration apply.** `0002` carries a hotfix note about wrangler creating a table and then
   failing before recording the migration — the same could happen to `0003`.

### ⚠ NOT a risk, checked rather than assumed

**The `licenseKey` template variable.** I listed this as a suspect and then read the code:
`templates.ts:19` types the payload, so a name mismatch between the admin route and the template is a
**compile error**, not a silent empty space. Removed from the list rather than left in — a suspect list
padded with things already proven safe is one nobody finishes reading.

### Not predictable from here

- **Whether the email renders legibly.** The layout has never been seen with real key content.
- **Whether Access's session carries** from the page load to the subsequent `fetch`.
- **Anything about the admin screen's usability.** It has never been used by anyone.

⭐ **The failure I would most like to be wrong about is the copy**, because everything on our side reports
success and the damage happens in the customer's head.
