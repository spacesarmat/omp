// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startEditorServer, type RunningEditorServer } from '../../editor/server.mjs';
import { createDefaultDraft } from '../../editor/shared/draft';

const execute = promisify(execFile);
const roots: string[] = [];
const runningServers: RunningEditorServer[] = [];

async function makeRepo(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'omp-editor-server-'));
  roots.push(root);
  await execute('git', ['init', '--quiet'], { cwd: root });
  await mkdir(join(root, 'design'), { recursive: true });
  await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial'], { cwd: root });
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, head: stdout.trim() };
}

async function openServer(root: string): Promise<RunningEditorServer> {
  const running = await startEditorServer({ root, token: 'test-token', port: 0, withVite: false });
  runningServers.push(running);
  return running;
}

function request(running: RunningEditorServer, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer test-token');
  return fetch(running.origin + path, { ...init, headers });
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('editor loopback server', () => {
  it('serves health and git state only to authorized API callers', async () => {
    const { root, head } = await makeRepo();
    const running = await openServer(root);
    const health = await request(running, '/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    const state = await request(running, '/api/state');
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ baseCommit: head, dirtyDesign: false });
    expect((await fetch(running.origin + '/api/state')).status).toBe(401);
    expect((await request(running, '/api/state', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await request(running, '/api/state', { headers: { Origin: 'https://attacker.invalid' } })).status).toBe(403);
  });

  it('round-trips a valid draft atomically and supports repeated writes', async () => {
    const { root, head } = await makeRepo();
    const running = await openServer(root);
    const draft = createDefaultDraft('draft-1', head);
    for (let count = 0; count < 2; count += 1) {
      const response = await request(running, '/api/drafts/draft-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      expect(response.status).toBe(200);
    }
    const response = await request(running, '/api/drafts/draft-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(await readdir(join(root, '.omp-editor', 'drafts'))).toEqual(['draft-1.json']);
  });

  it('rejects traversal and invalid draft ids without touching outside files', async () => {
    const { root, head } = await makeRepo();
    const running = await openServer(root);
    await writeFile(join(root, '.env'), 'TEST_ONLY=1', { mode: 0o600 });
    const traversal = await request(running, '/api/drafts/..%2F..%2F.env');
    expect([400, 404]).toContain(traversal.status);
    expect(await traversal.text()).not.toContain('TEST_ONLY');
    const invalid = await request(running, '/api/drafts/bad_id', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createDefaultDraft('draft-1', head)) });
    expect([400, 404]).toContain(invalid.status);
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('TEST_ONLY=1');
  });

  it('rejects oversized and non-JSON bodies', async () => {
    const { root, head } = await makeRepo();
    const running = await openServer(root);
    const large = await request(running, '/api/drafts/draft-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1024 * 1024 + 100) }),
    });
    expect(large.status).toBe(413);
    const wrongType = await request(running, '/api/drafts/draft-1', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(createDefaultDraft('draft-1', head)) });
    expect(wrongType.status).toBe(415);
  });

  it('rejects invalid documents without replacing the previous draft', async () => {
    const { root, head } = await makeRepo();
    const running = await openServer(root);
    const draft = createDefaultDraft('draft-1', head);
    await request(running, '/api/drafts/draft-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
    const extra = await request(running, '/api/drafts/draft-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, extra: true }) });
    expect(extra.status).toBe(400);
    const badTheme = createDefaultDraft('draft-1', head);
    badTheme.theme.tokens['--omp-color-accent'] = 'url(javascript:alert(1))';
    const invalid = await request(running, '/api/drafts/draft-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(badTheme) });
    expect(invalid.status).toBe(400);
    expect(await (await request(running, '/api/drafts/draft-1')).json()).toEqual(draft);
  });

  it('serves committed designs and rebases drafts through authorized API routes', async () => {
    const { root, head: initialHead } = await makeRepo();
    const running = await openServer(root);
    await expect((await request(running, '/api/design')).json()).resolves.toEqual({ design: null });
    expect((await fetch(running.origin + '/api/design')).status).toBe(401);

    const saved = createDefaultDraft('draft-1', initialHead);
    saved.theme.name = 'From Git';
    await mkdir(join(root, 'design/themes'), { recursive: true });
    await mkdir(join(root, 'design/flows'), { recursive: true });
    await writeFile(join(root, 'design/themes/default.json'), JSON.stringify(saved.theme));
    await writeFile(join(root, 'design/flows/desktop-default.json'), JSON.stringify(saved.flow));
    await execute('git', ['add', 'design'], { cwd: root });
    await execute('git', ['-c', 'user.name=OMP Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'design'], { cwd: root });
    const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
    const designHead = stdout.trim();

    const designResponse = await request(running, '/api/design');
    expect(designResponse.status).toBe(200);
    expect(await designResponse.json()).toMatchObject({ design: { baseCommit: designHead, theme: { name: 'From Git' } } });
    const local = createDefaultDraft('draft-1', initialHead);
    local.theme.overrides.push({ id: 'local', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#112233' } });
    const rebaseResponse = await request(running, '/api/rebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    });
    expect(rebaseResponse.status).toBe(200);
    expect(await rebaseResponse.json()).toMatchObject({
      draft: { baseCommit: designHead, theme: { name: 'From Git', overrides: [{ id: 'local' }] } },
      changes: ['design/flows/desktop-default.json', 'design/themes/default.json'],
    });
    expect((await fetch(running.origin + '/api/rebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    })).status).toBe(401);
  });

  it('returns not found for missing drafts, env files and command endpoints', async () => {
    const { root } = await makeRepo();
    const running = await openServer(root);
    expect((await request(running, '/api/drafts/missing')).status).toBe(404);
    expect((await request(running, '/.env')).status).toBe(404);
    expect((await request(running, '/api/exec', { method: 'POST' })).status).toBe(404);
    expect((await request(running, '/api/push', { method: 'POST' })).status).toBe(404);
  });
});
