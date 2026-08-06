import type { LicenseClaims } from './issuance.ts';

/**
 * Licence key minting — Ed25519 over a claim set, with a KEY SET selected by `kid`.
 *
 * ⛔ THE PRIVATE KEY IS THE WHOLE COMMERCIAL MODEL. It authorises MINTING, not one licence, so a leak is
 * unlimited; offline verification means it is also unrevocable; and because deployments never call home it
 * is UNDETECTABLE — the telemetry that would show a forged key is exactly what the product promises not to
 * have. Reasoning: tunnex platform repo, docs/S12.4-issuance-decisions.md §3.
 *
 * One rule outranks the rest here:
 *
 *   ⛔ NOTHING IN THIS FILE RETURNS, LOGS OR SERIALISES THE PRIVATE KEY. `signLicence` takes a CryptoKey,
 *      uses it, and drops it. Callers import it non-extractable, so the runtime — not this comment —
 *      enforces that production cannot export it.
 *
 * ⭐ D4 (founder-ruled): every key carries a `kid` and the product verifies against a SET of trusted public
 * keys. That does NOT make rotation cheap — keys already minted run to their own expiry and the installed
 * base still has to upgrade. It makes rotation POSSIBLE TO EXPRESS, by removing the format migration that
 * would otherwise sit on top of the upgrade migration.
 */

/** Wire version. Bumped only for a change a verifier cannot read without knowing. */
export const LICENCE_VERSION = 1;

/** Gateway ceiling per band. `null` = unlimited. */
export const BANDS = {
  // ⛔ TWO, AND THE NUMBER IS THE RULING (founder, 2026-08-06).
  //
  // A gateway limit is enforced at ENROLMENT ONLY — a running gateway is never stopped. So a trial on
  // Scale would let someone enrol 1,000 gateways, let the trial lapse, and KEEP ALL 1,000, reconfiguring
  // and using them indefinitely. That is not a trial; it is a permanent Scale licence that activates when
  // the trial ends. Growth does not fix it — it makes the number 20 instead of 1,000.
  //
  // ⭐ TWO is what a customer needs to SEE site-to-site, HA and cross-site DNS actually work, and it is a
  // ceiling we are content to leave running forever. Both halves have to be true, and only 2 satisfies
  // both. See docs/laws.md — a temporary grant of a create-time limit is a permanent grant.
  trial: { gateways: 2 },
  starter: { gateways: 5 },
  growth: { gateways: 20 },
  scale: { gateways: null },
} as const satisfies Record<string, { gateways: number | null }>;

export type Band = keyof typeof BANDS;

export interface LicencePayload {
  v: number;
  kid: string;
  id: string;
  dom: string;
  band: Band;
  gw: number | null;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { ok: true; payload: LicencePayload }
  | { ok: false; reason: 'malformed' | 'unknown_kid' | 'bad_signature' };

const enc = new TextEncoder();

/** base64url, unpadded — the only encoding that survives an email client and a copy-paste. */
export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function isBand(v: string): v is Band {
  return v in BANDS;
}

/**
 * Build the claim set a key asserts.
 *
 * ⛔ EVERY FIELD IS SOMETHING A HUMAN REVIEWED. Nothing is invented at signing time, because a value
 * nobody approved becomes a grant nobody can take back (docs/S12.4-issuance-decisions.md §1).
 */
export function buildPayload(
  claims: LicenseClaims & { kid: string; band: string },
): LicencePayload {
  if (!claims.kid)
    throw new Error('kid is required — a key with no kid cannot be verified against a key SET');
  if (!claims.domain) throw new Error('domain is required');
  if (!isBand(claims.band)) throw new Error(`unknown band: ${claims.band}`);
  if (!(claims.expires_at > claims.issued_at))
    throw new Error('expires_at must be after issued_at');
  return {
    v: LICENCE_VERSION,
    kid: claims.kid,
    id: claims.license_id,
    dom: claims.domain,
    band: claims.band,
    // ⚠ RESOLVED AT MINT, never looked up at verify: a later change to BANDS must not silently re-price a
    // key already in a customer's hands — that would be editing a grant nobody re-issued.
    gw: BANDS[claims.band].gateways,
    iat: claims.issued_at,
    exp: claims.expires_at,
  };
}

/** Sign a payload. Returns `tnxl_<payload>.<signature>`. */
export async function signLicence(privateKey: CryptoKey, payload: LicencePayload): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(body)),
  );
  return `tnxl_${body}.${b64u(sig)}`;
}

/**
 * Verify a key against a SET of public keys, selecting by `kid`.
 *
 * ⚠ THIS IS THE ISSUER-SIDE MIRROR, NOT THE PRODUCT'S VERIFIER (which is Go, offline, S12.2). It exists so
 * a mint can be PROVEN correct at the moment it is made — a broken key cannot be recalled and is invisible
 * from the customer's side, who simply cannot activate.
 */
export async function verifyLicence(
  keySet: Record<string, CryptoKey>,
  wire: unknown,
): Promise<VerifyResult> {
  if (typeof wire !== 'string' || !wire.startsWith('tnxl_'))
    return { ok: false, reason: 'malformed' };
  const dot = wire.indexOf('.');
  if (dot < 0) return { ok: false, reason: 'malformed' };
  const body = wire.slice('tnxl_'.length, dot);

  let payload: LicencePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64u(body))) as LicencePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // ⛔ THE kid IS SELECTED FROM THE TRUSTED SET, NEVER TRUSTED FROM THE TOKEN, AND AN UNKNOWN kid IS A
  // REFUSAL — NEVER A FALLBACK TO "the only key we have".
  //
  //     const key = keySet[payload.kid] ?? Object.values(keySet)[0];   // ⛔ NEVER
  //
  // That line looks like defensive coding and reads like a sensible default. It turns a key SET back into
  // a single key while every other test stays green, and it accepts a key signed by a RETIRED — possibly
  // compromised — kid. Without refusal, dropping a kid from the set stops nothing, which un-buys the exact
  // property D4 was ruled for.
  const key = keySet[payload.kid];
  if (!key) return { ok: false, reason: 'unknown_kid' };

  let sig: Uint8Array;
  try {
    sig = unb64u(wire.slice(dot + 1));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    sig as BufferSource,
    enc.encode(body),
  );
  return ok ? { ok: true, payload } : { ok: false, reason: 'bad_signature' };
}

/**
 * Import the active signing key from Worker secrets.
 *
 * ⛔ NON-EXTRACTABLE. The runtime then enforces "the private key never leaves" rather than this file asking
 * future callers to respect it — construction over discipline.
 */
export async function activeSigningKey(env: {
  SIGNING_KEY_JWK?: string;
  SIGNING_KID?: string;
}): Promise<{ key: CryptoKey; kid: string }> {
  if (!env.SIGNING_KEY_JWK || !env.SIGNING_KID) throw new Error('signing key not configured');
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(env.SIGNING_KEY_JWK) as JsonWebKey,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  return { key, kid: env.SIGNING_KID };
}

/**
 * Import a PUBLIC verifying key from a JWK.
 *
 * ⛔ IT LIVES HERE SO Ed25519 STAYS IN ONE MODULE. The admin surface needs to self-verify a key before it
 * leaves, which briefly put the algorithm name in a second file — and the confinement guard
 * (trial-issuance.test.ts) went red. The right answer was to move the import here, not to widen the guard:
 * one signing module is one place to get signing wrong, and only one place that gets reviewed as if it
 * mattered.
 */
export async function importPublicKey(jwk: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', JSON.parse(jwk) as JsonWebKey, { name: 'Ed25519' }, true, [
    'verify',
  ]);
}
