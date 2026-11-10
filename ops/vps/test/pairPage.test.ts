import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const html = readFileSync('ops/vps/site/pair/index.html', 'utf8');
const js = readFileSync('ops/vps/site/pair-link.js', 'utf8');

function page() {
  const sandbox: { ompPairPage?: {
    parseSearch: (s: string) => { url: string; name: string; user: string; password: string } | null;
    pageUrl: (d: { url: string; name?: string; user?: string; password?: string }) => string;
    intentUrl: (d: { url: string; name?: string; user?: string; password?: string }) => string;
    fill: (doc: { getElementById: (id: string) => { textContent: string; hidden: boolean; value: string; type: string; setAttribute: (n: string, v: string) => void } | null; title?: string }, search: string, lang: string) => unknown;
  } } = {};
  runInNewContext(js, sandbox);
  return sandbox.ompPairPage!;
}

function el() {
  const nodes: { [id: string]: { textContent: string; hidden: boolean; value: string; type: string; attrs: { [k: string]: string }; setAttribute: (n: string, v: string) => void } } = {};
  const ids = ['pair-kicker', 'pair-heading', 'pair-line', 'pair-download', 'pair-home', 'pair-lang', 'pair-open', 'pair-url', 'pair-user-label', 'pair-pass-label', 'pair-user', 'pair-pass', 'pair-url-label'];
  ids.forEach((id) => {
    const node = {
      textContent: '',
      hidden: false,
      value: '',
      type: 'text',
      attrs: {} as { [k: string]: string },
      setAttribute(n: string, v: string) { this.attrs[n] = v; },
    };
    nodes[id] = node;
  });
  return {
    nodes,
    doc: {
      title: '',
      getElementById(id: string) { return nodes[id] || null; },
    },
  };
}

describe('pairing page', () => {
  const api = page();

  it('reads the QR query and builds an intent link that falls back to the same page', () => {
    const data = api.parseSearch('?v=1&url=' + encodeURIComponent('http://192.168.1.10:8090') + '&name=' + encodeURIComponent('Дом') + '&password=p%26s');
    expect(data && data.url).toBe('http://192.168.1.10:8090');
    expect(data && data.name).toBe('Дом');
    expect(data && data.password).toBe('p&s');
    expect(api.parseSearch('?v=1')).toBeNull();
    const url = api.pageUrl({ url: 'http://h:1', name: 'LG' });
    expect(url).toBe('https://omp-player.online/pair?v=1&url=' + encodeURIComponent('http://h:1') + '&name=LG');
    const intent = api.intentUrl({ url: 'http://h:1', name: 'LG' });
    expect(intent).toContain('package=com.spacesarmat.omp');
    expect(intent).toContain('scheme=https');
    expect(intent).toContain(encodeURIComponent(url));
  });

  it('prefills the address and keeps the password out of the visible text', () => {
    const view = el();
    api.fill(view.doc, '?v=1&url=' + encodeURIComponent('http://h:1') + '&user=admin&password=secret', 'ru');
    expect(view.nodes['pair-url'].value).toBe('http://h:1');
    expect(view.nodes['pair-user'].value).toBe('admin');
    expect(view.nodes['pair-pass'].value).toBe('secret');
    expect(view.nodes['pair-pass'].type).toBe('password');
    expect(view.nodes['pair-line'].textContent).not.toContain('secret');
    expect(view.nodes['pair-open'].hidden).toBe(false);
    expect(view.nodes['pair-open'].attrs.href).toContain('intent://omp-player.online/pair?');
    api.fill(view.doc, '', 'ru');
    expect(view.nodes['pair-open'].hidden).toBe(true);
    expect(view.nodes['pair-heading'].textContent).toBe('Ссылка не распознана');
  });

  it('is a noindex page with the install link', () => {
    expect(html).toContain('noindex, follow');
    expect(html).toContain('id="pair-url"');
    expect(html).toContain('id="pair-pass"');
    expect(html).toContain('https://github.com/spacesarmat/omp/releases/latest');
    expect(html).toContain('src="/pair-link.js?v=20261110a"');
    expect(html).not.toMatch(/magnet:/);
  });
});
