// Usage:
//   node scripts/torrserver-sanity.mjs <current tag> <release.json>
//   node scripts/torrserver-sanity.mjs --summary <release.json>
// Exit 0: the release is a sane newer stable pin. Exit 2: skip it (the workflow must not open a PR).
import { readFileSync } from 'node:fs';
import { assessRelease, releaseSummary } from './torrserver-lib.mjs';

if (process.argv[2] === '--summary') {
  const release = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  console.log(releaseSummary(release.body || ''));
  process.exit(0);
}

const current = process.argv[2] || '';
const release = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const verdict = assessRelease(release, current);
if (!verdict.ok) {
  console.error(verdict.reason);
  process.exit(2);
}
console.log('ok');
