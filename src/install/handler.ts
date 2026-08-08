// Vite `?raw` import: the script is baked into the Worker bundle at build time, so serving it has no
// upstream that can fail. A proxy to GitHub raw would — and the failure mode of `curl | sh` against an
// upstream error page is arbitrary code.
import script from './get.sh?raw';

/**
 * The `get.tunnex.io` handler — everything `curl -fsSL https://get.tunnex.io | sh` touches.
 *
 * ## ⛔ THE SCRIPT IS THE DEFAULT RESPONSE. THE BROWSER PAGE IS THE EXCEPTION.
 *
 * That order is the whole safety property, and it was ruled after the opposite shipped for a few minutes:
 * a DNS record and a route went live with NO handler, so `/` fell through to the Astro adapter and returned
 * the marketing homepage — HTTP 200, `text/html` — to `curl … | sh`. A shell was handed a landing page and
 * asked to execute it.
 *
 * Enumerate what each ordering does when something goes wrong, and the choice makes itself:
 *
 * | failure                       | script-default            | page-default              |
 * |-------------------------------|---------------------------|---------------------------|
 * | content negotiation misreads  | browser sees plain text   | ⛔ shell executes HTML     |
 * | unknown path                  | script                    | ⛔ site 404 page → shell   |
 * | handler never matches         | ⛔ Astro HTML (see below)  | ⛔ Astro HTML             |
 *
 * Script-default fixes every cell it can reach. The last one it cannot, which is why the hostname check in
 * `src/worker.ts` runs BEFORE `server.fetch` and this host NEVER delegates to the Astro adapter — for any
 * path, including ones that do not exist.
 *
 * ## ⚠ CONTENT NEGOTIATION IS ON `Accept`, NOT `User-Agent`
 *
 * A UA string is spoofable, frequently absent, and varies across curl builds, wget, busybox, and every CI
 * runner. `Accept` is what the request actually ASKS FOR: browsers send `text/html,…`; curl sends a
 * wildcard.
 *
 * ⛔ AND AMBIGUITY RESOLVES TO THE SCRIPT. A missing or unparseable `Accept` is served the script, because
 * being wrong in that direction shows a human some shell, and being wrong in the other direction runs a web
 * page on their machine.
 */

/** The hostname this handler owns. Named once so worker.ts and the tests cannot disagree with it. */
export const INSTALL_HOST = 'get.tunnex.io';

const SCRIPT_FILENAME = 'get.sh';

/**
 * ⭐ THE CHECKSUM IS DERIVED FROM THE BYTES ACTUALLY SERVED, so SHA256SUMS cannot disagree with the script.
 *
 * A committed checksum file is a second copy of a fact, and second copies drift — the verify-before-you-run
 * instructions would then fail on a correct script, which teaches customers that the check is noise and to
 * skip it. Computing it here means the only way they differ is if the bytes differ, which is exactly what
 * the customer is checking for.
 *
 * Cached in module scope: a Worker isolate computes this once, not per request.
 */
let checksumPromise: Promise<string> | null = null;
function scriptChecksum(): Promise<string> {
  checksumPromise ??= (async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  })();
  return checksumPromise;
}

/**
 * ⛔ CACHE-CONTROL IS SET EXPLICITLY, AND THE ABSENT HEADER IS WHY.
 *
 * The broken response cached at the edge as `cf-cache-status: HIT` — so the wrong answer outlived the wrong
 * configuration, and retrying got the same HTML. The same silence would pin a stale installer after the
 * next release, which is worse: an out-of-date script installs an out-of-date product and looks like it
 * worked.
 *
 * Five minutes with `must-revalidate`: long enough that a launch spike does not hit the origin for every
 * request, short enough that a fix is live in minutes rather than whenever a cache decides.
 */
const CACHE = 'public, max-age=300, must-revalidate';

