import { log } from '../lib/log';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
}

// Plain Error + fields: subclassing Error breaks instanceof after ES5 transpilation.
export function apiError(kind: ApiErrorKind, message: string, status?: number): Error & ApiError {
  const e = new Error(message) as Error & ApiError;
  e.kind = kind;
  if (status !== undefined) e.status = status;
  return e;
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof (e as ApiError).kind === 'string';
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.kind) {
      case 'network': return 'Сервер недоступен';
      case 'timeout': return 'Сервер не отвечает';
      case 'http': return 'Ошибка сервера (' + e.status + ')';
      case 'parse': return 'Некорректный ответ сервера';
    }
  }
  if (e && typeof (e as Error).message === 'string') return (e as Error).message;
  return 'Неизвестная ошибка';
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  auth?: string;
  responseType?: 'json' | 'text' | 'arraybuffer';
  /** The caller expects this to fail sometimes (optional endpoints, offline checks): keep it out of the log. */
  quiet?: boolean;
}

/** Failed request -> log: kind, status and site kind only (scrub drops everything after the host). */
function logFailure(url: string, e: unknown): void {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i.exec(url);
  const k = isApiError(e) ? e.kind : 'unknown';
  const st = isApiError(e) && e.status !== undefined ? ' ' + e.status : '';
  log('error', 'server', 'Запрос не удался (' + k + st + '): ' + (m ? m[0] : 'адрес'));
}

export function request<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const headers: { [k: string]: string } = {};
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (opts.auth) headers['Authorization'] = 'Basic ' + opts.auth;
  const type = opts.responseType || 'json';

  const p = fetch(url, {
    method: opts.method || (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  }).then(
    (res) => {
      if (!res.ok) throw apiError('http', 'HTTP ' + res.status, res.status);
      if (type === 'arraybuffer') {
        return res.arrayBuffer().then((buf) => buf as unknown as T).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      } else if (type === 'text') {
        return res.text().then((text) => text as unknown as T).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      } else {
        return res.text().then((text) => {
          if (!text) return null as unknown as T;
          try {
            return JSON.parse(text) as T;
          } catch (e) {
            throw apiError('parse', 'Bad JSON');
          }
        }).catch((e) => {
          throw isApiError(e) ? e : apiError('network', 'Network error');
        });
      }
    },
    () => {
      throw apiError('network', 'Network error');
    },
  );

  const timeout = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
  if (timeout <= 0) {
    // a side branch: the caller's promise gets no extra tick
    if (!opts.quiet) p.then(undefined, (e) => logFailure(url, e));
    return p;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      const e = apiError('timeout', 'Timeout');
      if (!opts.quiet) logFailure(url, e);
      reject(e);
    }, timeout);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => {
        clearTimeout(timer);
        // after the timeout fired the failure is already logged and rejected
        if (settled) return;
        if (!opts.quiet) logFailure(url, e);
        reject(e);
      },
    );
  });
}
