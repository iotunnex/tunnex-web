import { describe, expect, it } from 'vitest';
import { handleInstallHost, INSTALL_HOST } from '../src/install/handler.ts';

const get = (path = '/', headers: Record<string, string> = {}) =>
  handleInstallHost(new Request(`https://${INSTALL_HOST}${path}`, { headers }));

describe('get.tunnex.io', () => {
  // ⛔ THE ASSERTION THE OUTAGE EXISTS FOR. A DNS record and a route went live with no handler, `/` fell
  // through to the Astro adapter, and `curl -fsSL https://get.tunnex.io | sh` piped the marketing homepage
  // into a shell — HTTP 200, text/html.
  it('serves the SCRIPT by default, as text/plain', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await res.text();
    expect(body.startsWith('#!/bin/sh')).toBe(true);
    // ⚠ NOT A FRAGMENT MATCH — the response must not be HTML at all. `<!doctype` appearing anywhere is the
    // exact failure, and a `startsWith` check alone would pass on a page with a shebang comment in it.
    expect(body.toLowerCase()).not.toContain('<!doctype');
    expect(body.toLowerCase()).not.toContain('<html');
  });

  // ⛔ NO 404 ON THIS HOST. An unknown path must be the script, never the site's 404 page — that page is
  // HTML too, and a pipe cannot tell the difference between a 404 and a homepage.
  it.each(['/install.sh', '/latest/install.sh', '/nonsense', '/', '/SHA256SUMS/../oops'])(
    'serves the script for %s rather than falling through',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('#!/bin/sh');
    },
  );

  // ⚠ CONTENT NEGOTIATION IS ON Accept. curl sends `*/*`; a browser sends `text/html,…`.
  it('serves the script to curl and a page to a browser', async () => {
    expect(await (await get('/', { accept: '*/*' })).text()).toContain('#!/bin/sh');

    const page = await get('/', {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await page.text()).toContain('curl -fsSL https://get.tunnex.io | sh');
  });

  // ⛔ AMBIGUITY RESOLVES TO THE SCRIPT. Being wrong this way shows a human some shell; being wrong the
  // other way runs a web page on their machine.
  it('serves the script when Accept is absent', async () => {
    const res = await handleInstallHost(new Request(`https://${INSTALL_HOST}/`));
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toContain('#!/bin/sh');
  });

  // ⛔ THE ABSENT HEADER IS WHY THE BROKEN RESPONSE CACHED AS A HIT — and the same silence would pin a
  // stale installer after the next release.
  it('always sets Cache-Control explicitly', async () => {
    for (const path of ['/', '/SHA256SUMS']) {
      const res = await get(path);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
    }
  });

  // ⭐ THE CHECKSUM IS COMPUTED FROM THE BYTES SERVED, so it cannot drift from the script. A committed
  // sums file would fail on a correct script and teach customers the check is noise.
  it('publishes a SHA256SUMS that matches the script it serves', async () => {
    const script = await (await get('/')).text();
    const sums = await (await get('/SHA256SUMS')).text();

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
    const expected = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    expect(sums).toBe(`${expected}  get.sh\n`);
    // The format `sha256sum -c` parses: "<64 hex>  <filename>", exactly two spaces.
    expect(sums).toMatch(/^[0-9a-f]{64} {2}get\.sh\n$/);
  });

  it('refuses methods other than GET and HEAD', async () => {
    const res = await handleInstallHost(
      new Request(`https://${INSTALL_HOST}/`, { method: 'POST' }),
    );
    expect(res.status).toBe(405);
  });

  // ⚠ The script must be the REAL one, not a placeholder that happens to start with a shebang.
  it('serves the actual installer', async () => {
    const body = await (await get('/')).text();
    expect(body).toContain('TUNNEX_PUBLIC_ADDR');
    expect(body).toContain('TUNNEX_ENV: production');
    expect(body).toContain('FIRST RUN');
  });

  it('pins the manifest and images to the newest successful main CI commit', async () => {
    const body = await (await get('/')).text();
    expect(body).toContain('/actions/workflows/ci.yml/runs?branch=main&event=push&status=success');
    expect(body).toContain('VERSION="sha-$(printf \'%.7s\' "$SOURCE_COMMIT")"');
    expect(body).toContain('${RAW}/${SOURCE_REF}/deploy/tunnex.yml');
    expect(body).not.toContain('/releases/latest');
  });

  it('masks SMTP secret input and restores the terminal on every exit path', async () => {
    const body = await (await get('/')).text();
    const reader = body.slice(
      body.indexOf('# BEGIN MASKED SECRET READER'),
      body.indexOf('# END MASKED SECRET READER'),
    );
    expect(reader).toContain('stty raw -echo');
    expect(reader).toContain("printf '*' >&3");
    expect(reader).toContain("printf '\\b \\b' >&3");
    expect(reader).toContain("$(printf '\\177')");
    expect(reader).toContain("$(printf '\\010')");
    expect(reader).toContain("$(printf '\\003')");
    expect(reader.match(/stty "\$_saved"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(reader).not.toContain('ANSWER="$REPLY_RAW"');
  });

  // ⛔ THE FAILURE THAT COST THE MOST TIME, PINNED AS A CONFIG ASSERTION.
  //
  // Everything inspectable was correct — the deployed bundle contained the hostname check, Cloudflare's own
  // route list showed `get.tunnex.io/*` pointing at this script, DNS resolved — and requests still returned
  // the marketing homepage. The Worker was NEVER INVOKED: Workers Static Assets serves matching paths
  // directly, and `run_worker_first` was an ALLOW-LIST that did not include `/`.
  //
  // ⚠ A probe header proved it (no response on either hostname carried it) after four wrong hypotheses —
  // cache rules, DNS record type, route propagation, custom-domain conflict. The config was the cause the
  // whole time, so the config is what this asserts.
  it('runs the Worker before the assets layer for every path', async () => {
    const toml = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'),
    );
    expect(toml).toMatch(/^run_worker_first = true$/m);
  });
  // ⛔ THE ORPHANED HEREDOC. A string edit left the OLD .env body sitting after the new one's terminator, so
  // the script had TWO `EOF` lines: the first closed the heredoc and the second was executed as a command.
  // On the founder's box that was `sh: 678: EOF: not found`, after the install had already started.
  //
  // ⚠ NEITHER `sh -n` NOR `dash -n` CAUGHT IT, because the orphan is syntactically valid — which is exactly
  // why a syntax check is not a substitute for asserting the shape of the thing.
  it('has exactly one .env heredoc, correctly terminated', async () => {
    const script = await (await get('/')).text();
    const lines = script.split('\n');
    const opens = lines.filter((l) => l.startsWith('cat >.env <<EOF')).length;
    const closes = lines.filter((l) => l === 'EOF').length;
    expect(opens).toBe(1);
    expect(closes).toBe(1);
  });

  // ⛔ EVERY VARIABLE tunnex.yml MARKS REQUIRED MUST BE WRITTEN. Compose fails at INTERPOLATION when one is
  // missing — before it pulls a layer — and the installer reported that as "could not pull images", which
  // sent the operator to look at their registry and their docker group.
  it('writes every variable the compose file requires', async () => {
    const script = await (await get('/')).text();
    const env = script.slice(script.indexOf('cat >.env <<EOF'), script.indexOf('\nEOF'));
    for (const v of ['APP_BASE_URL', 'DATABASE_URL', 'POSTGRES_PASSWORD', 'TUNNEX_NODE_ENDPOINT']) {
      expect(env.split('\n').filter((l) => l.startsWith(`${v}=`)).length).toBe(1);
    }
  });

  // ⚠ AND IT VALIDATES BEFORE IT PULLS. `config -q` asks whether the file is complete where the answer is
  // cheap, so a future release requiring a new variable fails with a message about configuration rather
  // than one about images.
  it('validates the compose configuration before pulling', async () => {
    const script = await (await get('/')).text();
    expect(script).toContain('config -q');
    expect(script.indexOf('config -q')).toBeLessThan(script.indexOf('compose -f tunnex.yml pull'));
  });

  // ⛔ READINESS MUST MEAN THE DAEMON ANSWERS, NOT THAT THE CLI EXISTS.
  //
  // The check was `docker compose version`, which SUCCEEDS with no daemon access at all — it is a
  // client-side plugin query. So on a machine where Docker was installed by hand and the user was never
  // added to the `docker` group, readiness passed, the sudo fallback was never reached, and the install ran
  // all the way to `docker pull` before dying on the socket. `docker info` round-trips to the daemon.
  it('tests daemon reachability, not just the docker CLI', async () => {
    const script = await (await get('/')).text();
    const fn = script.slice(
      script.indexOf('docker_ready() {'),
      script.indexOf('resolve_docker() {'),
    );
    expect(fn).toContain('info');
    expect(fn).toContain('compose version');
  });

  // ⚠ AND THERE IS A LADDER, in increasing order of privilege: plain docker, then start the daemon, then
  // sudo. Each rung is a different failure with a different fix, and collapsing them loses the diagnosis.
  it('falls back to sudo when the daemon refuses this user', async () => {
    const script = await (await get('/')).text();
    const fn = script.slice(
      script.indexOf('resolve_docker() {'),
      script.indexOf('ensure_docker() {'),
    );
    expect(fn).toContain('systemctl start docker');
    expect(fn).toContain('DOCKER="sudo docker"');
    expect(fn).toContain('GROUP_FIX=1');
  });
});
