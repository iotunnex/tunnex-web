import { describe, expect, it } from 'vitest';
import { verifyAccess } from './access.ts';

/**
 * ⛔ THE SHAPE THIS FILE EXISTS FOR: a header is not an identity.
 *
 * `Cf-Access-Jwt-Assertion` is trustworthy only because something upstream sets it — the `middleware.RealIP`
 * shape, where the reader cannot tell whether the upstream was there. Every case below is a caller SETTING
 * THE HEADER THEMSELVES, and every one must be refused.
 */

const ENV = { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' };

const req = (headers: Record<string, string> = {}) =>
  new Request('https://tunnex.io/api/admin/queue', { headers });

const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('Cloudflare Access assertions are verified, never trusted', () => {
  it('⛔ refuses a self-asserted token with a valid-looking payload', async () => {
    // The whole attack in one line: an attacker who knows the claim names writes them.
    const forged = `${b64({ alg: 'RS256', kid: 'whatever' })}.${b64({
      email: 'attacker@evil.test',
      iss: 'https://team.cloudflareaccess.com',
      aud: 'aud-tag',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.bm90LWEtc2lnbmF0dXJl`;
    const r = await verifyAccess(req({ 'cf-access-jwt-assertion': forged }), ENV);
    expect(r.ok).toBe(false);
  });

  it('⛔ refuses the `alg: none` token — the classic JWT confusion', async () => {
    const none = `${b64({ alg: 'none' })}.${b64({ email: 'attacker@evil.test' })}.`;
    const r = await verifyAccess(req({ 'cf-access-jwt-assertion': none }), ENV);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(401);
  });

  it('refuses a request with no assertion at all', async () => {
    const r = await verifyAccess(req(), ENV);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/no cloudflare access assertion/i);
  });

  it('refuses a malformed assertion without throwing', async () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '...']) {
      const r = await verifyAccess(req({ 'cf-access-jwt-assertion': bad }), ENV);
      expect(r.ok, bad).toBe(false);
    }
  });

  /**
   * ⛔ CONFIGURATION FAILS CLOSED, AND THIS IS THE ASSERTION THAT KEEPS IT THAT WAY.
   *
   * The tempting shape is "no Access configured → fall back to the shared token", which turns a typo in a
   * variable name into a silent downgrade of the only gate in front of a signer that mints unrevocable
   * keys. 503 with an instruction is the honest answer; admitting anybody is not.
   */
  it('⛔ refuses when the team domain or audience is unset — never falls back', async () => {
    for (const env of [
      {},
      { CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' },
      { CF_ACCESS_AUD: 'aud-tag' },
      { CF_ACCESS_TEAM_DOMAIN: '  ', CF_ACCESS_AUD: 'aud-tag' },
    ]) {
      const r = await verifyAccess(req({ 'cf-access-jwt-assertion': 'a.b.c' }), env);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.status, JSON.stringify(env)).toBe(503);
      expect(!r.ok && r.reason).toMatch(/CF_ACCESS_(TEAM_DOMAIN|AUD)/);
    }
  });

  /**
   * ⚠ A JWKS OUTAGE IS A REFUSAL. Fetch is unavailable in this environment, so the verifier's network step
   * fails — and the assertion here is that the failure DENIES rather than admits. The signer is the wrong
   * place to degrade open.
   */
  it('⛔ refuses when the signing keys cannot be read', async () => {
    const wellFormed = `${b64({ alg: 'RS256', kid: 'k' })}.${b64({ email: 'a@b.test' })}.c2ln`;
    const r = await verifyAccess(req({ 'cf-access-jwt-assertion': wellFormed }), {
      CF_ACCESS_TEAM_DOMAIN: '127.0.0.1:1', // nothing listens here
      CF_ACCESS_AUD: 'aud-tag',
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(503);
  });
});
