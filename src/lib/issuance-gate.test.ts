import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pendingLaunchIssuer, placeholderKeyIssuer } from './issuance.ts';

/**
 * ⛔ NO UNATTENDED PATH MAY MINT A LICENCE.
 *
 * Issuance is MANUAL by founder ruling: Tunnex verifies licences OFFLINE, so there is NO REVOCATION. A key
 * that is minted is alive until its expiry and nothing afterwards reaches it, which makes an automated mint
 * a mistake that cannot be taken back.
 *
 * ⚠ AND THERE ARE TWO CALLERS OF `onTrialApproved`, WHICH IS WHY THIS IS A GUARD AND NOT A CODE REVIEW:
 *
 *   1. src/pages/api/trial/verify.ts — a person clicked a verification link
 *   2. src/worker.ts, feeding lifecycle.ts's promote leg — ⛔ THE DAILY CRON, 03:17 UTC, UNATTENDED,
 *      IN A LOOP OVER EVERY PARKED TRIAL
 *
 * The second is the dangerous one and it is the one nobody would think to check, because the comment that
 * used to invite a signer swap was in the FIRST file. A guard on one call site would have proved nothing
 * about the other.
 */
describe('the unattended paths cannot mint', () => {
  // ⛔ HARVESTED FROM SOURCE, NOT HARDCODED. A hardcoded list silently stops covering an issuer someone
  // adds — the failure mode where a census keeps reporting "all clear" about a shrinking subject.
  const issuanceSrc = readFileSync(join(import.meta.dirname, 'issuance.ts'), 'utf8');
  const exported: string[] = [...issuanceSrc.matchAll(/export function (\w*[Ii]ssuer\w*)\s*\(/g)]
    .map((m) => m[1])
    .filter((n): n is string => typeof n === 'string');

  /**
   * Every issuer factory, dispositioned. NON-MINTING means: it cannot return a usable licence key, so
   * wiring it into an unattended path is safe.
   */
  const NON_MINTING: Record<string, string> = {
    pendingLaunchIssuer: 'defers — returns issued:false, parks the trial with no clock',
    placeholderKeyIssuer: 'emits an obviously-non-functional placeholder, never a signed key',
    reviewQueueIssuer:
      'records the claims for a human and returns issued:false — it has no signing key and no mint path. ' +
      'THIS IS THE MANUAL-ISSUANCE GATE ITSELF: it is what makes the 03:17 cron safe by construction.',
  };

  it('every issuer factory in issuance.ts is dispositioned', () => {
    expect(exported.length).toBeGreaterThan(0); // the harvest itself works
    const undispositioned = exported.filter((n) => !(n in NON_MINTING));
    expect(
      undispositioned,
      `⛔ An issuer factory exists with no ruling on whether it may run unattended. If it MINTS, it must ` +
        `never be wired into verify.ts or worker.ts — a human signs from the review queue. If it cannot ` +
        `mint, add it to NON_MINTING with the reason.`,
    ).toEqual([]);
  });

  // ⛔ THE ACTUAL GUARD. Both glue files may reference ONLY non-minting issuers.
  for (const glue of ['../pages/api/trial/verify.ts', '../worker.ts']) {
    it(`${glue} wires only non-minting issuers`, () => {
      const src = readFileSync(join(import.meta.dirname, glue), 'utf8');
      const code = src
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
        .join('\n');
      const used = exported.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(code));
      expect(
        used.length,
        'the glue must construct an issuer, or this test is checking nothing',
      ).toBeGreaterThan(0);
      for (const name of used) {
        expect(
          NON_MINTING[name],
          `⛔ ${glue} constructs ${name}(), which is not dispositioned as non-minting. An unattended path ` +
            `must not mint: offline verification means no revocation, so the mistake is permanent.`,
        ).toBeTruthy();
      }
    });
  }

  // ⚠ AND THE BEHAVIOURAL HALF, because "the name is on a safe list" is a claim about a name. These assert
  // what the two wired issuers actually DO — a future edit that made pendingLaunchIssuer return a real key
  // would keep its name and pass every test above.
  const claims = {
    domain: 'acme.com',
    tier: 'trial' as const,
    seats: null,
    issued_at: 1_700_000_000,
    expires_at: 1_700_086_400,
    license_id: 'lic-1',
  };

  it('pendingLaunchIssuer does not issue', async () => {
    expect(await pendingLaunchIssuer().issue(claims)).toEqual({
      issued: false,
      reason: 'pending_launch',
    });
  });

  it('placeholderKeyIssuer emits an obviously-non-functional key, never a signed one', async () => {
    const r = await placeholderKeyIssuer().issue(claims);
    expect(r.issued).toBe(true);
    // It must be recognisable as fake on sight — the point is that a customer or an operator seeing it
    // cannot mistake it for a licence.
    expect(r.issued && r.licenseKey).toContain('PLACEHOLDER');
    // ⛔ And it must NOT look like the real wire format (tnxl_<payload>.<sig>), or a placeholder could be
    // pasted into a console and produce a confusing failure rather than an obvious one.
    expect(r.issued && r.licenseKey.startsWith('tnxl_')).toBe(false);
  });
});
