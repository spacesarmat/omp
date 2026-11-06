import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function git(cwd, args) {
  return spawnSync('git', args, { cwd, stdio: 'ignore' });
}

export function pushWithRebase(cwd) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (git(cwd, ['push', 'origin', 'gh-pages']).status === 0) return;
    if (git(cwd, ['pull', '--rebase', 'origin', 'gh-pages']).status !== 0) {
      throw new Error('git pull --rebase failed while publishing gh-pages');
    }
  }
  throw new Error('git push failed after four gh-pages attempts');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  pushWithRebase(process.argv[2] ? resolve(process.argv[2]) : process.cwd());
}
