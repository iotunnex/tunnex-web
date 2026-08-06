import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

/**
 * ⛔ THE CEREMONY'S KEY MUST IMPORT IN **WORKERS**, NOT IN NODE.
 *
 * This is the test whose absence cost a live walk. 144 tests passed; every one of them ran on Node, where
 * the key worked. The runtime that REJECTED it is the one nobody tested against:
 *
 *   DataError: JSON Web Key Algorithm parameter "alg" ("Ed25519") does not match requested Ed25519 curve.
 *
 * Node's `exportKey('jwk')` emits `alg: "Ed25519"`. workerd requires the JWA registered name `"EdDSA"`
 * (RFC 8037). The operator pasted the secret perfectly; the ceremony emitted something the runtime refuses.
 *
 * > ⭐ **A CROSS-RUNTIME CRYPTO BOUNDARY TESTED ON ONE SIDE ONLY IS UNTESTED** — and this one failed in the
 * > direction that looks like a deployment problem rather than a code problem, which is why it survived to
 * > production.
 *
 * ⭐ THE CEREMONY SCRIPT IS EXTRACTED FROM README.md, NOT COPIED HERE. If the README's generator changes,
 * this test runs the NEW one — so the documentation and the runtime cannot drift apart again. A copy would
 * pass while the README rotted, which is the whole failure mode.
 */
describe('the ceremony emits a key that imports in the Workers runtime', () => {
  let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('test/fixtures/jwk-import-worker.js', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      config: 'test/fixtures/jwk-import-worker.toml',
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.stop();
  });

  /** Pull the `node -e '…'` generator out of the ceremony section of README.md. */
  function ceremonyScript(): string {
    const readme = readFileSync('README.md', 'utf8');
    const m = readme.match(/node -e '\n([\s\S]*?)'\n/);
    expect(
      m,
      'the ceremony generator was not found in README.md — this test reads it, never a copy',
    ).toBeTruthy();
    return m![1]!;
  }

  it('the JWK the README generates is accepted by workerd', async () => {
    const out = execFileSync('node', ['-e', ceremonyScript()], { encoding: 'utf8' });
    // The ceremony prints label lines then value lines; the private JWK is the line after "PRIVATE:".
    const lines = out.split('\n').map((l) => l.trim());
    const priv = lines[lines.indexOf('PRIVATE:') + 1]!;
    expect(priv.startsWith('{'), `expected a bare JWK line, got: ${priv}`).toBe(true);

    const jwk = JSON.parse(priv) as Record<string, unknown>;
    // ⛔ The specific fix, pinned by value: Node says "Ed25519" here and workerd refuses it.
    expect(jwk.alg, "workerd requires the JWA registered name, not Node's curve name").toBe(
      'EdDSA',
    );

    const res = await worker.fetch('http://x/', { method: 'POST', body: priv });
    const body = (await res.json()) as { ok: boolean; error?: string; sigBytes?: number };
    expect(
      body.ok,
      `⛔ THE CEREMONY'S KEY DOES NOT IMPORT IN WORKERS: ${body.error}\n\n` +
        'This is the exact failure that reached production. Fix the generator in README.md — the runtime ' +
        'is the authority here, not Node.',
    ).toBe(true);
    expect(body.sigBytes).toBe(64);
  }, 30_000);

  // ⚠ THE NEGATIVE HALF. Without it, a test that always says OK would pass even if the worker fixture
  // stopped importing anything at all.
  it('rejects the shape Node emits by default — proving the runtime is really being exercised', async () => {
    const nodeDefault = execFileSync(
      'node',
      [
        '-e',
        `crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']).then(async k=>console.log(JSON.stringify(await crypto.subtle.exportKey('jwk',k.privateKey))))`,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(JSON.parse(nodeDefault).alg).toBe('Ed25519'); // what Node produces, unmodified

    const res = await worker.fetch('http://x/', { method: 'POST', body: nodeDefault });
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(
      body.ok,
      "workerd is expected to REFUSE Node's default alg — if it accepts it, this test is no longer proving anything",
    ).toBe(false);
    expect(body.error).toMatch(/alg/i);
  }, 30_000);
});
