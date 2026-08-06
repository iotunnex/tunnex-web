import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'public/favicon.svg');
const svg = readFileSync(svgPath);

const targets = [
  { file: 'public/favicon-32x32.png', size: 32 },
  { file: 'public/favicon.ico', size: 48 },
  { file: 'public/apple-touch-icon.png', size: 180 },
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
];

for (const target of targets) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: target.size } }).render().asPng();
  writeFileSync(join(root, target.file), png);
}

console.log('Successfully generated favicons (ico, png sizes)');
