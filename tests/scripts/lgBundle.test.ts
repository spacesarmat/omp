import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { existsSync, readFileSync } from 'node:fs';
// @ts-ignore node builtin, no @types/node in this project
import { dirname, join, resolve } from 'node:path';

// The LG bundle (src/main.tsx) must not statically reach the site parsers: they are loaded with a dynamic import on
// Android TV only (vite makes them a separate chunk). Walks the static imports of the entry point.
const PARSERS = ['rutor', 'nnmclub', 'rutracker', 'anidub', 'bigfangroup', 'torrentby', 'builtin'].map((n) => resolve('src/sources', n + '.ts'));

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c)) return c;
  return null;
}

/** Files reachable from `entry` through static `import … from` / `export … from` (dynamic import() and type-only imports do not count). */
function staticGraph(entry: string): string[] {
  const seen: { [f: string]: true } = {};
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen[f]) continue;
    seen[f] = true;
    const src = readFileSync(f, 'utf8');
    const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m[1]) continue;
      const r = resolveImport(f, m[2]);
      if (r) todo.push(r);
    }
  }
  return Object.keys(seen);
}

describe('LG bundle', () => {
  it('has no site parser in the static import graph of the TV entry', () => {
    const graph = staticGraph(resolve('src/main.tsx'));
    expect(graph.length).toBeGreaterThan(20);
    const hit = PARSERS.filter((p) => graph.indexOf(p) >= 0);
    expect(hit).toEqual([]);
  });

  it('the Android TV entry loads the parsers with a dynamic import', () => {
    const main = readFileSync(resolve('src/main.tsx'), 'utf8');
    expect(main).toMatch(/import\('\.\/sources\/builtin'\)/);
    expect(main).toMatch(/platformKind\(\) === 'androidtv'/);
  });
});
