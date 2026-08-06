import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { d1AdminIssueStore } from '../../../lib/admin-issue.ts';
import { EMAIL } from '../../../lib/email/palette.ts';

export const prerender = false;

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The reviewer's screen.
 *
 * ⚠ IT SHOWS ENOUGH TO DECIDE, NOT JUST ENOUGH TO CLICK: the domain, the band, the term, what `trials`
 * already knows — and ⛔ whether a key has ALREADY been issued to that domain, because a second key is a
 * second unrevocable artefact and the ledger is the only thing that can say so.
 */
export const GET: APIRoute = async ({ request }) => {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const expected = (env as unknown as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
  if (!expected || token.length !== expected.length)
    return new Response('unauthorized', { status: 401 });
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return new Response('unauthorized', { status: 401 });

  const rows = await d1AdminIssueStore(env.DB).pendingQueue();

  const body = rows
    .map(
      (r) => `<tr>
<td><b>${esc(r.trialDomain)}</b><br><small>${esc(r.trialEmail ?? '⛔ no trial row — cannot deliver')}</small></td>
<td>${esc(r.tier)}<br><small>${Math.round((r.expiresAt - r.issuedAt) / 86400)} days</small></td>
<td>${esc(r.trialStatus ?? '—')}</td>
<td>${
        r.alreadyIssued
          ? `<b class="warn">⛔ ALREADY ISSUED</b><br><small>${esc(r.alreadyIssued.kid)} · ${day(
              r.alreadyIssued.issuedAt,
            )} → ${day(r.alreadyIssued.expiresAt)}</small>`
          : '<small>none</small>'
      }</td>
<td><small>${day(r.queuedAt)}</small></td>
<td><button class="issue" data-d="${esc(r.trialDomain)}">Sign &amp; email</button>
<button class="refuse" data-d="${esc(r.trialDomain)}">Refuse</button></td></tr>`,
    )
    .join('');

  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Licence review queue</title>
<meta name="robots" content="noindex,nofollow">
<style>
/* ⚠ COLOURS COME FROM THE EMAIL PALETTE, and that is deliberate rather than lazy. This page is raw HTML
   returned by the Worker — no Astro layout, no stylesheet — so CSS custom properties resolve to NOTHING
   here, exactly as in an email client. src/lib/email/palette.ts is the token guard's narrow exclusion
   for precisely that constraint, and it mirrors the semantic tokens.
   ⛔ Raw hex here fails scripts/lint-tokens.mjs, which is a standing CI check — it caught this page on
   its first deploy, because I ran a narrower lint locally than CI runs.
   ⚠ The constant is named EMAIL and this is not an email; it is the same CONSTRAINT, and inventing a
   second colour source for one admin page would be worse than the slightly narrow name. */
body{font:15px/1.45 system-ui,sans-serif;margin:2rem;background:${EMAIL.bg};color:${EMAIL.text}}
table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid ${EMAIL.border};padding:.6rem;vertical-align:top;text-align:left}
.warn{color:${EMAIL.primary}}
#out{white-space:pre-wrap;background:${EMAIL.surface};padding:1rem;margin-top:1rem;border-radius:.5rem}
</style>
<h1>Licence review queue</h1>
<p>⛔ Every key signed here is <b>unrevocable</b> — Tunnex verifies offline, so nothing you do afterwards
reaches it. Check the domain and the band before signing, and read the <b>already issued</b> column.</p>
<table><tr><th>Domain</th><th>Band / term</th><th>Trial</th><th>Prior key</th><th>Queued</th><th></th></tr>
${body || '<tr><td colspan=6>Nothing pending.</td></tr>'}</table>
<div id="out"></div>
<script>
const t = new URLSearchParams(location.search).get('t') || '';
document.querySelectorAll('button').forEach(b => b.onclick = async () => {
  const refuse = b.classList.contains('refuse');
  if (!confirm(refuse ? 'Refuse this request?' : 'Sign and email a licence? This CANNOT be revoked.')) return;
  b.disabled = true;   // the server refuses a second decision anyway; this just avoids the pointless request
  const res = await fetch('/api/admin/issue', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
    body: JSON.stringify({ domain: b.dataset.d, refuse })
  });
  document.getElementById('out').textContent = await res.text();
  if (res.ok) b.closest('tr').style.opacity = .4;
});
</script>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
};
