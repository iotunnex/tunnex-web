import { EMAIL } from './email/palette.ts';
import { verifyAccess, type AccessEnv } from './access.ts';

/**
 * The admin surfaces' shared gate and chrome.
 *
 * ⛔ ONE GATE FOR EVERY ADMIN PAGE, and that is the point rather than tidiness: three copies of an
 * identity check is three chances for one of them to be the weakest, on the surfaces that mint
 * unrevocable licences. The gate is `adminIdentity` below — Cloudflare Access, verified.
 */

export function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export function day(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

export type AdminGate =
  { kind: 'ok'; actor: string } | { kind: 'redirect' | 'denied'; response: Response };

/**
 * ⛔ THE ADMIN GATE IS CLOUDFLARE ACCESS, VERIFIED — and `ADMIN_TOKEN` is gone (S12.10).
 *
 * What it replaced: one shared bearer string, with no identity, no per-person revocation, and no way for
 * `issued_keys` to say WHO signed a key. It travelled in a URL — browser history, `Referer`, and
 * Cloudflare's own request logs, where the walk found it in plain text — guarding the only surface that
 * mints unrevocable licences.
 *
 * ⭐ MEASURED BEFORE IT WAS TRUSTED, and all four probes agreed:
 *   - every `/api/admin/*` path 302s to the team's Access login, INCLUDING a path that does not exist —
 *     so the application is a PREFIX and a future admin route inherits the gate rather than opening a hole
 *   - POST is covered, not just GET
 *   - `/api/trial/request` is NOT behind Access — the negative control, proving the app is scoped rather
 *     than "everything happens to be protected"
 *   - the team's JWKS is live: 2 RSA keys, RS256, kid-selected
 *
 * ⚠ AND THE VERIFICATION IS WHAT MAKES IT SAFE, not the coverage. Access being in front today is an
 * operational fact that a dashboard click can undo; a signature check fails closed the moment it is
 * undone. See `verifyAccess`.
 */
export async function adminIdentity(request: Request, env: unknown): Promise<AdminGate> {
  const res = await verifyAccess(request, env as AccessEnv);
  if (res.ok) return { kind: 'ok', actor: res.identity.actor };
  return {
    kind: 'denied',
    response: new Response(`unauthorized: ${res.reason}\n`, {
      status: res.status,
      headers: { 'referrer-policy': 'no-referrer' },
    }),
  };
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
