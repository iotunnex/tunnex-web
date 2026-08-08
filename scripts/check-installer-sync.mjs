import { readFile } from 'node:fs/promises';

const local = await readFile(new URL('../src/install/get.sh', import.meta.url), 'utf8');
const upstreamUrl = 'https://raw.githubusercontent.com/iotunnex/tunnex/main/deploy/get.sh';
const response = await fetch(upstreamUrl, {
  headers: process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : undefined,
});

if (!response.ok) {
  throw new Error(
    `Could not read the core main installer (${response.status} ${response.statusText})`,
  );
}

const upstream = await response.text();
if (local !== upstream) {
  throw new Error(
    'src/install/get.sh differs from tunnex main deploy/get.sh. Sync the exact core installer before deploying the website.',
  );
}

console.log('Installer matches tunnex main deploy/get.sh byte-for-byte.');
