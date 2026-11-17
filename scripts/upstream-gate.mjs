// Guards for the TorrServer and 2160 Player update workflows.
//   node scripts/upstream-gate.mjs allow <branch>
//   node scripts/upstream-gate.mjs checks   (JSON array of {name,state} on stdin)
import { readFileSync } from 'node:fs';

const BOT_BRANCH = /^chore\/(?:torrserver|player2160)-[A-Za-z0-9._-]+$/;

export function branchMayAutoMerge(branch) {
  return BOT_BRANCH.test(String(branch || ''));
}

const DONE = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const BAD = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

const RUN_BAD = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

/**
 * Each expected workflow name must have a completed success and no failed run.
 * A missing or still running workflow waits.
 * @returns {'pass'|'fail'|'wait'}
 */
export function runsVerdict(runs, expected) {
  const names = (expected || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) return 'fail';
  const list = Array.isArray(runs) ? runs : [];
  for (const name of names) {
    const group = list.filter((r) => r && r.name === name);
    if (!group.length) return 'wait';
    if (group.some((r) => RUN_BAD.has(r.conclusion))) return 'fail';
    if (group.some((r) => r.status !== 'completed' || r.conclusion !== 'success')) return 'wait';
  }
  return 'pass';
}

/** @returns {'pass'|'fail'|'wait'} */
export function checksVerdict(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'wait';
  if (checks.some((c) => c && BAD.has(c.state))) return 'fail';
  if (checks.every((c) => c && DONE.has(c.state))) return 'pass';
  return 'wait';
}

const cmd = process.argv[2];
if (cmd === 'allow') {
  const branch = process.argv[3] || '';
  if (!branchMayAutoMerge(branch)) {
    console.error(`refusing auto-merge for ${branch || '(empty)'}`);
    process.exit(1);
  }
  process.exit(0);
}
if (cmd === 'checks') {
  const checks = JSON.parse(readFileSync(0, 'utf8') || '[]');
  process.stdout.write(checksVerdict(checks) + '\n');
}
if (cmd === 'runs') {
  const expected = String(process.env.EXPECTED || '').split(',').map((s) => s.trim()).filter(Boolean);
  const runs = JSON.parse(readFileSync(0, 'utf8') || '[]');
  process.stdout.write(runsVerdict(runs, expected) + '\n');
}
