import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD (S2.4 sign-off): the assets layer applies not_found_handling to
 * browser NAVIGATIONS instead of invoking the Worker, so every SSR route
 * (prerender = false) MUST appear in wrangler.toml's run_worker_first — or
 * browsers get the 404 page while curl gets the real response. This test
 * enumerates SSR routes from src/pages (route = file path; SSR = a literal
 * `prerender = false` export, which is this codebase's only form) and reds
 * the build when one isn't covered.
 */

const ROOT = join(__dirname, '..', '..');
const PAGES = join(ROOT, 'src', 'pages');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(astro|ts)$/.test(name)) yield p;
  }
}

function routeOf(file: string): string {
  let route = '/' + relative(PAGES, file).replace(/\\/g, '/');
  route = route.replace(/\.(astro|ts)$/, '');
  route = route.replace(/\/index$/, '') || '/';
  return route;
}

function ssrRoutes(): string[] {
  const routes: string[] = [];
  for (const file of walk(PAGES)) {
    const source = readFileSync(file, 'utf8');
    const isApi = routeOf(file).startsWith('/api/');
    const isSsr = /export\s+const\s+prerender\s*=\s*false/.test(source);
    if (isApi || isSsr) routes.push(routeOf(file));
  }
  return routes.sort();
}

/**
 * ⭐ `run_worker_first = true` COVERS EVERY ROUTE, so it satisfies this guard by construction.
 *
 * The setting takes either a list of path globs or the boolean. It became the boolean when `get.tunnex.io`
 * was added: that host must reach the Worker for EVERY path — including ones that do not exist, because a
 * fall-through to `not_found_handling = "404-page"` returns the site's 404 as HTML, and that HTML goes into
 * `curl … | sh`. run_worker_first is path-scoped, not host-scoped, so covering every path on one hostname
 * means covering every path.
 *
 * ⚠ THIS GUARD STILL EARNS ITS KEEP. If the boolean is ever narrowed back to a list, every assertion below
 * starts checking that list again — so the SSR routes cannot silently lose coverage on the way back.
 */
function runWorkerFirstCoversEverything(): boolean {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  return /^run_worker_first\s*=\s*true\s*$/m.test(toml);
}

function runWorkerFirstPatterns(): string[] {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const match = toml.match(/run_worker_first\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Conservative matcher: `*` is greedy (Cloudflare glob); exact needs exact. */
function covered(route: string, patterns: string[]): boolean {
  if (runWorkerFirstCoversEverything()) return true;
  return patterns.some((pattern) => {
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
      return re.test(route) || re.test(route + '/');
    }
    return pattern === route || pattern === route + '/';
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('run_worker_first covers every SSR route', () => {
  const patterns = runWorkerFirstPatterns();
  const routes = ssrRoutes();

  // ⛔ THE VACUITY FLOOR. Without it this suite passes the day the route walk stops finding files, or the
  // toml parse silently returns nothing — reporting "every SSR route is covered" about zero routes.
  it('found a coverage declaration and at least the known SSR routes', () => {
    // Either form is a real declaration: the boolean covers everything, a list must be non-empty.
    expect(runWorkerFirstCoversEverything() || patterns.length > 0).toBe(true);
    expect(routes).toEqual(expect.arrayContaining(['/api/subscribe', '/api/enterprise-lead']));
  });

  for (const route of routes) {
    it(`${route} is covered (add it to wrangler.toml run_worker_first)`, () => {
      expect(covered(route, patterns)).toBe(true);
    });
  }
});
