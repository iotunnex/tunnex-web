import { expect, test } from 'vitest';
import { BANDS, b64u, buildPayload, signLicence, unb64u, verifyLicence } from './licence.ts';
import type { LicencePayload } from './licence.ts';

// Node's WebCrypto Ed25519 is the same API the Worker runtime exposes, so these exercise the REAL signing
// path — no mock, no stub.
async function keypair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
}

const base = {
  domain: 'acme.com',
  band: 'growth',
  tier: 'trial' as const,
  seats: null,
  issued_at: 1000,
  expires_at: 2000,
  license_id: 'lic-1',
};

test('a signed licence verifies against a key set that contains its kid', async () => {
  const { privateKey, publicKey } = await keypair();
  const wire = await signLicence(privateKey, buildPayload({ ...base, kid: 'k1' }));
  expect(wire).toMatch(/^tnxl_[\w-]+\.[\w-]+$/);
  const r = await verifyLicence({ k1: publicKey }, wire);
  expect(r.ok).toBe(true);
  expect(r.ok && r.payload.dom).toBe('acme.com');
  expect(r.ok && r.payload.gw).toBe(20);
});

// ⛔ D4 — THE POINT OF A KEY SET. Two keys coexist; each verifies only against its own kid. Without this,
// "we support a set" is a field in a JSON object and nothing more.
test('a key SET verifies keys minted under different kids', async () => {
  const a = await keypair();
  const b = await keypair();
  const set = { k1: a.publicKey, k2: b.publicKey };

  const wireA = await signLicence(a.privateKey, buildPayload({ ...base, kid: 'k1' }));
  const wireB = await signLicence(b.privateKey, buildPayload({ ...base, kid: 'k2' }));

  expect((await verifyLicence(set, wireA)).ok).toBe(true);
  expect((await verifyLicence(set, wireB)).ok).toBe(true);
});

// ⛔ AND THE HALF THAT MAKES ROTATION MEAN ANYTHING: dropping a kid from the set stops its keys verifying.
// A rotation that could not retire the old key would not be a rotation.
test('removing a kid from the set retires every key minted under it', async () => {
  const a = await keypair();
  const b = await keypair();
  const wireA = await signLicence(a.privateKey, buildPayload({ ...base, kid: 'k1' }));

  expect((await verifyLicence({ k1: a.publicKey, k2: b.publicKey }, wireA)).ok).toBe(true);
  const after = await verifyLicence({ k2: b.publicKey }, wireA); // k1 retired
  expect(after.ok).toBe(false);
  expect(!after.ok && after.reason).toBe('unknown_kid');
});

// ⛔ AN UNKNOWN kid IS A REFUSAL, NEVER A FALLBACK TO "the only key we have".
//
// This is the mutation that turns a key set back into a single key without anyone noticing: a verifier that
// falls back when the kid is unrecognised accepts a key signed by a RETIRED — possibly compromised — key,
// and every test above still passes.
test('an unknown kid is refused, never fallen back from', async () => {
  const a = await keypair();
  const b = await keypair();
  const wire = await signLicence(a.privateKey, buildPayload({ ...base, kid: 'retired' }));
  const r = await verifyLicence({ current: b.publicKey }, wire);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.reason).toBe('unknown_kid');
});

// ⛔ THE SIGNATURE COVERS THE CLAIMS. A tampered band must not verify — the difference between a licence
// and a suggestion.
test('editing the payload invalidates the signature', async () => {
  const { privateKey, publicKey } = await keypair();
  const wire = await signLicence(privateKey, buildPayload({ ...base, band: 'starter', kid: 'k1' }));

  const [body, sig] = wire.slice('tnxl_'.length).split('.');
  const payload = JSON.parse(new TextDecoder().decode(unb64u(body!))) as LicencePayload;
  payload.band = 'scale'; // upgrade yourself
  payload.gw = null;
  const forged = `tnxl_${b64u(new TextEncoder().encode(JSON.stringify(payload)))}.${sig}`;

  const r = await verifyLicence({ k1: publicKey }, forged);
  expect(r.ok).toBe(false);
  expect(!r.ok && r.reason).toBe('bad_signature');
});

// ⚠ THE BAND CEILING IS RESOLVED AT MINT, NOT AT VERIFY. Looked up at verify time, editing BANDS later
// would silently re-price every key already in a customer's hands — a change to a grant nobody re-issued
// and nobody can take back.
test('the gateway ceiling is baked into the payload at mint time', async () => {
  const { privateKey, publicKey } = await keypair();
  const wire = await signLicence(privateKey, buildPayload({ ...base, band: 'starter', kid: 'k1' }));
  const r = await verifyLicence({ k1: publicKey }, wire);
  expect(r.ok && r.payload.gw).toBe(5);
  expect(BANDS.starter.gateways, 'if this changed, existing keys must NOT change with it').toBe(5);
});

test('scale is unlimited, expressed as null rather than a large number', async () => {
  const { privateKey, publicKey } = await keypair();
  const wire = await signLicence(privateKey, buildPayload({ ...base, band: 'scale', kid: 'k1' }));
  const r = await verifyLicence({ k1: publicKey }, wire);
  expect(r.ok && r.payload.gw).toBe(null); // a sentinel like 9999 is a ceiling someone eventually hits
});

// Refusals at BUILD time, where a human can still fix them — not at sign time, where the mistake becomes
// an unrevocable grant.
test('a payload with no kid is refused at build time', () => {
  expect(() => buildPayload({ ...base, kid: '' })).toThrow(/kid is required/);
});

test('an unknown band is refused at build time', () => {
  expect(() => buildPayload({ ...base, kid: 'k1', band: 'enterprise-plus' })).toThrow(/unknown band/);
});

test('an expiry at or before issue is refused at build time', () => {
  expect(() => buildPayload({ ...base, kid: 'k1', expires_at: 1000 })).toThrow(/must be after/);
  expect(() => buildPayload({ ...base, kid: 'k1', expires_at: 999 })).toThrow(/must be after/);
});

test('malformed wire strings are refused rather than throwing', async () => {
  const { publicKey } = await keypair();
  for (const bad of ['', 'nope', 'tnxl_nodot', 'tnxl_!!!.!!!', 42, null, undefined]) {
    const r = await verifyLicence({ k1: publicKey }, bad);
    expect(r.ok, `expected refusal for ${String(bad)}`).toBe(false);
  }
});
