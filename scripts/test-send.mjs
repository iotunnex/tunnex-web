// Gate-1 test-send helper: hits the TEMPORARY /api/test-send endpoint on a
// deployed version (the EMAIL binding only exists there — local dev has no
// Cloudflare credentials). Reads TEST_SEND_KEY from .dev.vars.
//
//   node scripts/test-send.mjs <base-url> <recipient>
import { readFileSync } from 'node:fs';

const [base, to] = process.argv.slice(2);
if (!base || !to) {
  console.error('usage: node scripts/test-send.mjs <base-url> <recipient>');
  process.exit(1);
}
const devVars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const key = devVars.match(/^TEST_SEND_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error('TEST_SEND_KEY not found in .dev.vars');
  process.exit(1);
}
const res = await fetch(`${base}/api/test-send`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Test-Send-Key': key,
    Origin: base,
  },
  body: JSON.stringify({ to }),
});
console.log(res.status, JSON.stringify(await res.json(), null, 1));