/** Does this request want a web page, as opposed to something a program will consume? */
function wantsHTML(request: Request): boolean {
  const accept = request.headers.get('accept');
  if (!accept) return false; // ⛔ ambiguous → script
  return accept.includes('text/html');
}

function scriptResponse(): Response {
  return new Response(script, {
    status: 200,
    headers: {
      // ⚠ `text/plain`, NEVER `application/x-sh`. A download-ish content type makes browsers offer a file
      // save dialog for a URL people are told to read before running — and reading it is the entire point
      // of publishing the verify instructions.
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': CACHE,
      // Names the artifact if someone does save it, without triggering a download on its own.
      'content-disposition': `inline; filename="${SCRIPT_FILENAME}"`,
      // The script is executed by whoever fetches it; nothing here should ever be framed or sniffed.
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

async function checksumResponse(): Promise<Response> {
  const sum = await scriptChecksum();
  // The exact format `sha256sum -c` expects: "<hash>  <filename>", two spaces.
  return new Response(`${sum}  ${SCRIPT_FILENAME}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': CACHE,
      'x-content-type-options': 'nosniff',
    },
  });
}

async function browserPage(): Promise<Response> {
  const sum = await scriptChecksum();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Install Tunnex</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:48px 20px;background:#0A0A0A;color:#EDEDEB;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.65}
main{max-width:680px;margin:0 auto}
h1{font-size:22px;margin:0 0 8px}
p{color:#A9A9A6;font-size:15px}
pre{background:#101010;border:1px solid #2E2E2E;border-radius:8px;padding:16px;overflow-x:auto;
  font-size:13px;color:#D6D6D2;white-space:pre-wrap;word-break:break-all}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
a{color:#EDEDEB}
h2{font-size:15px;margin:32px 0 8px;color:#EDEDEB}
</style></head>
<body><main>
<h1>Install Tunnex</h1>
<p>One command, on any machine with Docker and a public address.</p>
<pre><code>curl -fsSL https://get.tunnex.io | sh</code></pre>

<h2>Verify before you run it</h2>
<p>You are about to pipe a script into a shell. Check it first — this is the same artifact, and the
checksum below is computed from the exact bytes this page serves.</p>
<pre><code>curl -fsSL https://get.tunnex.io -o get.sh
curl -fsSL https://get.tunnex.io/SHA256SUMS -o SHA256SUMS
sha256sum -c SHA256SUMS --ignore-missing
less get.sh &amp;&amp; sh get.sh</code></pre>
<p>SHA-256 of <code>${SCRIPT_FILENAME}</code>:</p>
<pre><code>${sum}</code></pre>

<h2>Automation</h2>
<p>Every prompt has a default; <code>--yes</code> takes all of them and asks nothing.</p>
<pre><code>curl -fsSL https://get.tunnex.io | TUNNEX_PUBLIC_ADDR=vpn.acme.com sh -s -- --yes</code></pre>

<p><a href="https://tunnex.io/docs/quickstart/">Quickstart</a> ·
<a href="https://github.com/iotunnex/tunnex">Source</a></p>
</main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': CACHE },
  });
}

/**
 * handleInstallHost owns EVERY request to `get.tunnex.io`. It never returns null and never falls through —
 * that is the point. Returning null for an unrecognised path would hand it to the Astro adapter, which
 * would answer with the site's 404 page: HTML, HTTP 200-shaped, straight into a shell.
 */
export async function handleInstallHost(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  // ⚠ HEAD and GET only. A POST to an installer endpoint is nothing this should encourage or process, and
  // 405 is a correct answer that no shell will execute.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed\n', {
      status: 405,
      headers: { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' },
    });
  }

  if (/^\/SHA256SUMS\/?$/i.test(pathname)) return checksumResponse();

  // ⛔ EVERY OTHER PATH IS THE SCRIPT — including paths that do not exist. There is no 404 on this host:
  // a customer who mistypes the URL in a pipe gets a working installer, not a page.
  if (wantsHTML(request)) return browserPage();
  return scriptResponse();
}
