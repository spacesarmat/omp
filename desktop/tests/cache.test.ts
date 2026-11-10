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

function stepName(step: string) {
  return step.match(/^ {6}- name: (.+)$/m)?.[1];
}

function restoreKeys(step: string) {
  const block = step.match(/^ {10}restore-keys: \|\n((?: {12}[^\n]*\n?)*)/m)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

      const gate = "needs.changes.outputs.desktop == 'true' && ";
      const cachedInstalls = steps.filter(
        (step) => field(step, 'run') === `npm install ${directory}--prefer-offline --no-audit --no-fund`,
      );
      const cleanInstalls = steps.filter((step) => {
        const cond = field(step, 'if');
        return (
          field(step, 'run') === `npm ci ${directory}`.trim() &&
          (cond === `steps.${id}.outputs.cache-hit != 'true'` ||
            cond === `${gate}steps.${id}.outputs.cache-hit != 'true'`)
        );
      });
      expect(cachedInstalls).toHaveLength(2);
      expect(cleanInstalls).toHaveLength(2);

      for (const step of cachedInstalls) {
        const cond = field(step, 'if');
        expect(cond === `steps.${id}.outputs.cache-hit == 'true'` || cond === `${gate}steps.${id}.outputs.cache-hit == 'true'`).toBe(true);
      }
      for (const step of cleanInstalls) {
        const cond = field(step, 'if');
        expect(cond === `steps.${id}.outputs.cache-hit != 'true'` || cond === `${gate}steps.${id}.outputs.cache-hit != 'true'`).toBe(true);
      }
    }

    const lockfileChecks = steps.filter(
      (step) => field(step, 'run') === 'git diff --exit-code -- package-lock.json desktop/package-lock.json',
    );
    expect(lockfileChecks).toHaveLength(2);
  });
});

describe('cargo CI caching', () => {
  it('desktop.yml keeps smoke and package-windows cargo caches separate', () => {
    const steps = workflowSteps('desktop.yml');
    const cargoCaches = steps.filter((step) => stepName(step) === 'Cache Cargo');
    expect(cargoCaches).toHaveLength(2);

    const cargoKey = (profile: string) =>
      `\${{ runner.os }}-cargo-${profile}-\${{ steps.rust-version.outputs.version }}-\${{ hashFiles('desktop/src-tauri/Cargo.lock') }}`;
    const cargoRestoreKey = (profile: string) =>
      `\${{ runner.os }}-cargo-${profile}-\${{ steps.rust-version.outputs.version }}-`;

    for (const [index, profile] of ['smoke', 'release'].entries()) {
      const cache = cargoCaches[index];
      expect(field(cache, 'key')).toBe(cargoKey(profile));
      expect(restoreKeys(cache)).toEqual([cargoRestoreKey(profile)]);
      expect(cache).not.toContain(`-cargo-${profile === 'smoke' ? 'release' : 'smoke'}-`);
    }
  });
});
