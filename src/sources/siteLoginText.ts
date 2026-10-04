// Messages and error codes of the sign-in to the sites behind a login (Kinozal, rustorka…; siteLogin.ts). Kept apart
// from the parsers so code that only compares them (the transfer from the phone) does not pull a parser into the LG
// bundle. Chromium 53 rules: plain Errors with a `code`.

export const SITE_BAD_LOGIN = 'Неверный логин или пароль';
export const SITE_EMPTY = 'Введите логин и пароль';
export const SITE_NO_STORE = 'Вход доступен только в приложении Android';

/** «Kinozal просит капчу — войдите на сайте в браузере и попробуйте снова» (no captcha solving in OMP). */
export function siteCaptcha(name: string): string {
  return name + ' просит капчу — войдите на сайте в браузере и попробуйте снова';
}

export type SiteLoginCode = 'bad_login' | 'captcha';

export function siteLoginError(code: SiteLoginCode, name: string): Error {
  const e = new Error(code === 'captcha' ? siteCaptcha(name) : SITE_BAD_LOGIN);
  (e as Error & { code?: string }).code = code;
  return e;
}

/** 'bad_login' / 'captcha' of a sign-in error, null for anything else (network, Cloudflare…). */
export function siteLoginCode(e: unknown): SiteLoginCode | null {
  const c = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return c === 'bad_login' || c === 'captcha' ? c : null;
}

/** Secret storage entries of a site's login; the pending pair is what a transfer from the phone stages on the TV. */
export interface SiteLoginKeys {
  user: string;
  pass: string;
  pendingUser: string;
  pendingPass: string;
}

/** `<id>.username` / `<id>.password` and `<id>.pending.*` (android/.../control/SourcesTransfer.kt SecretLoginStore). */
export function siteLoginKeys(id: string): SiteLoginKeys {
  return { user: id + '.username', pass: id + '.password', pendingUser: id + '.pending.username', pendingPass: id + '.pending.password' };
}
