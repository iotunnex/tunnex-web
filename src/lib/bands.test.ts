import { describe, expect, it } from 'vitest';
import { BANDS } from './licence.ts';

/**
 * ⛔ THE CROSS-REPO BAND GUARD — this repo's half. Its ABSENCE is how `gw: 20` reached a customer's inbox
 * on a trial key.
 *
 * Two sources hold one set of numbers: `BANDS` here (what this issuer MINTS) and `gatewayCeiling` in
 * `apps/api/internal/licence/entitlements.go` (what the product ENFORCES). Two repos, two languages, and
 * until now nothing compared them — so the Go side could be corrected to `trial: 2` while this Worker kept
 * minting 20, with both suites green. That is exactly what happened, and a real key was issued under it.
 *
 * ⚠ THE GOLDEN VECTOR DOES NOT COVER THIS AND CANNOT. It proves both sides agree on the wire FORMAT. It is
 * a single *scale* key, so it never exercises the trial band, and it would be equally green with every
 * number wrong.
 *
 * > ⛔ **A FORMAT GUARD IS NOT A VALUE GUARD. AGREEING ON WHERE THE NUMBER GOES SAYS NOTHING ABOUT THE
 * > NUMBER.**
 *
 * ⭐ HAND-MAINTAINED IN BOTH REPOS, exactly like the golden vector and for the same reason: the twin must
 * be able to DISAGREE. Derive either side from the other and they agree by construction while looking like
 * rigour. The pain of editing two files is the mechanism.
 *
 *   apps/api/internal/licence/band_agreement_test.go  ← the twin. Change one, change both.
 */
describe('the bands agree with the product', () => {
  // ⛔ TRANSCRIBED BY HAND from apps/api/internal/licence/entitlements.go `gatewayCeiling`.
  // NEVER generated, never fetched, never imported.
  const productEnforces: Record<string, number | null> = {
    trial: 2,
    starter: 5,
    growth: 20,
    scale: null, // unlimited — `nil` in Go, and never a sentinel
  };

  it('mints exactly what the product enforces', () => {
    for (const [band, enforced] of Object.entries(productEnforces)) {
      expect(
        BANDS[band as keyof typeof BANDS]?.gateways,
        `⛔ BAND "${band}" DISAGREES. A key already in a customer's hands attests THIS repo's number — ` +
          `\`gw\` is resolved at mint and cannot be recalled. Whichever side is wrong, one of them is ` +
          `lying to a paying customer. Fix BOTH files by hand: src/lib/licence.ts BANDS and ` +
          `apps/api/internal/licence/entitlements.go gatewayCeiling.`,
      ).toBe(enforced);
    }
  });

  // ⛔ SET EQUALITY THE OTHER WAY: a band this issuer can mint that the product does not know would read
  // as Community in every deployment — a customer paying for a tier the product cannot see.
  it('mints no band the product does not know', () => {
    expect(Object.keys(BANDS).sort()).toEqual(Object.keys(productEnforces).sort());
  });

  // ⚠ Community is deliberately NOT a band: it holds no key at all, so it can never be minted.
  it('has no community band', () => {
    expect(Object.keys(BANDS)).not.toContain('community');
  });
});
