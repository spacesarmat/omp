// Decide whether a store job runs. Missing secrets skip with a notice and exit 0.
import { appendFileSync } from 'node:fs';
import { channelSkip } from './lib.mjs';

const channel = process.argv[2] || '';
const reason = channelSkip(channel, {
  token: process.env.CHANNEL_TOKEN || '',
  listed: process.env.CHANNEL_LISTED || '',
  repo: process.env.CHANNEL_REPO || '',
});
const output = process.env.GITHUB_OUTPUT;
if (reason) {
  console.log(`::notice::${reason}`);
  if (output) appendFileSync(output, 'skip=true\n');
} else if (output) {
  appendFileSync(output, 'skip=false\n');
}
process.exit(0);
