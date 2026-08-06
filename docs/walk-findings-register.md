# First-issuance walk — findings register

**One request taken end to end on the live system: request → email verify → queue → review → sign → email.
A real key was issued and arrived intact.** ⭐ **Eight findings. NONE came from the test suite** — see
`docs/laws.md`, _a cross-runtime boundary tested on one side only is untested_.

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
