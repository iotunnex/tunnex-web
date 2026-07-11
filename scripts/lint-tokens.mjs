// Token guard (standing CI check): every color on the site must come from the
// semantic token layer in src/styles/tokens.css. Red build when any other
// source file contains:
//   1. a raw hex color        (#0A1220, #fff)
//   2. a raw oklch()/rgb()/hsl() value
//   3. a primitive token      (--p-*)
//   4. a Tailwind default-palette class (bg-zinc-900, text-cyan-400, …) —
//      the default palette is disabled in theme.css, so these silently no-op.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIR = join(ROOT, 'src');
const THEME_FILES = new Set([
  join(ROOT, 'src/styles/tokens.css'), // raw values (primitives + semantic layer)
  join(ROOT, 'src/styles/theme.css'), // Tailwind mapping over tokens.css
  // Email clients cannot resolve CSS custom properties — emails inline fixed
  // colors by design, single-sourced in this one file (mirrors light tokens).
  join(ROOT, 'src/lib/email/palette.ts'),
  // Brand marks are fixed-color by design (founder decision: dark mode shows
  // the original indigo/purple assets). Narrow, explicit file list — never a
  // blanket asset exclusion. logo-lockup-light.svg is tokenized and NOT here.
  join(ROOT, 'src/assets/logo.svg'),
  join(ROOT, 'src/assets/wordmark.svg'),
  join(ROOT, 'src/assets/logo-lockup-dark.svg'),
]);
const EXTENSIONS = /\.(astro|css|ts|tsx|js|mjs|jsx|html|svg|md|mdx)$/;

const TAILWIND_PALETTE =
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)';

const RULES = [
  { name: 'raw hex color', re: /#[0-9a-fA-F]{3,8}\b(?![0-9a-zA-Z-])/g },
  { name: 'raw color function', re: /\b(?:oklch|oklab|rgb|rgba|hsl|hsla)\(/g },
  { name: 'primitive token reference', re: /--p-[a-z0-9-]+/g },
  {
    name: 'Tailwind default-palette class',
    re: new RegExp(
      `\\b(?:bg|text|border|ring|outline|fill|stroke|decoration|divide|accent|caret|shadow|from|via|to)-${TAILWIND_PALETTE}-\\d{2,3}\\b`,
      'g',
    ),
  },
  {
    // SVG paints must stay themeable: currentColor, var(--color-*), none,
    // transparent, url(#...), or a token utility class — never a literal color.
    name: 'hardcoded SVG paint',
    re: /\b(?:fill|stroke)="(?!none|currentColor|transparent|url\(|var\()[^"{]+"/g,
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXTENSIONS.test(name)) yield p;
  }
}

const violations = [];
for (const file of walk(SCAN_DIR)) {
  if (THEME_FILES.has(file)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      const m = line.match(rule.re);
      if (m) {
        violations.push(`${relative(ROOT, file)}:${i + 1}  ${rule.name}: ${m.join(', ')}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    'Token guard FAILED — colors must come from src/styles/theme.css semantic tokens:\n',
  );
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Token guard passed: no raw colors or primitive tokens outside the token files.');
