import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { d1AdminIssueStore, type QueueRow } from '../../../lib/admin-issue.ts';
import { PAID_BANDS, TERM_MONTHS } from '../../../lib/paid-request.ts';
import { EMAIL } from '../../../lib/email/palette.ts';
import { adminIdentity, adminChrome, esc, day } from '../../../lib/admin-page.ts';

export const prerender = false;

/**
 * ⚠ `trials.status` IS AN INTERNAL STRING AND MEANS NOTHING IN A REVIEWER'S COLUMN. The walk showed
 * "pending_launch" to a human deciding whether to mint an unrevocable key — a value that reads like a
 * system state and answers none of their question. These say what the reviewer actually needs to know.
 */
const TRIAL_STATE: Record<string, string> = {
  pending_launch: 'awaiting a key',
  active: '⛔ already has a live key',
  expired: 'trial expired',
};

/** ⛔ What a row's payment state MEANS for the button, in the reviewer's words rather than the column's. */
function payment(r: QueueRow): string {
  if (r.kind !== 'paid') return '<small>nothing to settle</small>';
  return r.paymentState === 'settled'
    ? '<small>settled — signable</small>'
    : `<b class="warn">⛔ PENDING PAYMENT</b><br><small>cannot be signed</small>`;
}

/**
 * ⛔ EVERY KEY ALREADY ISSUED TO THIS DOMAIN. Each one is live until its own expiry and nothing on this
 * page can recall any of them, so the reviewer gets the COUNT, not "the" key.
 *
 * ⚠ A FUNCTION RATHER THAN AN INLINE CELL, and the reason is a shipped defect: `no-literal-interpolation`
 * refuses `${...}` it cannot prove is inside a template literal, and a template nested three deep inside a
 * table row is exactly the shape it cannot follow. That guard exists because seven `${}` markers once
 * shipped as literal text to visitors — flattening the nesting is cheaper than teaching it to guess.
 */
function priorKeys(r: QueueRow): string {
  if (!r.priorKeys) return '<small>none</small>';
  const k = r.priorKeys.latest;
  const detail = `latest ${esc(k.band)} · ${esc(k.kid)} · ${day(k.issuedAt)} → ${day(k.expiresAt)}`;
  return `<b class="warn">⛔ ${r.priorKeys.count} ALREADY ISSUED</b><br><small>${detail}</small>`;
}

/**
 * The reviewer's screen.
 *
 * ⚠ IT SHOWS ENOUGH TO DECIDE, NOT JUST ENOUGH TO CLICK: the domain, what was ASKED for, what would be
 * MINTED, whether money has arrived, what `trials` already knows — and ⛔ every key already issued to that
 * domain, because each one is live until its own expiry and nothing here can recall any of them.
 */
