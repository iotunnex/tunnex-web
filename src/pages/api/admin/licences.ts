import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { d1AdminIssueStore, groupByDomain, withinTerm } from '../../../lib/admin-issue.ts';
import { PAID_BANDS, TERM_MONTHS } from '../../../lib/paid-request.ts';
import { adminIdentity, adminChrome, esc, day } from '../../../lib/admin-page.ts';

export const prerender = false;

/**
 * The licence list — the read that did not exist (S12.7).
 *
 * ⛔ `issued_keys` HAS BEEN THE ONLY RECORD OF WHAT WE PUT INTO THE WORLD, AND NOTHING READ IT. One
 * `LEFT JOIN` in the queue surfaced a single prior key per pending row; there was no way to ask "what does
 * this customer actually have" for a domain with nothing pending, which is every customer most of the time.
 *
 * ⛔ THERE IS NO EDIT, NO REVOKE AND NO DELETE ON THIS PAGE, and not because they are hidden. Tunnex
 * verifies offline: a key that left runs to its own expiry and nothing here reaches it. A control that
 * cannot work must not exist to be looked for.
 *
 * ⭐ SO KEYS ARE GROUPED BY DOMAIN AND ALL OF THEM ARE SHOWN — never one replacing another. A re-issue ADDS
 * a row; the previous key is still valid until its own date and the customer may still be running it.
 * "Within term" is arithmetic over the clock, not a status this service controls.
 */
export const GET: APIRoute = async ({ request }) => {
  const gate = await adminIdentity(request, env);
  if (gate.kind !== 'ok') return gate.response;

  const rows = await d1AdminIssueStore(env.DB).ledger();
  const now = Math.floor(Date.now() / 1000);
  const groups = groupByDomain(rows);

  const blocks = groups
    .map((g) => {
      const live = g.keys.filter((k) => withinTerm(k, now)).length;
      const keys = g.keys
        .map(
          (k) => `<tr>
<td>${esc(k.band)}</td>
<td>${day(k.issuedAt)} → ${day(k.expiresAt)}<br><small>${Math.round(
            (k.expiresAt - k.issuedAt) / 86400,
          )} days</small></td>
<td>${withinTerm(k, now) ? '<b>within term</b>' : '<small>term ended</small>'}</td>
<td><small>${esc(k.kid)}</small></td>
<td><small>${esc(k.licenseId)}</small></td>
<td><small>${k.emailedAt ? day(k.emailedAt) : '⛔ never confirmed sent'}</small></td>
<td><small>${
            k.issuedBy === 'pre-identity'
              ? '<i>pre-identity — signed under the shared token</i>'
              : esc(k.issuedBy) || '<b class="warn">⛔ not recorded</b>'
          }</small></td>
</tr>`,
        )
        .join('');
      return `<h2>${esc(g.domain)} <small>— ${g.keys.length} key${g.keys.length === 1 ? '' : 's'}, ${live} within term</small></h2>
<table><tr><th>Band</th><th>Term</th><th>Now</th><th>kid</th><th>licence id</th><th>Emailed</th><th>Signed by</th></tr>
${keys}</table>
<form class="reissue" data-domain="${esc(g.domain)}">
  <input name="contactEmail" type="email" placeholder="who receives the new key" required>
  <select name="band">${PAID_BANDS.map((b) => `<option>${b}</option>`).join('')}</select>
  <select name="termMonths">${TERM_MONTHS.map((m) => `<option value="${m}">${m} months</option>`).join('')}</select>
  <input name="notes" placeholder="why re-issued (optional)">
  <button>Re-issue for ${esc(g.domain)}</button>
</form>`;
    })
    .join('');

  return new Response(
    adminChrome(
      'Issued licences',
      `<h1>Issued licences</h1>
<p>⛔ Every key here is <b>live until its own expiry</b>. Tunnex verifies offline, so there is nothing to
revoke, nothing to edit, and nothing to delete — a change means minting a <b>new</b> key while the old one
keeps working. That is why a customer's keys are all listed rather than replaced.</p>
<p><a href="/api/admin/queue">← the review queue</a> · ${rows.length} key${rows.length === 1 ? '' : 's'} issued in total</p>
${blocks || '<p>No keys have been issued.</p>'}
<div id="out"></div>
<script>
document.querySelectorAll('form.reissue').forEach(f => f.onsubmit = async (e) => {
  e.preventDefault();
  const d = f.dataset.domain;
  // ⛔ THE CONFIRM SAYS WHAT RE-ISSUING DOES NOT DO. The one wrong assumption available here is that a
  // replacement retires what came before; it does not, and nothing can.
  if (!confirm('File a replacement key for ' + d + '?\\n\\nThe existing key(s) KEEP WORKING until their own expiry — this cannot recall them.')) return;
  const v = new FormData(f);
  const res = await fetch('/api/admin/issue', {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ action: 'direct', domain: d, contactEmail: v.get('contactEmail'),
      band: v.get('band'), termMonths: Number(v.get('termMonths')), notes: v.get('notes') })
  });
  document.getElementById('out').textContent = await res.text();
});
</script>`,
    ),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer' } },
  );
};
