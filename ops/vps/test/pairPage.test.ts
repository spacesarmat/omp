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
  const ids = ['pair-kicker', 'pair-heading', 'pair-line', 'pair-download', 'pair-home', 'pair-lang', 'pair-open', 'pair-url', 'pair-user-label', 'pair-pass-label', 'pair-user', 'pair-pass', 'pair-url-label', 'pair-url-caption', 'pair-user-caption', 'pair-pass-caption'];
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
    const url = api.pageUrl({ url: 'http://h:1', name: 'LG', user: 'admin', password: 'p&s' });
    expect(url.split('#')[0]).toBe('https://omp-player.online/pair?v=1&url=' + encodeURIComponent('http://h:1') + '&name=LG');
    expect(url.split('#')[0]).not.toMatch(/[?&](user|password)=/);
    expect(url.split('#')[1]).toContain('password=' + encodeURIComponent('p&s'));
    const intent = api.intentUrl({ url: 'http://h:1', name: 'LG', user: 'admin', password: 'p&s' });
    expect(intent).toContain('package=com.spacesarmat.omp');
    expect(intent).toContain('scheme=https');
    expect(intent).toContain(encodeURIComponent(url));
    expect(intent.indexOf('#Intent')).toBeGreaterThan(intent.indexOf('password='));
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
    expect(html).toContain('src="/pair-link.js?v=20261110b"');
    expect(html).not.toMatch(/magnet:/);
    expect(html).not.toContain('mc.yandex');
  });

  it('keeps the address field when the caption is filled in the page tree', () => {
    const doc = domFrom(html);
    api.fill(doc as never, '?v=1&url=' + encodeURIComponent('http://h:1') + '#user=admin&password=secret', 'ru');
    const input = doc.getElementById('pair-url')!;
    const label = doc.getElementById('pair-url-label')!;
    expect(label.contains(input)).toBe(true);
    expect(input.value).toBe('http://h:1');
    expect(doc.getElementById('pair-user')!.value).toBe('admin');
    expect(doc.getElementById('pair-pass')!.value).toBe('secret');
    expect(doc.getElementById('pair-pass')!.type).toBe('password');
    expect(doc.textContent()).not.toContain('secret');
    expect(doc.getElementById('pair-url-caption')!.textContent).toBe('Адрес сервера');
  });
});

/** Enough of a DOM that setting a parent's textContent drops its children, as a browser does. */
function domFrom(source: string) {
  const byId: { [id: string]: DomNode } = {};
  const root = new DomNode('body');
  const stack: DomNode[] = [root];
  const re = /<\/?([a-z0-9]+)([^>]*)>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const text = source.slice(last, m.index).replace(/\s+/g, ' ');
    if (text.trim() && stack.length) stack[stack.length - 1].append(new DomNode('#text', text));
    last = m.index + m[0].length;
    const name = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
      continue;
    }
    const node = new DomNode(name);
    const id = /id="([^"]+)"/.exec(m[2]);
    if (id) {
      node.id = id[1];
      byId[node.id] = node;
    }
    const type = /type="([^"]+)"/.exec(m[2]);
    if (type) node.type = type[1];
    if (/\shidden\b/.test(m[2])) node.hidden = true;
    stack[stack.length - 1].append(node);
    const voidEl = /^(input|img|br|meta|link)$/.test(name) || m[0].endsWith('/>');
    if (!voidEl) stack.push(node);
  }
  return {
    title: '',
    getElementById(id: string) { return byId[id] || null; },
    textContent() { return root.textContent; },
  };
}

class DomNode {
  name: string;
  id = '';
  value = '';
  type = 'text';
  hidden = false;
  attrs: { [k: string]: string } = {};
  parent: DomNode | null = null;
  children: DomNode[] = [];
  private text = '';
  constructor(name: string, text = '') {
    this.name = name;
    this.text = text;
  }
  append(node: DomNode) {
    node.parent = this;
    this.children.push(node);
  }
  contains(node: DomNode | null): boolean {
    let cur: DomNode | null = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }
  get textContent(): string {
    if (this.name === '#text') return this.text;
    if (!this.children.length) return this.text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
}
