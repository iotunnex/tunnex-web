import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adminIdentity } from '../../../lib/admin-page.ts';
import {
  activeSigningKey,
  buildPayload,
  importPublicKey,
  signLicence,
  verifyLicence,
} from '../../../lib/licence.ts';

export const prerender = false;

/**
 * ⭐ PROVE THE SIGNING KEY WORKS — before a real customer is queued.
 *
 * ⛔ SETTING A SECRET PROVES NOTHING ABOUT WHETHER IT WORKS. The first live attempt failed with a key that
 * was pasted perfectly: Node's exportKey emits alg:"Ed25519" and workerd refuses it, requiring "EdDSA".
 * The ceremony now emits EdDSA — and this endpoint is what makes that checkable rather than assumed.
 *
 * ⚠ It signs a FIXED DUMMY payload and issues nothing: no queue row is touched, no key is recorded, no
 * email is sent. Safe to run at any time, including on a live deployment.
 */
export const GET: APIRoute = async ({ request }) => {
  const gate = await adminIdentity(request, env);
  if (gate.kind !== 'ok') return gate.response;
  const secrets = env as unknown as {
    SIGNING_KEY_JWK?: string;
    SIGNING_KID?: string;
    SIGNING_PUBLIC_JWK?: string;
  };

  const fail = (why: string, e?: unknown) =>
    new Response(
      `${why}${e ? `\n\n${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}` : ''}`,
      {
        status: 500,
      },
    );

  if (!secrets.SIGNING_KEY_JWK || !secrets.SIGNING_KID)
    return fail('SIGNING_KEY_JWK or SIGNING_KID is not set.');
  try {
    JSON.parse(secrets.SIGNING_KEY_JWK);
  } catch (e) {
    return fail(
      'SIGNING_KEY_JWK is not valid JSON — the paste did not survive. Re-run the ceremony.',
      e,
    );
  }

  let wire: string;
  let kid: string;
  try {
    const active = await activeSigningKey(secrets);
    kid = active.kid;
    wire = await signLicence(
      active.key,
      buildPayload({
        kid: active.kid,
        domain: 'selftest.invalid', // ⚠ RFC 2606 — cannot be a real customer
        band: 'trial',
        tier: 'trial',
        seats: null,
        issued_at: 1,
        expires_at: 2,
        license_id: '00000000-0000-0000-0000-000000000000',
      }),
    );
  } catch (e) {
    return fail(
      'The signing key was refused by this runtime. Most likely the JWK "alg": Node exports "Ed25519", ' +
        'Workers requires "EdDSA". Re-run the ceremony in README.md — it now emits EdDSA.',
      e,
    );
  }

  if (!secrets.SIGNING_PUBLIC_JWK)
    return fail('Signed OK, but SIGNING_PUBLIC_JWK is not set, so nothing self-verifies.');
  try {
    const res = await verifyLicence(
      { [kid]: await importPublicKey(secrets.SIGNING_PUBLIC_JWK) },
      wire,
    );
    if (!res.ok) {
      return fail(
        `Signed OK, but self-verification failed (${res.reason}). SIGNING_PUBLIC_JWK is probably not the ` +
          'public half of SIGNING_KEY_JWK — re-run the ceremony and set BOTH halves together.',
      );
    }
  } catch (e) {
    return fail('SIGNING_PUBLIC_JWK could not be imported.', e);
  }

  // ⚠ The kid is not a secret — it is stamped into every key — so naming it here helps an operator
  // confirm which key is live without exposing anything.
  return new Response(`ok — signed and self-verified with kid "${kid}"\n`, { status: 200 });
};
