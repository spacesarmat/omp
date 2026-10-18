/** Minimal HTML helpers. The admin UI is the React SPA in `public/`. */

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fallback page when the SPA build is missing. Password login is not offered. */
export function loginPage(error) {
  const err = error ? '<p style="color:#E5484D">' + esc(error) + '</p>' : '';
  return (
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>OMP Billing</title>' +
    '<body style="margin:0;background:#0F1115;color:#E8EAF0;font:16px/1.45 Manrope,Segoe UI,sans-serif">' +
    '<main style="max-width:360px;margin:4rem auto;padding:0 1rem">' +
    '<h1 style="font-size:1.4rem;display:flex;align-items:center;gap:10px">' +
    '<img src="/admin/logo.svg" alt="" width="40" height="40" style="border-radius:8px">OMP Billing</h1>' +
    '<p style="color:#9AA1B2">Вход в панель — только через Telegram. Соберите SPA (`admin` vite build), чтобы открыть кнопку входа.</p>' +
    err +
    '</main></body></html>'
  );
}
