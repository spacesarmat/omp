import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Public verification tokens for Google Search Console (URL-prefix property)
// and Yandex.Webmaster (fallback to the DNS TXT record on the apex).
const TAGS = [
  '<meta name="google-site-verification" content="48hEq_2gYVHJP7YwWt6Fj8ntTzM_KasZ9C6EH4BiuDc" />',
  '<meta name="yandex-verification" content="a575e26cd96c626d" />',
];

describe.each(['ops/vps/site/index.html', 'ops/vps/site/en/index.html'])('%s', (file) => {
  const html = readFileSync(file, 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));

  it('carries each search console tag once, in <head>', () => {
    for (const tag of TAGS) {
      expect(head).toContain(tag);
      expect(html.split(tag)).toHaveLength(2);
    }
  });
});
