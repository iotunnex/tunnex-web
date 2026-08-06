# First-issuance walk — findings register

**One request taken end to end on the live system: request → email verify → queue → review → sign → email.
A real key was issued and arrived intact.** ⭐ **Eight findings. NONE came from the test suite** — see
`docs/laws.md`, _a cross-runtime boundary tested on one side only is untested_.

## ⭐ Edge cases walked — both PASSED

| case                                 | result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate domain, second address** | A different address at `bolster.ai` refused with `domain_used`, and an **email** arrived saying so: _"Someone at bolster.ai already started a Tunnex Enterprise trial, and trials are one per company domain. If you can't find who has it, or the trial ended and you want more time, we'll sort it out."_ ⭐ It states the truth, **does not name who holds the trial** — the information leak correctly avoided — and offers a route for both cases. ⚠ And it is an **email, not only a page**, so it can be forwarded to the colleague who has it |
| **Consumer domain**                  | `gmail.com` refused at request with `consumer_domain`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### ⛔ WHY THE TWO REFUSE AT DIFFERENT STAGES — deliberate, and it will read as an inconsistency

**A consumer domain is public knowledge, so refusing immediately leaks nothing.** Anyone can see that
`gmail.com` is a consumer provider without asking us.

**Which company domain holds a trial is NOT public.** So that refusal waits until the email round-trip has
proved the requester controls the address — otherwise the form becomes an oracle for enumerating which
companies are evaluating Tunnex, one address at a time.

> ⭐ **THE LINE, STATED ONCE: a refusal derivable from PUBLIC information can be immediate and explicit. A
> refusal derived from OUR data must wait for proof of control, and stay generic until it has it.**

---

## Fixed

| #     | finding                                                                                                                                                                 | fix                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | ⛔ **`alg: "Ed25519"` vs `"EdDSA"`** — Node's JWK export is refused by workerd. **Root cause of the whole failure**                                                     | Ceremony emits `EdDSA`; a `/api/admin/signing-selftest` endpoint proves the key imports _before_ a customer is queued; a test runs the README's own generator through workerd |
| **3** | ⛔ `/trial/approved` said _"your key is on its way"_ — **false**, it was queued for a human. ⚠ **Second instance** of the shape already fixed in the key-delivery email | Now: _"your key is being reviewed… issued by a person, usually within one business day"_                                                                                      |
| **4** | ⚠ `ADMIN_TOKEN` travelled in the URL — browser history, `Referer`, and Cloudflare's request logs                                                                        | `?t=` is accepted once, exchanged for an **HttpOnly/Secure/SameSite=Strict cookie**, and redirected away. The page holds no token; the issue route accepts either             |
| **5** | ⚠ `pending_launch` shown to the reviewer — an internal string in a column where a human decides whether to mint something unrevocable                                   | Mapped to what it means: _awaiting a key_ · ⛔ _already has a live key_ · _trial expired_                                                                                     |

## ⭐ Already closed — verified, not assumed

| #     | finding                                                                     | what the code actually does                                                                                                                                                                                                                                                                                         |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8** | ⚠ Outlook's link scanner issued **HEAD** against the single-use verify link | **The hazard does not occur.** `verify.astro` performs zero writes on GET/HEAD — it _peeks_ (a SELECT). The consume is an atomic `UPDATE … WHERE consumed_at IS NULL` reachable **only by POST**. A scanner cannot burn the link ⭐ **and this was designed for, not lucky** — the page carries a comment saying so |

## Registered — not cheap, not done

| #     | finding                                                                                                                   | why it is not a quick fix                                                                                                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2** | ⛔ **The verification email landed in Junk** on corporate Outlook, with links disabled. The licence email reached Focused | **Deliverability is infrastructure, not copy**: SPF/DKIM/DMARC alignment, domain reputation, and Outlook's own heuristics. ⚠ It is the **first** email in the funnel, so it fails where it costs most — a requester who never sees it concludes the product is broken. **Needs its own slice**, with a real inbox-placement test across providers           |
| **6** | ⚠ _"Open tier"_ and _"Community"_ — two names for one tier                                                                | Appears across three blog posts, the FAQ, and an email template. ⛔ **The naming is an S12.1 decision** (the licensing model names the tiers), so renaming now would set a name S12.1 might change. **Register, decide in S12.1, then sweep once**                                                                                                          |
| **7** | ⚠ The **"Talking:" box** — third sighting, still unlocatable                                                              | ⛔ **Not in this repo.** `grep -rn "Talking" src/ public/` returns nothing, across three sightings. It is almost certainly a **browser extension or OS overlay**, not our output. ⚠ Recorded so the fourth sighting does not restart the search — **next step is to reproduce it in a clean profile with extensions disabled**, which settles it either way |

## ⛔ Pre-launch, founder-ruled

**The signing keypair and `ADMIN_TOKEN` are TEST-GRADE and rotate before launch** — this material was
handled during a walk, and **the key set baked into the product (S12.2) must be the rotated key**. See
`README.md` → _PRE-LAUNCH_.
