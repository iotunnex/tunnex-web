import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const fonts = [
  {
    name: 'Inter',
    weight: 700,
    style: 'normal',
    data: readFileSync(join(root, 'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff')),
  },
];

const logoSvg = readFileSync(join(root, 'src/assets/tunnex-logo.svg')).toString('base64');
const logoUri = `data:image/svg+xml;base64,${logoSvg}`;

const wordmarkSvg = readFileSync(join(root, 'src/assets/tunnex-wordmark-light.svg')).toString('base64');
const wordmarkUri = `data:image/svg+xml;base64,${wordmarkSvg}`;

// Combined Horizontal Lockup for Email Header (352x44 @ 2x -> 176x22 display)
const node = {
  type: 'div',
  props: {
    style: {
      width: '352px',
      height: '44px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      backgroundColor: 'transparent',
    },
    children: [
      {
        type: 'img',
        props: {
          src: logoUri,
          width: 36,
          height: 34,
        },
      },
      {
        type: 'img',
        props: {
          src: wordmarkUri,
          width: 180,
          height: 28,
        },
      },
    ],
  },
};

async function buildEmailLogo() {
  const svg = await satori(node, { width: 352, height: 44, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 352 } }).render().asPng();
  mkdirSync(join(root, 'public/email'), { recursive: true });
  writeFileSync(join(root, 'public/email/tunnex-logo-2x.png'), png);
  console.log('Successfully generated public/email/tunnex-logo-2x.png');
}

buildEmailLogo().catch(console.error);
