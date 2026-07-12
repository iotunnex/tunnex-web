// S3B.2: build-time OG card generation (satori + resvg — native deps run
// only here, never in the Workers runtime). One 1200×630 card per published
// blog post plus a default card for the blog index, written to public/og/
// before `astro build` picks them up as static assets.
//
// Brand surface: OG cards use the dark-mode brand artwork (vertical lockup —
// the S4.2-ledgered source) on the dark neutral ground. Raw color values are
// allowed here: this is not src/ (token guard scope) and the palette mirrors
// the fixed-color brand SVGs.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const fonts = [
  {
    name: 'Inter',
    weight: 400,
    path: 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff',
  },
  {
    name: 'Inter',
    weight: 700,
    path: 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff',
  },
].map((f) => ({
  name: f.name,
  weight: f.weight,
  style: 'normal',
  data: readFileSync(join(root, f.path)),
}));

const svgDataUri = (file) =>
  `data:image/svg+xml;base64,${readFileSync(join(root, 'src/assets', file)).toString('base64')}`;
const mark = svgDataUri('logo.svg');
const wordmark = svgDataUri('wordmark.svg');

// Dark brand ground (matches the site's dark surface family).
const BG = '#0a1220';
const MUTED = '#9fb1c7';
const ACCENT = '#22d3ee';

function card({ title, eyebrow }) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        backgroundColor: BG,
        color: '#ffffff',
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '20px',
            },
            children: [
              { type: 'img', props: { src: mark, width: 84, height: 80 } },
              { type: 'img', props: { src: wordmark, width: 231, height: 35 } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '16px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '24px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    color: ACCENT,
                  },
                  children: eyebrow.toUpperCase(),
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: title.length > 55 ? '52px' : '64px',
                    fontWeight: 700,
                    lineHeight: 1.15,
                    letterSpacing: '-0.02em',
                    maxWidth: '1000px',
                  },
                  children: title,
                },
              },
              {
                type: 'div',
                props: { style: { fontSize: '26px', color: MUTED }, children: 'tunnex.io' },
              },
            ],
          },
        },
      ],
    },
  };
}

async function renderPng(node, outPath) {
  const svg = await satori(node, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
}

function blogPosts() {
  const dir = join(root, 'src/content/blog');
  return readdirSync(dir)
    .filter((f) => /\.(md|mdx)$/.test(f))
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8');
      const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const title = fm.match(/^title:\s*['"]?(.*?)['"]?\s*$/m)?.[1] ?? '';
      const draft = /^draft:\s*true\s*$/m.test(fm);
      return { slug: f.replace(/\.(md|mdx)$/, ''), title, draft };
    })
    .filter((p) => !p.draft && p.title);
}

const outDir = join(root, 'public/og/blog');
await renderPng(
  card({
    title: 'Engineering notes, release news, and zero-trust networking write-ups',
    eyebrow: 'Blog',
  }),
  join(outDir, '_index.png'),
);
for (const post of blogPosts()) {
  await renderPng(card({ title: post.title, eyebrow: 'Blog' }), join(outDir, `${post.slug}.png`));
}
console.log(`OG cards generated: ${blogPosts().length + 1} → public/og/blog/`);
