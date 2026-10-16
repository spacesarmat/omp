import { normalizeCode } from './crypto.mjs';
import { appSchemeUrl, formatCode } from './logic.mjs';
import { esc } from './panel.mjs';

/** Landing page Telegram opens; redirects into the OMP app with the code. */
export function goPage(code) {
  const dashed = formatCode(code);
  const n = normalizeCode(code);
  if (n.length !== 8) {
    return (
      '<!doctype html><html lang="ru"><meta charset="utf-8"><title>OMP</title><body style="font:16px sans-serif;padding:24px">' +
      '<p>Некорректный код.</p></body></html>'
    );
  }
  const scheme = appSchemeUrl(dashed);
  const intent =
    'intent://billing?code=' +
    encodeURIComponent(dashed) +
    '#Intent;scheme=omp;package=com.spacesarmat.omp;end';
  return (
    '<!doctype html><html lang="ru"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>OMP — код</title>' +
    '<style>body{margin:0;background:#0F1115;color:#E8EAF0;font:16px/1.45 Manrope,Segoe UI,sans-serif;padding:32px 20px}' +
    'a{display:inline-block;background:#F5B700;color:#0F1115;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;margin:8px 8px 0 0}' +
    '.code{font:22px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.08em;margin:12px 0}</style>' +
    '<body><h1>Подписка OMP</h1>' +
    '<p>Код подписки:</p><p class="code">' +
    esc(dashed) +
    '</p>' +
    '<p><a href="' +
    esc(scheme) +
    '">Открыть OMP</a>' +
    '<a href="' +
    esc(intent) +
    '">Android Intent</a></p>' +
    '<p style="color:#9AA1B2;font-size:14px">Если приложение не открылось — скопируйте код вручную.</p>' +
    '<script>location.href=' +
    JSON.stringify(scheme) +
    ';</script></body></html>'
  );
}
