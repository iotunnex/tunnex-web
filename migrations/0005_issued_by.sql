-- S12.10: the ledger records WHO signed each key.
--
-- ⛔ `issued_keys` HAS BEEN THE ONLY RECORD OF WHAT LEFT THIS SERVICE, AND IT COULD NOT NAME A PERSON.
-- The signing surface was guarded by ADMIN_TOKEN — one shared string, no identity — so every key in the
-- ledger was minted by "whoever had the token". Under offline verification a key cannot be recalled, which
-- makes "who authorised this" a question that can only ever be answered by a row written at the time.
--
-- ⭐ THE ANSWER NOW COMES FROM A SIGNATURE, NOT A CLAIM: Cloudflare Access's assertion is verified against
-- the team's published keys and the email inside it is what lands here. See src/lib/access.ts.
--
-- ⚠ NULLABLE, AND THAT IS HONEST RATHER THAN LAX. Rows minted before this migration have no attributable
-- actor and never will; a backfilled default would invent one. NULL reads as "minted before the ledger
-- recorded people", and the admin surface says exactly that.
ALTER TABLE issued_keys ADD COLUMN issued_by TEXT;

-- ⛔ AND THE KEYS THAT LEFT BEFORE THIS COLUMN EXISTED ARE MARKED, NOT GUESSED.
--
-- Four keys have been signed under ADMIN_TOKEN — one shared string, no identity — so there is no fact
-- anywhere about who authorised them. Backfilling my email, or the founder's, would be a fabricated
-- attribution in the one table that exists to answer "what did we put into the world, and on whose word".
--
-- > ## ⛔ **A LEDGER THAT INVENTS AN ACTOR IS WORSE THAN ONE THAT ADMITS IT DID NOT KNOW** — the invented
-- > ## row is indistinguishable from a true one, and it is the row somebody will rely on.
--
-- ⚠ `pre-identity` RATHER THAN NULL, deliberately: NULL is also what a future WRITE BUG would leave, and
-- the two would then be indistinguishable. A stated marker says "this key predates identity recording";
-- a NULL after this migration says "something failed to record it", and those need different reactions.
UPDATE issued_keys SET issued_by = 'pre-identity' WHERE issued_by IS NULL;
