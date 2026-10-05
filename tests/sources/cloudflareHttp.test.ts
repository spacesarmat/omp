import { describe, it, expect, beforeEach } from 'vitest';
import { createSourceHttp, type NativeHttpRequest } from '../../src/sources/http';
import { CF_FAILED, CF_INTERACTIVE, cloudflareFailure, siteRoot, toCloudflareError } from '../../src/sources/cloudflare';
import { setFlareSolverrUrl } from '../../src/sources/flareStore';
import { isCloudflare } from '../../src/sources/view';
import { clearLog, logEntries } from '../../src/lib/log';

let sent: NativeHttpRequest[];

function rejectWith(o: object) {
  return (req: NativeHttpRequest) => {
    sent.push(req);
    return Promise.reject(o);
  };
}

const page = (cloudflare?: string) => (req: NativeHttpRequest) => {
  sent.push(req);
  return Promise.resolve({ status: 200, url: req.url, text: 'ok', cloudflare });
};

beforeEach(() => {
  localStorage.clear();
  clearLog();
  sent = [];
});

describe('the Cloudflare flag', () => {
  it('is off by default: no flag, no FlareSolverr address', async () => {
    setFlareSolverrUrl('192.168.1.5');
    const http = createSourceHttp(page());
    await http.get('https://site.example/search?q=1', { timeoutMs: 5000 });
    await http.post('https://site.example/login', { a: 'b' });
    expect(sent[0].cloudflare).toBeUndefined();
    expect(sent[0].flaresolverr).toBeUndefined();
    expect(sent[1].cloudflare).toBeUndefined();
  });

  it('goes to the native side with the saved FlareSolverr when the site switch is on', async () => {
    const http = createSourceHttp(page());
    await http.get('https://site.example/', { cloudflare: true });
    expect(sent[0].cloudflare).toBe(true);
    expect(sent[0].flaresolverr).toBeUndefined();
    setFlareSolverrUrl('192.168.1.5');
    await http.post('https://site.example/login', { a: 'b' }, { cloudflare: true, formCharset: 'windows-1251' });
    expect(sent[1]).toMatchObject({ method: 'POST', cloudflare: true, flaresolverr: 'http://192.168.1.5:8191', formCharset: 'windows-1251' });
  });

  it('the FlareSolverr address source can be replaced (tests, the TV)', async () => {
    const http = createSourceHttp(page(), undefined, () => 'http://10.0.0.2:8191');
    await http.get('https://site.example/', { cloudflare: true });
    expect(sent[0].flaresolverr).toBe('http://10.0.0.2:8191');
  });
});

describe('results', () => {
  it('a pass is logged with the site name only', async () => {
    const http = createSourceHttp(page('browser'));
    const r = await http.get('https://kinozal.example/browse.php?s=secret', { cloudflare: true, siteName: 'Kinozal' });
    expect(r.text).toBe('ok');
    const e = logEntries();
    expect(e.length).toBe(1);
    expect(e[0].l).toBe('info');
    expect(e[0].a).toBe('search');
    expect(e[0].x).toBe('Cloudflare: проверка пройдена · Kinozal');
  });

  it('no log without a check', async () => {
    await createSourceHttp(page()).get('https://site.example/', { cloudflare: true });
    await createSourceHttp(page('browser')).get('https://site.example/');
    expect(logEntries().length).toBe(0);
  });

  it('a check that needs a person rejects with its kind and the site root', async () => {
    const http = createSourceHttp(rejectWith({ message: CF_INTERACTIVE, code: 'cloudflare-interactive' }));
    const e = await http.get('https://user:pw@rustorka.example:8443/forum/tracker.php?nm=x', { cloudflare: true }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('cloudflare-interactive');
    expect(e.siteUrl).toBe('https://rustorka.example:8443/');
    expect(cloudflareFailure(e)).toEqual({ kind: 'cloudflare-interactive', siteUrl: 'https://rustorka.example:8443/' });
    // the sources screen shows it as a Cloudflare state
    expect(isCloudflare(e.message)).toBe(true);
    const log = logEntries();
    expect(log[0].l).toBe('warn');
    expect(log[0].x).toBe('Cloudflare: нужна галочка · rustorka.example');
    expect(log[0].x).not.toContain('http');
  });

  it('a failed check; the background page sends the message without the code', async () => {
    const http = createSourceHttp(rejectWith({ message: CF_FAILED }));
    const e = await http.get('https://site.example/x', { cloudflare: true, siteName: 'Сайт' }).catch((x) => x);
    expect(e.code).toBe('cloudflare');
    expect(e.message).toBe(CF_FAILED);
    expect(logEntries()[0].x).toBe('Cloudflare: не удалось · Сайт');
  });

  it('other failures pass through unchanged', async () => {
    const original = new Error('Сайт не отвечает');
    const e = await createSourceHttp(rejectWith(original)).get('https://site.example/', { cloudflare: true }).catch((x) => x);
    expect(e).toBe(original);
    expect(cloudflareFailure(e)).toBeNull();
    expect(logEntries().length).toBe(0);
  });

  it('helpers', () => {
    expect(siteRoot('HTTPS://A.Example/x?y')).toBe('https://a.example/');
    expect(siteRoot('magnet:?x')).toBe('');
    expect(toCloudflareError(null, 'https://a/')).toBeNull();
    expect(toCloudflareError('text', 'https://a/')).toBeNull();
  });
});
