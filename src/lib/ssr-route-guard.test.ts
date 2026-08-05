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

function runWorkerFirstPatterns(): string[] {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const match = toml.match(/run_worker_first\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Conservative matcher: `*` is greedy (Cloudflare glob); exact needs exact. */
function covered(route: string, patterns: string[]): boolean {
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

  it('found the pattern list and at least the known SSR routes', () => {
    expect(patterns.length).toBeGreaterThan(0);
    expect(routes).toEqual(expect.arrayContaining(['/api/subscribe', '/api/enterprise-lead']));
  });

  for (const route of routes) {
    it(`${route} is covered (add it to wrangler.toml run_worker_first)`, () => {
      expect(covered(route, patterns)).toBe(true);
    });
  }
});
