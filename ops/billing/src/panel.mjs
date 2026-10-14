/** Minimal HTML helpers. The admin UI is the React SPA in `public/`. */

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Fallback login when the SPA build is missing. */
export function loginPage(error) {
  const err = error ? '<p style="color:#E5484D">' + esc(error) + '</p>' : '';
  return (
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>OMP Billing</title>' +
    '<body style="margin:0;background:#0F1115;color:#E8EAF0;font:16px/1.45 Manrope,Segoe UI,sans-serif">' +
    '<main style="max-width:360px;margin:4rem auto;padding:0 1rem">' +
    '<h1 style="font-size:1.4rem">OMP Billing</h1>' +
    err +
    '<form method="post" action="/admin/login" style="background:#181B22;padding:1rem;border-radius:12px">' +
    '<label style="display:block;color:#9AA1B2;font-size:13px;margin:0 0 4px">Пароль</label>' +
    '<input type="password" name="password" autofocus style="width:100%;box-sizing:border-box;background:#252A35;color:#E8EAF0;border:0;border-radius:8px;padding:10px 12px">' +
    '<button style="margin-top:12px;width:100%;background:#F5B700;color:#0F1115;border:0;border-radius:8px;padding:12px;font-weight:700">Войти</button>' +
    '</form></main></body></html>'
  );
}
