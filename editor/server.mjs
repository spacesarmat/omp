import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseEditorDraft } from './shared/draft.ts';
import { exportDraft } from './export.mjs';

const execute = promisify(execFile);
const MAX_BODY = 1024 * 1024;
const DRAFT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
}

function tokenMatches(actual, expected) {
  if (!actual || !actual.startsWith('Bearer ')) return false;
  const left = createHash('sha256').update(actual.slice(7)).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

async function body(request) {
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > MAX_BODY) {
    request.resume();
    throw new HttpError(413, 'BODY_TOO_LARGE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function draftFrom(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'JSON_REQUIRED');
  try {
    return parseEditorDraft(JSON.parse(await body(request)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_DRAFT');
  }
}

function draftPath(root, id) {
  if (!DRAFT_ID.test(id)) throw new HttpError(400, 'INVALID_DRAFT_ID');
  return join(root, '.omp-editor', 'drafts', `${id}.json`);
}

async function readDraft(root, id) {
  const path = draftPath(root, id);
  try {
    return parseEditorDraft(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') throw new HttpError(404, 'NOT_FOUND');
    throw new HttpError(400, 'INVALID_DRAFT');
  }
}

async function writeDraft(root, draft) {
  const path = draftPath(root, draft.id);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${draft.id}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(draft), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return draft;
}

async function gitState(root) {
  const { stdout: head } = await execute('git', ['rev-parse', 'HEAD'], { cwd: root });
  const { stdout: status } = await execute('git', ['status', '--porcelain', '--', 'design'], { cwd: root });
  return { baseCommit: head.trim(), dirtyDesign: status.trim().length > 0 };
}

function blockedStaticPath(url) {
  let path;
  try {
    path = decodeURIComponent(url.split('?')[0]);
  } catch {
    return true;
  }
  return path.split('/').some((segment) => segment === '.env' || segment.startsWith('.env.'));
}

export async function startEditorServer({ root, token = randomBytes(32).toString('base64url'), port = 0, withVite = true }) {
  let origin = '';
  let vite;
  if (withVite) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      configFile: join(root, 'editor', 'vite.config.ts'),
      appType: 'spa',
      logLevel: 'error',
      server: { middlewareMode: true },
    });
  }

  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') {
        json(response, 403, { error: 'FORBIDDEN' });
        return;
      }
      const url = new URL(request.url || '/', origin);
      if (!url.pathname.startsWith('/api/')) {
        if (blockedStaticPath(url.pathname) || !vite) json(response, 404, { error: 'NOT_FOUND' });
        else vite.middlewares(request, response);
        return;
      }
      if (url.pathname === '/api/health' && request.method === 'GET') {
        json(response, 200, { status: 'ok' });
        return;
      }
      if (!tokenMatches(request.headers.authorization, token)) {
        json(response, 401, { error: 'UNAUTHORIZED' });
        return;
      }
      if (url.pathname === '/api/state' && request.method === 'GET') {
        json(response, 200, await gitState(root));
        return;
      }
      if (url.pathname === '/api/export' && request.method === 'POST') {
        json(response, 200, await exportDraft({ root, draft: await draftFrom(request) }));
        return;
      }
      const match = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (request.method === 'GET') {
          json(response, 200, await readDraft(root, id));
          return;
        }
        if (request.method === 'PUT') {
          const draft = await draftFrom(request);
          if (draft.id !== id) throw new HttpError(400, 'DRAFT_ID_MISMATCH');
          json(response, 200, await writeDraft(root, draft));
          return;
        }
      }
      json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error && typeof error.status === 'number' ? error.status : 500;
      const code = error instanceof HttpError ? error.code : error && typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
      json(response, status, { error: code, ...(error && error.issues ? { issues: error.issues } : {}) });
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await vite?.close();
    throw new Error('Editor server did not bind a TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;

  let closed = false;
  return {
    origin,
    token,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise((resolveClose) => server.close(resolveClose));
      await vite?.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const running = await startEditorServer({ root: process.cwd(), withVite: true });
  console.log(`OMP Design Editor: ${running.origin}/#token=${running.token}`);
  process.once('SIGINT', async () => {
    await running.close();
    process.exit(0);
  });
}
