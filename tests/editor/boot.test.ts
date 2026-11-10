// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

let child: ChildProcess | undefined;

function stop(): Promise<void> {
  if (!child || child.killed) return Promise.resolve();
  const process = child;
  child = undefined;
  return new Promise((resolve) => {
    process.once('exit', () => resolve());
    process.kill('SIGINT');
  });
}

afterEach(stop);

describe('editor CLI boot', () => {
  it('serves editor and preview, protects env and closes the port', async () => {
    child = spawn(process.execPath, ['editor/server.mjs'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const address = await new Promise<{ origin: string; token: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('EDITOR_START_TIMEOUT')), 30000);
      child!.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        const match = output.match(/OMP Design Editor: (http:\/\/127\.0\.0\.1:\d+)\/#token=([A-Za-z0-9_-]+)/);
        if (!match) return;
        clearTimeout(timeout);
        resolve({ origin: match[1], token: match[2] });
      });
      child!.once('error', reject);
      child!.once('exit', (code) => {
        if (code) reject(new Error(`EDITOR_EXIT_${code}`));
      });
    });

    const home = await fetch(address.origin + '/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('OMP Design Editor');
    const preview = await fetch(address.origin + '/preview.html');
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('/src/preview/main.tsx');

    const state = await fetch(address.origin + '/api/state', { headers: { Authorization: `Bearer ${address.token}` } });
    expect(state.status).toBe(200);
    const body = await state.json() as { baseCommit: string };
    expect(body.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect((await fetch(address.origin + '/api/state')).status).toBe(401);
    expect((await fetch(address.origin + '/.env')).status).toBe(404);
    expect((await fetch(address.origin + `/@fs/${process.cwd()}/.env`)).status).toBe(404);

    await stop();
    await expect(fetch(address.origin + '/api/health')).rejects.toThrow();
  }, 45000);
});
