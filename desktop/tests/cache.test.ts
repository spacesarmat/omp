import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workflows = ['desktop.yml', 'ci.yml'];

function workflowSteps(file: string) {
  const modulePath = fileURLToPath(import.meta.url);
  const path = resolve(dirname(modulePath), '../../.github/workflows', file);
  return readFileSync(path, 'utf8')
    .split(/^ {6}- /m)
    .slice(1)
    .map((step) => `      - ${step}`);
}

function field(step: string, name: string) {
  return step.match(new RegExp(`^ {8}(?: {2})?${name}: (.+)$`, 'm'))?.[1];
}

describe('node_modules CI caching', () => {
  it.each(workflows)('%s selects the exact install command for each cache result', (file) => {
    const steps = workflowSteps(file);

    for (const [scope, directory, lockfile] of [
      ['root', '', 'package-lock.json'],
      ['desktop', '--prefix desktop ', 'desktop/package-lock.json'],
    ] as const) {
      const id = `${scope}-node-modules`;
      const caches = steps.filter((step) => field(step, 'id') === id);
      expect(caches).toHaveLength(2);

      for (const cache of caches) {
        expect(cache).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
        expect(field(cache, 'path')).toBe(directory ? 'desktop/node_modules' : 'node_modules');
        expect(field(cache, 'key')).toBe(
          `\${{ runner.os }}-node24-${scope}-modules-\${{ hashFiles('${lockfile}') }}`,
        );
        expect(cache).toContain(`\${{ runner.os }}-node24-${scope}-modules-`);
      }

      const cachedInstalls = steps.filter(
        (step) => field(step, 'run') === `npm install ${directory}--prefer-offline --no-audit --no-fund`,
      );
      const cleanInstalls = steps.filter(
        (step) =>
          field(step, 'run') === `npm ci ${directory}`.trim() &&
          field(step, 'if') === `steps.${id}.outputs.cache-hit != 'true'`,
      );
      expect(cachedInstalls).toHaveLength(2);
      expect(cleanInstalls).toHaveLength(2);

      for (const step of cachedInstalls) {
        expect(field(step, 'if')).toBe(`steps.${id}.outputs.cache-hit == 'true'`);
      }
      for (const step of cleanInstalls) {
        expect(field(step, 'if')).toBe(`steps.${id}.outputs.cache-hit != 'true'`);
      }
    }

    const lockfileChecks = steps.filter(
      (step) => field(step, 'run') === 'git diff --exit-code -- package-lock.json desktop/package-lock.json',
    );
    expect(lockfileChecks).toHaveLength(2);
  });
});
