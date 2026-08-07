import { EMAIL } from './email/palette.ts';

/**
 * The admin surfaces' shared gate and chrome (S12.7).
 *
 * ⛔ EXTRACTED BECAUSE THIS STORY ADDS SURFACES BEHIND ONE SHARED SECRET, AND THAT IS THE RISK THE FOUNDER
 * NAMED. `ADMIN_TOKEN` is a single bearer string with no identity: it cannot say who signed a key, and
 * every new page behind it widens what one leaked string reaches. Copying the check into each page would
 * make that worse in the quietest possible way — three implementations, one of which will eventually be
 * the weakest.
 *
 * ⚠ ACCESS IS THE CONTROL; THIS IS THE FLOOR BENEATH IT. Cloudflare Access sits in front of these routes
 * and is what actually knows who is asking. Registered, unchanged, and now true of three pages instead of
 * one: replacing the token with real identity is its own story.
 */

const COOKIE = 'tnx_admin';

export function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export function day(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** Constant-time compare: a `===` on the only secret guarding the signer leaks its prefix by timing. */
export function tokenMatches(token: string, expected: string | undefined): boolean {
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export type AdminGate = { kind: 'ok' } | { kind: 'redirect' | 'denied'; response: Response };

/**
 * ⛔ THE TOKEN MUST NOT LIVE IN THE URL. The walk put it in browser history, in the `Referer` header of
 * every subsequent request, and in Cloudflare's own request logs — where the tail output showed it in
 * plain text. It guards the only surface that mints unrevocable keys.
 *
 * So `?t=` is accepted ONCE, exchanged for an HttpOnly cookie, and redirected away. The URL left in
 * history carries no secret.
 *
 * ⚠ Path=/api/admin so the cookie reaches every admin surface, not just the one that minted it — a
 * per-page cookie would send the operator back through a URL-borne token for each new screen, which is
 * the exact thing this exists to stop.
 */
export function adminGate(request: Request, env: unknown): AdminGate {
  const expected = (env as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('t');
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  // ⚠ `||`, NOT `??`. An absent header is the EMPTY STRING, not null, so `??` would stop at it and never
  // reach the cookie — the page would 401 for an operator who is correctly signed in.
  const token = fromQuery || bearer || (cookie ? decodeURIComponent(cookie) : '');

  if (!tokenMatches(token, expected)) {
    return { kind: 'denied', response: new Response('unauthorized', { status: 401 }) };
  }
  if (fromQuery) {
    url.searchParams.delete('t');
    return {
      kind: 'redirect',
      response: new Response(null, {
        status: 302,
        headers: {
          location: url.pathname + (url.search || ''),
          'set-cookie': `${COOKIE}=${encodeURIComponent(fromQuery)}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict`,
          'referrer-policy': 'no-referrer',
        },
      }),
    };
  }
  return { kind: 'ok' };
}

/**
 * ⚠ COLOURS COME FROM THE EMAIL PALETTE, and that is deliberate rather than lazy. These pages are raw HTML
 * returned by the Worker — no Astro layout, no stylesheet — so CSS custom properties resolve to NOTHING
 * here, exactly as in an email client. `src/lib/email/palette.ts` is the token guard's narrow exclusion for
 * precisely that constraint. ⛔ Raw hex fails `scripts/lint-tokens.mjs`, a standing CI check.
 */
export function adminChrome(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="robots" content="noindex,nofollow">
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:2rem;background:${EMAIL.bg};color:${EMAIL.text}}
table{border-collapse:collapse;width:100%;margin-top:1rem}
td,th{border-bottom:1px solid ${EMAIL.border};padding:.6rem;vertical-align:top;text-align:left}
.warn{color:${EMAIL.primary}}
a{color:${EMAIL.text}}
h2{margin-top:2rem}
input,select,button{font:inherit;padding:.35rem;margin:.15rem .3rem .15rem 0;background:${EMAIL.surface};
  color:${EMAIL.text};border:1px solid ${EMAIL.border};border-radius:.35rem}
button[disabled]{opacity:.45}
#out{white-space:pre-wrap;background:${EMAIL.surface};padding:1rem;margin-top:1rem;border-radius:.5rem}
</style>
${body}`;
}