export const GET: APIRoute = async ({ request }) => {
  const gate = await adminIdentity(request, env);
  if (gate.kind !== 'ok') return gate.response;

  const rows = await d1AdminIssueStore(env.DB).pendingQueue();

  const bandOptions = (selected: string) =>
    ['trial', ...PAID_BANDS]
      .map((b) => `<option value="${b}"${b === selected ? ' selected' : ''}>${esc(b)}</option>`)
      .join('');

  const body = rows
    .map(
      (r) => `<tr>
<td><b>${esc(r.domain)}</b><br><small>${esc(
        r.contactEmail ?? r.trialEmail ?? '⛔ no address — cannot deliver',
      )}</small>${r.company ? `<br><small>${esc(r.company)}</small>` : ''}</td>
<td>${esc(r.kind)}${
        r.requestedBand
          ? `<br><small>asked for <b>${esc(r.requestedBand)}</b>${
              r.requestedTermMonths ? ` · ${r.requestedTermMonths}m` : ''
            }${r.gateways ? ` · ${r.gateways} gw` : ''}</small>`
          : ''
      }${r.notes ? `<br><small>${esc(r.notes)}</small>` : ''}</td>
<td><select class="band" data-d="${esc(r.domain)}">${bandOptions(r.tier)}</select>
<br><small>${Math.round((r.expiresAt - r.issuedAt) / 86400)} days</small></td>
<td>${payment(r)}${
        r.kind === 'paid' && r.paymentState === 'pending'
          ? `<br><button class="settle" data-d="${esc(r.domain)}">Payment received</button>`
          : ''
      }</td>
<td>${esc(r.trialStatus ? (TRIAL_STATE[r.trialStatus] ?? r.trialStatus) : '—')}</td>
<td>${priorKeys(r)}</td>
<td><small>${day(r.queuedAt)}</small></td>
<td><button class="issue" data-d="${esc(r.domain)}"${
        r.kind === 'paid' && r.paymentState !== 'settled'
          ? ' disabled title="payment not settled"'
          : ''
      }>Sign &amp; email</button>
<button class="refuse" data-d="${esc(r.domain)}">Refuse</button></td></tr>`,
    )
    .join('');

  return new Response(
    adminChrome(
      'Licence review queue',
      `<h1>Licence review queue</h1>
<p>⛔ Every key signed here is <b>unrevocable</b> — Tunnex verifies offline, so nothing you do afterwards
reaches it. There is no edit and no delete: a change means a NEW key, and the old one stays alive until its
own expiry. Check the domain and the band before signing, and read the <b>already issued</b> column.</p>
<p><a href="/api/admin/licences">Every key ever issued →</a></p>
<table><tr><th>Domain</th><th>Kind / asked for</th><th>Band to mint</th><th>Payment</th><th>Trial</th>
<th>Prior keys</th><th>Queued</th><th></th></tr>
${body || '<tr><td colspan=8>Nothing pending.</td></tr>'}</table>

<h2>Mint without a request</h2>
<p>A deal closed offline. ⚠ This files a row and does <b>not</b> sign it — you still review and sign it
above, so there is exactly one path from a decision to a signature.</p>
<form id="direct">
  <input name="domain" placeholder="customer.example" required>
  <input name="contactEmail" type="email" placeholder="who receives the key" required>
  <select name="band">${PAID_BANDS.map((b) => `<option>${b}</option>`).join('')}</select>
  <select name="termMonths">${TERM_MONTHS.map((m) => `<option value="${m}">${m} months</option>`).join('')}</select>
  <input name="notes" placeholder="note (optional)">
  <button>File it</button>
</form>
<div id="out"></div>
<script>
async function post(payload) {
  const res = await fetch('/api/admin/issue', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(payload)
  });
  document.getElementById('out').textContent = await res.text();
  return res.ok;
}
document.querySelectorAll('button.issue, button.refuse').forEach(b => b.onclick = async () => {
  const refuse = b.classList.contains('refuse');
  if (!confirm(refuse ? 'Refuse this request?' : 'Sign and email a licence? This CANNOT be revoked.')) return;
  b.disabled = true;   // the server refuses a second decision anyway; this just avoids the pointless request
  if (await post({ domain: b.dataset.d, refuse })) b.closest('tr').style.opacity = .4;
});
document.querySelectorAll('button.settle').forEach(b => b.onclick = async () => {
  // ⚠ The wording asks about the MONEY, not about the row: the reviewer is confirming a fact about the
  // world, and the row state is only how we record it.
  if (!confirm('Confirm the payment for this licence has actually arrived?')) return;
  if (await post({ domain: b.dataset.d, action: 'settle' })) location.reload();
});
document.querySelectorAll('select.band').forEach(s => s.onchange = async () => {
  await post({ domain: s.dataset.d, action: 'band', band: s.value });
});
document.getElementById('direct').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  if (!confirm('File a licence request for ' + f.get('domain') + '?')) return;
  if (await post({ action: 'direct', domain: f.get('domain'), contactEmail: f.get('contactEmail'),
                   band: f.get('band'), termMonths: Number(f.get('termMonths')), notes: f.get('notes') }))
    location.reload();
};
</script>`,
    ),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer' } },
  );
};

/** Kept for the token-exchange redirect target; the palette import documents the constraint. */
export const PALETTE_BG = EMAIL.bg;
