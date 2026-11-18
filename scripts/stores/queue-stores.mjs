// Print "QUEUE <tag>" for a stable release tag. Anything else is a notice and exit 0.
import { parseReleaseTag } from './lib.mjs';

const tag = process.argv[2] || '';
const parsed = parseReleaseTag(tag);
if (!parsed.stable) {
  const label = tag || '(empty)';
  console.log(`::notice::${label} is not a stable release. Store channels stay on stable releases.`);
  process.exit(0);
}
console.log(`QUEUE ${parsed.tag}`);
