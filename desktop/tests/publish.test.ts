import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function workflowStep(file: string, name: string) {
  const modulePath = fileURLToPath(import.meta.url);
  const path = resolve(dirname(modulePath), '../../.github/workflows', file);
  const step = readFileSync(path, 'utf8')
    .split(/^ {6}- /m)
    .slice(1)
    .map((block) => `      - ${block}`)
    .find((block) => block.match(/^ {6}- name: (.+)$/m)?.[1] === name);
  expect(step, `step "${name}" in ${file}`).toBeDefined();
  return step ?? '';
}

describe('desktop publish workflow', () => {
  it('lets the gh-pages 404 reach the catch when the feed is missing', () => {
    const step = workflowStep('desktop.yml', 'Publish release asset and feed');
    const lookup = step.match(
      /gh api "repos\/\$\{\{ github\.repository \}\}\/contents\/update-windows\.json\?ref=gh-pages" --jq \.sha (2>[^\s]+)/,
    );

    expect(lookup, 'feed sha lookup must keep stderr visible for the catch').toBeTruthy();
    expect(lookup?.[1]).toBe('2>&1');
    expect(step).not.toContain('2>$null');
  });
});
