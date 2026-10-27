import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function call(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; headers: IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body
          ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('billing HTTP methods', () => {
  let child: ChildProcess;
  let port = 0;

  beforeAll(async () => {
    child = spawn(process.execPath, ['ops/billing/test/serve.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
    port = await new Promise<number>((resolve, reject) => {
      let buf = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) resolve(Number(buf.slice(0, nl)));
      });
      child.once('exit', (code) => reject(new Error('billing test server exited ' + code)));
    });
  });

  afterAll(async () => {
    child.kill();
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  });

  it('GET /health is 200 and HEAD /health repeats it with an empty body', async () => {
    const get = await call(port, 'GET', '/health');
    expect(get.status).toBe(200);
    const health = JSON.parse(get.body);
    expect(health.ok).toBe(true);
    expect(Object.keys(health).sort()).toEqual(['botPollEnabled', 'botPollOkAgoSec', 'monitorAgoSec', 'monitorIntervalMin', 'monitorScheduled', 'ok']);
    expect(get.headers['content-type']).toContain('application/json');

    const head = await call(port, 'HEAD', '/health');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(get.body)));
    expect(head.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /admin is 200 and HEAD /admin is the same response without a body', async () => {
    const get = await call(port, 'GET', '/admin');
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toContain('text/html');
    expect(get.body.length).toBeGreaterThan(0);

    const head = await call(port, 'HEAD', '/admin');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(get.body)));
  });

  it('HEAD follows GET redirects and unknown GET paths', async () => {
    const head = await call(port, 'HEAD', '/admin/user?id=abc');
    expect(head.status).toBe(302);
    expect(head.headers.location).toBe('/admin/?id=abc');
    expect(head.body).toBe('');

    const missing = await call(port, 'HEAD', '/no-such');
    expect(missing.status).toBe(404);
    expect(missing.body).toBe('');
    expect(missing.headers['content-length']).toBe('9');
  });

  it('OPTIONS /v1/search is 204 and does not open CORS', async () => {
    const opt = await call(port, 'OPTIONS', '/v1/search');
    expect(opt.status).toBe(204);
    expect(opt.body).toBe('');
    expect(String(opt.headers.allow)).toContain('OPTIONS');
    expect(opt.headers['access-control-allow-origin']).toBeUndefined();
    expect(opt.headers['access-control-allow-methods']).toBeUndefined();
    expect(opt.headers['access-control-allow-headers']).toBeUndefined();
  });

  it('HEAD does not run POST handlers, and POST /v1/yoomoney still answers', async () => {
    const head = await call(port, 'HEAD', '/v1/search');
    expect(head.status).toBe(404);

    const post = await call(port, 'POST', '/v1/yoomoney', '');
    expect(post.status).toBe(400);
    expect(post.body).toBe('bad signature');
  });
});
