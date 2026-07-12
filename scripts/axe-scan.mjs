// S4.1: axe accessibility scan over every public page (CI gate). Boots the
// built site through `wrangler dev` (so SSR routes render), visits each URL in
// both themes, and fails on any WCAG 2a/2aa violation. Run after `pnpm build`.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;

// Every public, indexable surface + the key SSR states. Utility/no-index pages
// (styleguide) are excluded; SSR form pages render their default state.
const PAGES = [
  '/',
  '/pricing',
  '/download',
  '/security',
  '/enterprise',
  '/trial',
  '/blog',
  '/blog/hello-tunnex/',
  '/blog/tag/announcements/',
  '/subscribe/confirm?token=x', // invalid state — no writes
  '/trial/verify?token=x', // invalid state
  '/404',
];

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const dev = spawn(
  'pnpm',
  [
    'exec',
    'wrangler',
    'dev',
    '--local',
    '--port',
    String(PORT),
    '--var',
    'TURNSTILE_SECRET:1x0000000000000000000000000000000AA',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

async function waitReady(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('wrangler dev did not become ready');
}

let failures = 0;
try {
  await waitReady();
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ colorScheme: theme });
    if (theme === 'light') {
      await context.addInitScript(() => {
        localStorage.setItem('theme', 'light');
        localStorage.setItem('starlight-theme', 'light');
      });
    }
    const page = await context.newPage();
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForTimeout(300);
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      if (violations.length) {
        failures += violations.length;
        console.log(`\n✗ ${theme} ${path}`);
        for (const v of violations) {
          console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
          for (const n of v.nodes) console.log(`    ${n.target.join(' ')}`);
        }
      } else {
        console.log(`✓ ${theme} ${path}`);
      }
    }
    await context.close();
  }
  await browser.close();
} finally {
  dev.kill('SIGTERM');
}

if (failures) {
  console.error(`\naxe: ${failures} violation group(s) found`);
  process.exit(1);
}
console.log('\naxe: clean across all pages, both themes');
