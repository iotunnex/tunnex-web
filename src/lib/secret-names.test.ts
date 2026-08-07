import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⛔ THE SECRET NAMES THE CODE READS MUST BE EXACTLY THE ONES THAT WERE SET.
 *
 * A secret set correctly and READ UNDER A DIFFERENT NAME fails silently until mint time — and that is the
 * one failure an operator meets with a real customer waiting. `wrangler secret list` proves what exists on
 * the Worker; nothing proves the code asks for those names. This does.
 *
 * ⚠ SUBJECT CHOSEN BY CAPABILITY, NOT BY SHAPE (docs/laws.md — a census whose subject is a proxy drifts
 * silently). The subject here is "identifiers read off an env-shaped object", harvested from source — not
 * "fields of a particular interface", which would stop covering the moment someone read a secret without
 * declaring it.
 */
describe('licensing secret names', () => {
  /**
   * Set on the live Worker (confirmed via `wrangler secret list`, 2026-08-06).
   *
   * ⛔ `ADMIN_TOKEN` IS STILL LISTED AND NO LONGER READ, and that is the honest state rather than an
   * oversight. S12.10 replaced it with verified Cloudflare Access identity, so nothing in the source asks
   * for it — but the SECRET REMAINS SET ON THE WORKER until someone runs `wrangler secret delete
   * ADMIN_TOKEN`. This list describes the deployment, not the code; removing the name here before the
   * secret is gone would make the list lie in the direction of "we cleaned that up".
   *
   * ⚠ It is a stale credential with no reader — harmless while unread, and exactly the kind of thing that
   * gets re-adopted by the next person who needs "an admin check". Delete it on the Worker.
   */
  const SET_ON_WORKER = [
    'SIGNING_KEY_JWK',
    'SIGNING_PUBLIC_JWK',
    'SIGNING_KID',
    'ADMIN_TOKEN',
  ] as const;

  const walk = (dir: string, hit: (rel: string, text: string) => void) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, hit);
      else if (/\.(ts|astro)$/.test(name) && !name.endsWith('.test.ts')) {
        hit(p, readFileSync(p, 'utf8'));
      }
    }
  };

  it('every licensing secret the code reads is one that was actually set', () => {
    const read = new Set<string>();
    walk('src', (_rel, text) => {
      const code = text
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
        .join('\n');
      // `env.NAME`, `secrets.NAME`, and `NAME?: string` inside an env-shaped declaration.
      for (const m of code.matchAll(/\b(?:env|secrets)\.(SIGNING_\w+|ADMIN_TOKEN)\b/g))
        read.add(m[1]!);
      for (const m of code.matchAll(/\b(SIGNING_\w+|ADMIN_TOKEN)\??\s*:\s*string/g))
        read.add(m[1]!);
    });

    expect(
      read.size,
      'the census found no secret reads at all — it is checking nothing',
    ).toBeGreaterThan(0);

    const unknown = [...read].filter(
      (n) => !SET_ON_WORKER.includes(n as (typeof SET_ON_WORKER)[number]),
    );
    expect(
      unknown,
      '⛔ THE CODE READS A SECRET THAT IS NOT SET ON THE WORKER. It will be undefined at runtime and the ' +
        'failure surfaces at MINT TIME, with a customer waiting. Either set it (`wrangler secret put`) or ' +
        'fix the name here.',
    ).toEqual([]);
  });

  it('every secret that was set is actually read somewhere', () => {
    const source: string[] = [];
    walk('src', (_rel, text) => source.push(text));
    const all = source.join('\n');
    const unread = SET_ON_WORKER.filter((n) => !new RegExp(`\\b${n}\\b`).test(all));
    expect(
      unread,
      '⚠ A secret is set on the Worker and read by nothing. Either it is dead (remove it, so the next ' +
        'person does not assume it is load-bearing) or a read is missing.',
    ).toEqual([]);
  });
});

/**
 * ⛔ THE DEV BYPASS MUST NOT BE DEPLOYABLE BY ACCIDENT.
 *
 * `ADMIN_DEV_IDENTITY` admits a caller without a verified Access assertion. Its second condition — the
 * request must have arrived on localhost — is not configurable, so this census is the belt to that
 * braces: it fails if the variable is ever committed into `wrangler.toml`, which is the one file whose
 * contents become deployment configuration.
 *
 * ⚠ SUBJECT IS THE FILE THAT SHIPS, not the codebase: `.dev.vars` is gitignored and never deployed, so a
 * value there is exactly where it belongs.
 */
describe('the dev bypass stays local', () => {
  it('⛔ ADMIN_DEV_IDENTITY never appears in deployed configuration', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    expect(
      toml.includes('ADMIN_DEV_IDENTITY'),
      'wrangler.toml IS the deployment. A dev bypass named here would ship with it — put it in .dev.vars.',
    ).toBe(false);
  });
});
