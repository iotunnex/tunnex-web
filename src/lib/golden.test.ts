import { expect, test } from 'vitest';
import { buildPayload, signLicence } from './licence.ts';

/**
 * ⭐ THE CROSS-REPO GOLDEN VECTOR — this repo's half.
 *
 * ⚠ REGENERATED IN S12.1 when `tier` entered the wire format. The Go twin was updated BY HAND from this
 * value — not derived, not shared through a package. That is the mechanism: if only one side had been
 * updated, the other would have gone red, which is the whole reason both literals exist.
 *
 * The verifier is Go, in the platform repo (`apps/api/internal/licence/golden_test.go`). It asserts that
 * VERIFYING this exact string yields these exact claims. This file asserts that SIGNING these claims with
 * this key produces that exact string. Two repos, two languages, no shared code.
 *
 * ⛔ BOTH LITERALS ARE HAND-MAINTAINED. Never generated, never shared through a package, never fetched.
 * Derive one from the other and the two files agree BY CONSTRUCTION — the failure the twin canonical-hash
 * goldens exist to prevent: a check must be able to DISAGREE with the thing it checks, and derivation
 * removes that ability while looking like rigour.
 *
 * ⚠ A FORMAT CHANGE MUST BREAK BOTH FILES, OR THE GUARD IS DECORATIVE. The duplication is the mechanism.
 *
 * The vector is deliberately awkward — NULL gateway ceiling, UNICODE domain, far-future expiry — because
 * the disagreements that survive between two languages are encoding ones, not happy-path ones.
 */

/** The golden signing key. A published test seed: it signs this vector and nothing else, ever. */
const GOLDEN_PRIVATE_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '2XAC4iGhtpJ-P3VxrW-6_OU9XHF-T2DXvDGlw6JTv_s',
  d: 'VHVubmV4IFMxMjIuMiBnb2xkZW4gdmVjdG9yIHNlZWQ',
};

const GOLDEN_CLAIMS = {
  kid: 'k-golden-1',
  domain: 'münchen-gmbh.example',
  band: 'scale',
  tier: 'enterprise' as const,
  seats: null,
  issued_at: 1_700_000_000,
  expires_at: 4_102_444_800,
  license_id: '11111111-2222-3333-4444-555555555555',
};

/** ⛔ Transcribed by hand from the Go twin. If you changed the format, change BOTH. */
const GOLDEN_WIRE =
  'tnxl_eyJ2IjoxLCJraWQiOiJrLWdvbGRlbi0xIiwiaWQiOiIxMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUiLCJkb20iOiJtw7xuY2hlbi1nbWJoLmV4YW1wbGUiLCJ0aWVyIjoic2NhbGUiLCJiYW5kIjoic2NhbGUiLCJndyI6bnVsbCwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.lvAsH4hNbeLb-GU9RvYZbvI0IoH_HMWc6Mx2Felw39rmFtZN-Su_dM8P3ShS0K-tYWJ8TFILAuH2dVz5ki1lAw';

test('signing the golden claims produces the exact wire string the Go verifier expects', async () => {
  const priv = await crypto.subtle.importKey(
    'jwk',
    GOLDEN_PRIVATE_JWK,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const wire = await signLicence(priv, buildPayload(GOLDEN_CLAIMS));

  expect(
    wire,
    '⛔ THE WIRE FORMAT CHANGED. The Go verifier in the platform repo asserts this same string by hand ' +
      '(apps/api/internal/licence/golden_test.go). Update BOTH literals together — and if only this side ' +
      'changed, that is the cross-repo drift this vector exists to catch.',
  ).toBe(GOLDEN_WIRE);
});

// ⚠ Ed25519 is deterministic (RFC 8032), which is what makes an exact-string assertion possible at all.
// If this ever fails while the payload is unchanged, the signature scheme is not what we think it is.
test('the signature is deterministic — the same claims always produce the same string', async () => {
  const priv = await crypto.subtle.importKey(
    'jwk',
    GOLDEN_PRIVATE_JWK,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const a = await signLicence(priv, buildPayload(GOLDEN_CLAIMS));
  const b = await signLicence(priv, buildPayload(GOLDEN_CLAIMS));
  expect(a).toBe(b);
});
