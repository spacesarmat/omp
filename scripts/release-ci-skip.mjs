// Decide whether a release may skip npm test.
// stdin: JSON from `gh run list --workflow ci.yml --json conclusion,event,headSha`
// argv: the commit the release is building
// stdout: skip=true when that commit already has a successful CI push, otherwise skip=false
import { readFileSync } from 'node:fs';

const sha = process.argv[2] || '';
const runs = JSON.parse(readFileSync(0, 'utf8'));
const passed = Array.isArray(runs) && runs.some((run) =>
  run && run.conclusion === 'success' && run.event === 'push' && run.headSha === sha,
);
process.stdout.write(passed ? 'skip=true\n' : 'skip=false\n');
